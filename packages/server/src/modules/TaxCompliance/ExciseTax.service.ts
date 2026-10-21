import { Inject, Injectable } from '@nestjs/common';
import { Knex } from 'knex';
import { keyBy, uniq } from 'lodash';
import { DEFAULT_EXCISE_TAX_CODES, ExciseTaxKind } from '@bigcapital/pdf-templates';
import { TenantModelProxy } from '@/modules/System/models/TenantBaseModel';
import { Account } from '@/modules/Accounts/models/Account.model';
import { Item } from '@/modules/Items/models/Item';
import { AuditLogService } from '@/modules/AuditLogs/AuditLog.service';
import { AbilitySubject } from '@/modules/Roles/Roles.types';
import { ServiceError } from '@/modules/Items/ServiceError';
import { ExciseTaxCode } from './models/ExciseTaxCode.model';
import { EditExciseTaxCodeDto } from './dtos/ExciseTaxCode.dto';

export const EXCISE_ERRORS = {
  CODE_NOT_FOUND: 'EXCISE_TAX_CODE_NOT_FOUND',
  INCLUSIVE_TAX: 'EXCISE_TAX_INCLUSIVE_UNSUPPORTED',
  ACCOUNT_NOT_FOUND: 'EXCISE_TAX_ACCOUNT_NOT_FOUND',
};

/** The liability account each kind of code posts to by default. */
const PAYABLE_ACCOUNTS: Record<ExciseTaxKind, { name: string; slug: string }> = {
  specific: { name: 'Specific Tax Payable', slug: 'specific-tax-payable' },
  accommodation: { name: 'Accommodation Tax Payable', slug: 'accommodation-tax-payable' },
  plt: { name: 'Public Lighting Tax Payable', slug: 'public-lighting-tax-payable' },
};

/** The item column a code of this kind is assigned through. */
const itemColumn = (kind: ExciseTaxKind) => (kind === 'plt' ? 'pltCodeId' : 'specificTaxCodeId');

export interface ExciseTaxCodeView {
  id: number;
  kind: ExciseTaxKind;
  code: string;
  name: string;
  nameKm: string | null;
  rate: number;
  basePercent: number;
  accountId: number | null;
  active: boolean;
  itemIds: number[];
}

/**
 * 103 DiTech part C1: Specific Tax, Accommodation Tax and Public Lighting Tax.
 * Codes carry the rate, the base percentage and the payable account; items
 * are assigned a Specific/Accommodation code and a PLT code; invoice lines
 * keep the rates they were charged at (shared pdf-templates ExciseTax.ts).
 */
@Injectable()
export class ExciseTaxService {
  constructor(
    private readonly auditLog: AuditLogService,

    @Inject(ExciseTaxCode.name)
    private readonly codeModel: TenantModelProxy<typeof ExciseTaxCode>,

    @Inject(Item.name)
    private readonly itemModel: TenantModelProxy<typeof Item>,

    @Inject(Account.name)
    private readonly accountModel: TenantModelProxy<typeof Account>,
  ) {}

  /** The company's codes with their items; the starting codes are created on first use. */
  async list(): Promise<ExciseTaxCodeView[]> {
    await this.ensureDefaults();
    const codes = await this.codeModel().query().orderBy('id');
    const items = await this.itemModel()
      .query()
      .where((q) => q.whereNotNull('specificTaxCodeId').orWhereNotNull('pltCodeId'))
      .select('id', 'specificTaxCodeId', 'pltCodeId');
    return codes.map((c) => this.view(c, items));
  }

