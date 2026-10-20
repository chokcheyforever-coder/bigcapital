import { Inject, Injectable } from '@nestjs/common';
import { Knex } from 'knex';
import * as XLSX from 'xlsx';
import { ServiceError } from '@/modules/Items/ServiceError';
import { UnitOfWork } from '@/modules/Tenancy/TenancyDB/UnitOfWork.service';
import { AuditLogService } from '@/modules/AuditLogs/AuditLog.service';
import { AbilitySubject } from '@/modules/Roles/Roles.types';
import { TENANCY_DB_CONNECTION } from '@/modules/Tenancy/TenancyDB/TenancyDB.constants';
import { cellAmount, csvUnsafe, SheetFormat, writeSheet } from '@/modules/Budgeting/commands/BudgetSheet.service';
import { PriceLevelValidator } from './PriceLevelValidator.service';
import { PriceLevelQueriesService } from '../queries/PriceLevelQueries.service';
import { ERRORS } from '../PriceLevels.types';

export const MAX_IMPORT_ROWS = 5000;
const HEADERS = ['Item code', 'Item name', 'From quantity', 'Price', 'Normal price'];

/**
 * Excel/CSV export and import of a per-item price level's prices (one row per
 * item and quantity break). A level with no prices yet exports every item with
 * an empty price, so the file doubles as the template. Import replaces all
 * prices of the level, all rows or none.
 */
@Injectable()
export class PriceLevelSheetService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly validator: PriceLevelValidator,
    private readonly queries: PriceLevelQueriesService,
    private readonly auditLog: AuditLogService,

    @Inject(TENANCY_DB_CONNECTION)
    private readonly tenantKnex: () => Knex,
  ) {}

  async exportLevel(id: number, format: SheetFormat) {
    const level = await this.queries.getPriceLevel(id);
    this.assertPerItem(level.method);
    const priceColumn = level.type === 'sales' ? 'sell_price' : 'cost_price';
    let rows: unknown[][] = level.items.map((i) => [i.itemCode ?? '', i.itemName, i.minQuantity, i.price, i.standardPrice]);
    if (rows.length === 0) {
      const items = await this.tenantKnex()('items')
        .where('active', true)
        .where(level.type === 'sales' ? 'sellable' : 'purchasable', true)
        .orderBy('name')
        .select('code', 'name', priceColumn);
      rows = items.map((i: any) => [i.code ?? '', i.name, 1, null, Number(i.sellPrice ?? i.costPrice ?? i[priceColumn] ?? 0)]);
    }
    const name = level.name.replace(/[^\w-]+/g, '_').slice(0, 60) || 'price-level';
    return writeSheet([HEADERS, ...rows], format, `price-level-${name}`, 'Prices');
  }

  async importLevel(id: number, file: Buffer) {
    const level = await this.validator.getOrThrow(id);
    this.assertPerItem(level.method);

    let table: unknown[][];
    try {
      const book = XLSX.read(file, { type: 'buffer', raw: true });
      table = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1, raw: true, defval: null, blankrows: false }) as unknown[][];
    } catch {
      throw new ServiceError(ERRORS.PRICE_LEVEL_INVALID, 'The file could not be read as Excel or CSV.');
    }
    const header = (table[0] ?? []).map((h) => String(h ?? '').trim().toLowerCase());
    const col = (name: string) => header.indexOf(name.toLowerCase());
    const [cCode, cName, cQty, cPrice] = ['Item code', 'Item name', 'From quantity', 'Price'].map(col);
    if (cPrice < 0 || (cCode < 0 && cName < 0)) {
      throw new ServiceError(ERRORS.PRICE_LEVEL_INVALID, `The first row must hold the headers: ${HEADERS.slice(0, 4).join(', ')}.`);
    }
    const body = table.slice(1);
    if (body.length > MAX_IMPORT_ROWS) {
      throw new ServiceError(ERRORS.PRICE_LEVEL_INVALID, `A file can have at most ${MAX_IMPORT_ROWS} rows.`);
    }

    const items = await this.tenantKnex()('items').select('id', 'code', 'name');
    const byCode = new Map(items.filter((i: any) => i.code).map((i: any) => [String(i.code).trim().toLowerCase(), i.id]));
    const byName = new Map(items.map((i: any) => [String(i.name).trim().toLowerCase(), i.id]));

    const errors: Array<{ row: number; message: string }> = [];
    const prices: Array<{ itemId: number; minQuantity: number; price: number }> = [];
    const seen = new Set<string>();
    body.forEach((cells, index) => {
      const row = index + 2;
      const text = (c: number) => (c >= 0 && cells[c] != null ? csvUnsafe(String(cells[c]).trim()) : '');
      const priceCell = cellAmount(cPrice >= 0 ? cells[cPrice] : null);
      if (priceCell === null) return; // no price: the item keeps its normal price
      const code = text(cCode).toLowerCase();
      const name = text(cName).toLowerCase();
      const itemId = (code && byCode.get(code)) || (name && byName.get(name));
      if (!itemId) {
        errors.push({ row, message: `Unknown item "${text(cCode) || text(cName)}".` });
        return;
      }
      const price = Number(priceCell);
      if (!Number.isFinite(price) || price < 0) {
        errors.push({ row, message: 'The price must be a number of 0 or more.' });
        return;
      }
      const qtyCell = cellAmount(cQty >= 0 ? cells[cQty] : null);
      const minQuantity = qtyCell === null ? 1 : Number(qtyCell);
      if (!Number.isFinite(minQuantity) || minQuantity <= 0) {
        errors.push({ row, message: 'From quantity must be more than 0.' });
        return;
      }
      const key = `${itemId}:${minQuantity}`;
      if (seen.has(key)) {
        errors.push({ row, message: 'The same item and quantity appear twice.' });
        return;
      }
      seen.add(key);
      prices.push({ itemId, minQuantity: Math.round(minQuantity * 1000) / 1000, price: Math.round(price * 1000) / 1000 });
    });

    if (errors.length > 0) {
      throw new ServiceError(ERRORS.PRICE_LEVEL_INVALID, `${errors.length} row(s) could not be imported; nothing was saved.`, { rows: errors.slice(0, 100) });
    }

    await this.uow.withTransaction(async (trx: Knex.Transaction) => {
      await trx('price_level_items').where('price_level_id', id).delete();
      if (prices.length) {
        await trx('price_level_items').insert(prices.map((p) => ({ price_level_id: id, item_id: p.itemId, min_quantity: p.minQuantity, price: p.price })));
      }
      await this.auditLog.record({ action: 'imported', subject: AbilitySubject.PriceLevel, subjectId: id, metadata: { prices: prices.length }, trx });
    });
    return { imported: prices.length };
  }

  private assertPerItem(method: string) {
    if (method !== 'per_item') {
      throw new ServiceError(ERRORS.PRICE_LEVEL_INVALID, 'Only per-item price levels have item prices to export or import.');
    }
  }
}
