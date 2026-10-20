import { Inject, Injectable } from '@nestjs/common';
import { Knex } from 'knex';
import { pick } from 'lodash';
import { UnitOfWork } from '@/modules/Tenancy/TenancyDB/UnitOfWork.service';
import { TenantModelProxy } from '@/modules/System/models/TenantBaseModel';
import { AuditLogService } from '@/modules/AuditLogs/AuditLog.service';
import { AbilitySubject } from '@/modules/Roles/Roles.types';
import { ServiceError } from '@/modules/Items/ServiceError';
import { TENANCY_DB_CONNECTION } from '@/modules/Tenancy/TenancyDB/TenancyDB.constants';
import { PriceLevel } from '../models/PriceLevel.model';
import { PriceLevelItem } from '../models/PriceLevelItem.model';
import { AssignPriceLevelDto, CreatePriceLevelDto, EditPriceLevelDto } from '../dtos/PriceLevel.dto';
import { ERRORS, PRICE_LEVEL_USAGE_TABLES } from '../PriceLevels.types';
import { PriceLevelValidator } from './PriceLevelValidator.service';

const FIELDS = ['name', 'description', 'type', 'method', 'percentage', 'currencyCode', 'rounding', 'validFrom', 'validTo', 'active'] as const;

const toModel = (dto: CreatePriceLevelDto) => ({
  name: dto.name.trim(),
  description: dto.description?.trim() || null,
  type: dto.type,
  method: dto.method,
  percentage: dto.method === 'percentage' ? dto.percentage ?? 0 : null,
  currencyCode: dto.method === 'per_item' && dto.currencyCode ? dto.currencyCode.toUpperCase() : null,
  rounding: dto.rounding ?? 'none',
  validFrom: dto.validFrom ? dto.validFrom.slice(0, 10) : null,
  validTo: dto.validTo ? dto.validTo.slice(0, 10) : null,
  active: dto.active ?? true,
});