  async edit(id: number, dto: EditExciseTaxCodeDto): Promise<ExciseTaxCodeView> {
    const code = await this.getOrThrow(id);
    if (dto.accountId) {
      const account = await this.accountModel().query().findById(dto.accountId);
      if (!account) throw new ServiceError(EXCISE_ERRORS.ACCOUNT_NOT_FOUND, 'The payable account was not found.');
    }
    const patch = {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.nameKm !== undefined ? { nameKm: dto.nameKm } : {}),
      ...(dto.rate !== undefined ? { rate: dto.rate } : {}),
      ...(dto.basePercent !== undefined ? { basePercent: dto.basePercent } : {}),
      ...(dto.accountId !== undefined ? { accountId: dto.accountId } : {}),
      ...(dto.active !== undefined ? { active: dto.active } : {}),
    };
    await this.codeModel().query().patchAndFetchById(id, patch);
    await this.auditLog.record({
      action: 'edited',
      subject: AbilitySubject.Preferences,
      subjectId: id,
      metadata: { exciseTaxCode: { code: code.code, before: { rate: code.rate, basePercent: code.basePercent, accountId: code.accountId, active: code.active }, after: patch } },
    });
    return (await this.list()).find((c) => c.id === id)!;
  }

  /** Assigns the code to exactly these items (an item has one code of each slot). */
  async setItems(id: number, itemIds: number[]): Promise<ExciseTaxCodeView> {
    const code = await this.getOrThrow(id);
    const column = itemColumn(code.kind);
    const ids = uniq(itemIds.map(Number).filter(Boolean));
    await this.itemModel().query().where(column, id).whereNotIn('id', ids.length ? ids : [0]).patch({ [column]: null } as any);
    if (ids.length) await this.itemModel().query().whereIn('id', ids).patch({ [column]: id } as any);
    await this.auditLog.record({ action: 'edited', subject: AbilitySubject.Preferences, subjectId: id, metadata: { exciseTaxCode: { code: code.code, itemIds: ids } } });
    return (await this.list()).find((c) => c.id === id)!;
  }

  /**
   * Copies each line's item codes and their current rates onto the line, so
   * the invoice keeps the rates it was charged at. Tax-inclusive documents do
   * not take these taxes.
   */
  assocExciseToEntries = async <T extends { itemId?: number }>(entries: T[], isInclusiveTax?: boolean, trx?: Knex.Transaction): Promise<T[]> => {
    const itemIds = uniq(entries.map((e) => e.itemId).filter(Boolean)) as number[];
    if (!itemIds.length) return entries;
    const items = await this.itemModel().query(trx).whereIn('id', itemIds).select('id', 'specificTaxCodeId', 'pltCodeId');
    const codeIds = uniq(items.flatMap((i: any) => [i.specificTaxCodeId, i.pltCodeId]).filter(Boolean));
    const codes = codeIds.length ? keyBy(await this.codeModel().query(trx).whereIn('id', codeIds).where('active', true), 'id') : {};
    const itemsById = keyBy(items, 'id');

    return entries.map((entry) => {
      const item: any = itemsById[entry.itemId as number];
      const specific = item?.specificTaxCodeId ? codes[item.specificTaxCodeId] : undefined;
      const plt = item?.pltCodeId ? codes[item.pltCodeId] : undefined;
      if ((specific || plt) && isInclusiveTax) {
        throw new ServiceError(EXCISE_ERRORS.INCLUSIVE_TAX, 'Items with Specific Tax or Public Lighting Tax need prices excluding tax: switch the invoice to "Exclusive of tax".');
      }
      return {
        ...entry,
        specificTaxCodeId: specific?.id ?? null,
        specificTaxRate: specific ? Number(specific.rate) : null,
        specificTaxBase: specific ? Number(specific.basePercent) : null,
        pltCodeId: plt?.id ?? null,
        pltRate: plt ? Number(plt.rate) : null,
        pltBase: plt ? Number(plt.basePercent) : null,
      };
    });
  };

  /** Creates the starting codes and their payable accounts once per company. */
  async ensureDefaults(trx?: Knex.Transaction) {
    const count = await this.codeModel().query(trx).resultSize();
    if (count > 0) return;
    const accounts: Partial<Record<ExciseTaxKind, number>> = {};
    for (const kind of Object.keys(PAYABLE_ACCOUNTS) as ExciseTaxKind[]) {
      accounts[kind] = (await this.findOrCreatePayable(kind, trx)).id;
    }
    // One by one: objection's batch insert is not supported on MySQL.
    for (const c of DEFAULT_EXCISE_TAX_CODES) {
      await this.codeModel()
        .query(trx)
        .insert({ ...c, accountId: accounts[c.kind], active: true } as any);
    }
  }

  private async findOrCreatePayable(kind: ExciseTaxKind, trx?: Knex.Transaction) {
    const { name, slug } = PAYABLE_ACCOUNTS[kind];
    const found = await this.accountModel().query(trx).findOne({ slug });
    if (found) return found;
    return this.accountModel()
      .query(trx)
      .insertAndFetch({ name, slug, accountType: 'tax-payable', description: '', active: true, index: 1, predefined: false } as any);
  }

  private async getOrThrow(id: number) {
    const code = await this.codeModel().query().findById(id);
    if (!code) throw new ServiceError(EXCISE_ERRORS.CODE_NOT_FOUND, 'The tax code was not found.');
    return code;
  }

  private view(c: ExciseTaxCode, items: any[]): ExciseTaxCodeView {
    const column = itemColumn(c.kind);
    return {
      id: c.id,
      kind: c.kind,
      code: c.code,
      name: c.name,
      nameKm: c.nameKm,
      rate: Number(c.rate),
      basePercent: Number(c.basePercent),
      accountId: c.accountId,
      active: !!c.active,
      itemIds: items.filter((i) => i[column] === c.id).map((i) => i.id),
    };
  }
}