@Injectable()
export class PriceLevelCommandsService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly validator: PriceLevelValidator,
    private readonly auditLog: AuditLogService,

    @Inject(PriceLevel.name)
    private readonly priceLevelModel: TenantModelProxy<typeof PriceLevel>,

    @Inject(PriceLevelItem.name)
    private readonly priceLevelItemModel: TenantModelProxy<typeof PriceLevelItem>,

    @Inject(TENANCY_DB_CONNECTION)
    private readonly tenantKnex: () => Knex,
  ) {}

  createPriceLevel(dto: CreatePriceLevelDto): Promise<PriceLevel> {
    return this.uow.withTransaction(async (trx: Knex.Transaction) => {
      const data = toModel(dto);
      await this.validateLevel(data, dto, undefined, trx);

      const level = await this.priceLevelModel().query(trx).insertAndFetch(data);
      await this.writeRules(level.id, dto, trx);
      await this.auditLog.record({
        action: 'created',
        subject: AbilitySubject.PriceLevel,
        subjectId: level.id,
        metadata: { after: pick(level, FIELDS) },
        trx,
      });
      return level;
    });
  }

  editPriceLevel(id: number, dto: EditPriceLevelDto): Promise<PriceLevel> {
    return this.uow.withTransaction(async (trx: Knex.Transaction) => {
      const old = await this.validator.getOrThrow(id, trx);
      const data = toModel(dto);
      await this.validateLevel(data, dto, old, trx);

      const level = await this.priceLevelModel().query(trx).patchAndFetchById(id, data);
      await this.writeRules(id, dto, trx);
      await this.auditLog.record({
        action: 'edited',
        subject: AbilitySubject.PriceLevel,
        subjectId: id,
        metadata: { before: pick(old, FIELDS), after: pick(level, FIELDS) },
        trx,
      });
      return level;
    });
  }

  /** Only a level nothing uses can be deleted; otherwise deactivate it. */
  deletePriceLevel(id: number): Promise<void> {
    return this.uow.withTransaction(async (trx: Knex.Transaction) => {
      const old = await this.validator.getOrThrow(id, trx);
      for (const table of PRICE_LEVEL_USAGE_TABLES) {
        if (await trx(table).where('price_level_id', id).first('id')) {
          throw new ServiceError(ERRORS.PRICE_LEVEL_IN_USE, 'Customers, vendors or documents use this price level; deactivate it instead of deleting it.');
        }
      }
      await this.priceLevelModel().query(trx).deleteById(id);
      await this.auditLog.record({
        action: 'deleted',
        subject: AbilitySubject.PriceLevel,
        subjectId: id,
        metadata: { before: pick(old, FIELDS) },
        trx,
      });
    });
  }

  /** Makes this the default price level of the given customers (sales) or vendors (purchase). */
  assign(id: number, dto: AssignPriceLevelDto): Promise<{ assigned: number }> {
    return this.uow.withTransaction(async (trx: Knex.Transaction) => {
      const level = await this.validator.getOrThrow(id, trx);
      if (!level.active) {
        throw new ServiceError(ERRORS.PRICE_LEVEL_INACTIVE, 'The price level is inactive.');
      }
      const ids = [...new Set(dto.contactIds)];
      const service = level.type === 'sales' ? 'customer' : 'vendor';
      const found = (await trx('contacts').whereIn('id', ids).where('contact_service', service).select('id')).map((r: any) => r.id);
      const missing = ids.filter((cid) => !found.includes(cid));
      if (missing.length) {
        throw new ServiceError(ERRORS.PRICE_LEVEL_CONTACT_NOT_FOUND, `These ${service}s were not found.`, { contactIds: missing });
      }
      await trx('contacts').whereIn('id', ids).update({ price_level_id: id });
      await this.auditLog.record({ action: 'assigned', subject: AbilitySubject.PriceLevel, subjectId: id, metadata: { contactIds: ids }, trx });
      return { assigned: ids.length };
    });
  }

  private async validateLevel(data: ReturnType<typeof toModel>, dto: CreatePriceLevelDto, old: PriceLevel | undefined, trx: Knex.Transaction) {
    const sameName = this.priceLevelModel().query(trx).where('name', data.name);
    if (old) sameName.whereNot('id', old.id);
    if (await sameName.first()) {
      throw new ServiceError(ERRORS.PRICE_LEVEL_NAME_EXISTS, 'Another price level already has this name.');
    }
    // The type decides who can have the level and which documents use it: it can't change once used.
    if (old && old.type !== data.type) {
      for (const table of PRICE_LEVEL_USAGE_TABLES) {
        if (await trx(table).where('price_level_id', old.id).first('id')) {
          throw new ServiceError(ERRORS.PRICE_LEVEL_INVALID, 'The type of a price level in use cannot change.');
        }
      }
    }
    if (data.validFrom && data.validTo && data.validFrom > data.validTo) {
      throw new ServiceError(ERRORS.PRICE_LEVEL_INVALID, 'The end date is before the start date.');
    }
    if (data.method === 'percentage' && (dto.items?.length ?? 0) > 0) {
      throw new ServiceError(ERRORS.PRICE_LEVEL_INVALID, 'A percentage price level has no item prices.');
    }
    if (data.method === 'per_item' && (dto.categoryIds?.length ?? 0) > 0) {
      throw new ServiceError(ERRORS.PRICE_LEVEL_INVALID, 'Categories apply to percentage price levels only.');
    }
    const items = dto.items ?? [];
    const keys = new Set(items.map((i) => `${i.itemId}:${Number(i.minQuantity ?? 1)}`));
    if (keys.size !== items.length) {
      throw new ServiceError(ERRORS.PRICE_LEVEL_INVALID, 'An item has the same quantity break twice.');
    }
    const itemIds = [...new Set(items.map((i) => i.itemId))];
    const foundItems = itemIds.length ? (await trx('items').whereIn('id', itemIds).select('id')).map((r: any) => r.id) : [];
    const missingItems = itemIds.filter((iid) => !foundItems.includes(iid));
    if (missingItems.length) {
      throw new ServiceError(ERRORS.PRICE_LEVEL_INVALID, 'Some items were not found.', { itemIds: missingItems });
    }
    const categoryIds = [...new Set(dto.categoryIds ?? [])];
    // Not pluck(): it reads the raw (UPPER_SNAKE) column key before the identifier mapper runs.
    const foundCategories = categoryIds.length ? (await trx('items_categories').whereIn('id', categoryIds).select('id')).map((r: any) => r.id) : [];
    const missingCategories = categoryIds.filter((cid) => !foundCategories.includes(cid));
    if (missingCategories.length) {
      throw new ServiceError(ERRORS.PRICE_LEVEL_INVALID, 'Some item categories were not found.', { categoryIds: missingCategories });
    }
  }

  /** Replaces the level's item prices and categories (only when the request gives them, or the method no longer uses them). */
  private async writeRules(id: number, dto: CreatePriceLevelDto, trx: Knex.Transaction) {
    if (dto.items !== undefined || dto.method === 'percentage') {
      await this.priceLevelItemModel().query(trx).where('priceLevelId', id).delete();
      if (dto.method === 'per_item' && dto.items?.length) {
        await trx('price_level_items').insert(
          dto.items.map((i) => ({ price_level_id: id, item_id: i.itemId, min_quantity: i.minQuantity ?? 1, price: i.price })),
        );
      }
    }
    if (dto.categoryIds !== undefined || dto.method === 'per_item') {
      await trx('price_level_categories').where('price_level_id', id).delete();
      if (dto.method === 'percentage' && dto.categoryIds?.length) {
        await trx('price_level_categories').insert([...new Set(dto.categoryIds)].map((cid) => ({ price_level_id: id, category_id: cid })));
      }
    }
  }
}
