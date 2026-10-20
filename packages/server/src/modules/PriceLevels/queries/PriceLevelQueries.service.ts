import { Inject, Injectable } from '@nestjs/common';
import { Knex } from 'knex';
import * as moment from 'moment';
import { TenantModelProxy } from '@/modules/System/models/TenantBaseModel';
import { TenancyContext } from '@/modules/Tenancy/TenancyContext.service';
import { TENANCY_DB_CONNECTION } from '@/modules/Tenancy/TenancyDB/TenancyDB.constants';
import { PriceLevel } from '../models/PriceLevel.model';
import { GetPriceLevelsQueryDto, PriceLevelSalesReportQueryDto, ResolvePricesDto } from '../dtos/PriceLevel.dto';
import { PriceLevelValidator } from '../commands/PriceLevelValidator.service';
import { fromUnits, levelApplies, priceFor, PriceLevelRule, toUnits } from '../calc/price-level';
import { PriceLevelMethod, Rounding } from '../PriceLevels.types';

const dateOnly = (d: Date | string | null | undefined) =>
  d ? (typeof d === 'string' ? d.slice(0, 10) : moment(d).format('YYYY-MM-DD')) : null;

@Injectable()
export class PriceLevelQueriesService {
  constructor(
    private readonly validator: PriceLevelValidator,
    private readonly tenancyContext: TenancyContext,

    @Inject(PriceLevel.name)
    private readonly priceLevelModel: TenantModelProxy<typeof PriceLevel>,

    @Inject(TENANCY_DB_CONNECTION)
    private readonly tenantKnex: () => Knex,
  ) {}

  async getPriceLevels(filter: GetPriceLevelsQueryDto) {
    const query = this.priceLevelModel().query().orderBy('name');
    if (filter.type) query.where('type', filter.type);
    const active = filter.active ?? 'true';
    if (active !== 'all') query.where('active', active === 'true');
    if (filter.search) query.modify('search', filter.search);
    const levels = await query;
    const knex = this.tenantKnex();
    const ids = levels.map((l) => l.id);
    const [itemCounts, contactCounts] = ids.length
      ? await Promise.all([
          knex('price_level_items').whereIn('price_level_id', ids).groupBy('price_level_id').select('price_level_id').count({ count: '*' }),
          knex('contacts').whereIn('price_level_id', ids).groupBy('price_level_id').select('price_level_id').count({ count: '*' }),
        ])
      : [[], []];
    const countOf = (rows: any[], id: number) => Number(rows.find((r) => (r.priceLevelId ?? r.price_level_id) === id)?.count ?? 0);
    return levels.map((l) => ({
      ...this.toDto(l),
      itemPricesCount: countOf(itemCounts, l.id),
      contactsCount: countOf(contactCounts, l.id),
    }));
  }

  async getPriceLevel(id: number) {
    const level = await this.validator.getOrThrow(id);
    const knex = this.tenantKnex();
    const [items, categories] = await Promise.all([
      knex('price_level_items as pli')
        .join('items', 'items.id', 'pli.item_id')
        .where('pli.price_level_id', id)
        .orderBy([{ column: 'items.name' }, { column: 'pli.min_quantity' }])
        .select('pli.item_id', 'items.name', 'items.code', 'items.sell_price', 'items.cost_price', 'pli.min_quantity', 'pli.price'),
      knex('price_level_categories as plc')
        .join('items_categories as c', 'c.id', 'plc.category_id')
        .where('plc.price_level_id', id)
        .orderBy('c.name')
        .select('plc.category_id', 'c.name'),
    ]);
    return {
      ...this.toDto(level),
      categories: categories.map((c: any) => ({ id: c.categoryId ?? c.category_id, name: c.name })),
      items: items.map((r: any) => ({
        itemId: r.itemId ?? r.item_id,
        itemName: r.name,
        itemCode: r.code ?? null,
        standardPrice: Number((level.type === 'sales' ? r.sellPrice ?? r.sell_price : r.costPrice ?? r.cost_price) ?? 0),
        minQuantity: Number(r.minQuantity ?? r.min_quantity),
        price: Number(r.price),
      })),
    };
  }

  /**
   * The rates for document lines: the given price level, else the contact's
   * default one, else the normal item prices. A level that is inactive or
   * outside its dates on the document date gives the normal prices.
   */
  async resolve(dto: ResolvePricesDto) {
    const knex = this.tenantKnex();
    let levelId = dto.priceLevelId ?? null;
    if (!levelId && dto.contactId) {
      const contact = await knex('contacts').where('id', dto.contactId).first('price_level_id');
      levelId = contact ? contact.priceLevelId ?? contact.price_level_id ?? null : null;
    }
    const date = (dto.date ?? moment().format('YYYY-MM-DD')).slice(0, 10);
    const level = levelId ? await this.validator.getOrThrow(levelId) : null;
    if (level) await this.validator.validateUse(level.id, dto.type, level.id);
    const rule = level ? await this.ruleOf(level) : null;
    const applies = !!rule && levelApplies(rule, date);

    const itemIds = [...new Set(dto.lines.map((l) => l.itemId))];
    const items = itemIds.length
      ? await knex('items').whereIn('id', itemIds).select('id', 'sell_price', 'cost_price', 'category_id')
      : [];
    const byId = new Map(items.map((i: any) => [i.id, i]));
    const metadata = await this.tenancyContext.getTenantMetadata();

    return {
      priceLevelId: level?.id ?? null,
      priceLevelName: level?.name ?? null,
      applies,
      currencyCode: level?.currencyCode ?? metadata.baseCurrency,
      lines: dto.lines.map((line) => {
        const item: any = byId.get(line.itemId);
        const standard = toUnits(item ? (dto.type === 'sales' ? item.sellPrice ?? item.sell_price : item.costPrice ?? item.cost_price) : 0);
        const quantity = Number(line.quantity ?? 1);
        const priced = applies && item
          ? priceFor(rule!, { itemId: line.itemId, categoryId: item.categoryId ?? item.category_id, standard, quantity })
          : { rate: standard, source: 'standard' as const };
        return { itemId: line.itemId, quantity, standardRate: fromUnits(standard), rate: fromUnits(priced.rate), source: item ? priced.source : 'unknown_item' };
      }),
    };
  }

  /**
   * Sales by price level: delivered invoices and closed receipts that used a
   * price level, less open credit notes, per level, customer and item, in the
   * base currency. "Normal" is the quantity at the item's normal price when
   * the document was saved; "charged" is the quantity at the line rate.
   */
  async salesReport(query: PriceLevelSalesReportQueryDto) {
    const from = query.fromDate.slice(0, 10);
    const to = query.toDate.slice(0, 10);
    const docs = [
      { type: 'SaleInvoice', table: 'SALES_INVOICES', date: 'INVOICE_DATE', posted: 'DELIVERED_AT', sign: 1 },
      { type: 'SaleReceipt', table: 'SALES_RECEIPTS', date: 'RECEIPT_DATE', posted: 'CLOSED_AT', sign: 1 },
      { type: 'CreditNote', table: 'CREDIT_NOTES', date: 'CREDIT_NOTE_DATE', posted: 'OPENED_AT', sign: -1 },
    ];
    // Raw SQL bypasses the identifier mapper: tenant tables and columns are UPPER_SNAKE.
    const parts = docs.map(
      (d) => `SELECT D.PRICE_LEVEL_ID AS LEVEL_ID, D.CUSTOMER_ID AS CUSTOMER_ID, IE.ITEM_ID AS ITEM_ID,
          ${d.sign} * IE.QUANTITY AS QTY,
          ${d.sign} * IE.QUANTITY * COALESCE(IE.STANDARD_RATE, IE.RATE) * COALESCE(D.EXCHANGE_RATE, 1) AS NORMAL,
          ${d.sign} * IE.QUANTITY * IE.RATE * COALESCE(D.EXCHANGE_RATE, 1) AS CHARGED
        FROM ITEMS_ENTRIES IE JOIN ${d.table} D ON IE.REFERENCE_TYPE = '${d.type}' AND IE.REFERENCE_ID = D.ID
        WHERE D.PRICE_LEVEL_ID IS NOT NULL AND D.${d.posted} IS NOT NULL AND D.${d.date} BETWEEN ? AND ?
          ${query.priceLevelId ? 'AND D.PRICE_LEVEL_ID = ?' : ''}`,
    );
    const bindings = docs.flatMap(() => (query.priceLevelId ? [from, to, query.priceLevelId] : [from, to]));
    const result = await this.tenantKnex().raw(
      `SELECT T.LEVEL_ID, PL.NAME AS LEVEL_NAME, T.CUSTOMER_ID, C.DISPLAY_NAME AS CUSTOMER_NAME, T.ITEM_ID, I.NAME AS ITEM_NAME,
          SUM(T.QTY) AS QTY, SUM(T.NORMAL) AS NORMAL, SUM(T.CHARGED) AS CHARGED
        FROM (${parts.join(' UNION ALL ')}) T
        JOIN PRICE_LEVELS PL ON PL.ID = T.LEVEL_ID
        LEFT JOIN CONTACTS C ON C.ID = T.CUSTOMER_ID
        LEFT JOIN ITEMS I ON I.ID = T.ITEM_ID
        GROUP BY T.LEVEL_ID, PL.NAME, T.CUSTOMER_ID, C.DISPLAY_NAME, T.ITEM_ID, I.NAME
        ORDER BY PL.NAME, C.DISPLAY_NAME, I.NAME`,
      bindings,
    );
    const round = (n: unknown) => Math.round(Number(n ?? 0) * 100) / 100;
    const rows = (result[0] as any[]).map((r) => {
      // Raw rows keep the aliases (UPPER_SNAKE); accept a camelCased row too.
      const get = (key: string) => r[key] ?? r[key.toLowerCase().replace(/_([a-z])/g, (_m, c) => c.toUpperCase())];
      const normal = round(get('NORMAL'));
      const charged = round(get('CHARGED'));
      return {
        priceLevelId: Number(get('LEVEL_ID')),
        priceLevelName: get('LEVEL_NAME'),
        customerId: get('CUSTOMER_ID') == null ? null : Number(get('CUSTOMER_ID')),
        customerName: get('CUSTOMER_NAME') ?? null,
        itemId: get('ITEM_ID') == null ? null : Number(get('ITEM_ID')),
        itemName: get('ITEM_NAME') ?? null,
        quantity: Number(get('QTY') ?? 0),
        normalAmount: normal,
        chargedAmount: charged,
        difference: round(charged - normal),
      };
    });
    const total = rows.reduce(
      (t, r) => ({ normalAmount: round(t.normalAmount + r.normalAmount), chargedAmount: round(t.chargedAmount + r.chargedAmount) }),
      { normalAmount: 0, chargedAmount: 0 },
    );
    const metadata = await this.tenancyContext.getTenantMetadata();
    return {
      fromDate: from,
      toDate: to,
      currencyCode: metadata.baseCurrency,
      rows,
      total: { ...total, difference: round(total.chargedAmount - total.normalAmount) },
    };
  }

  private async ruleOf(level: PriceLevel): Promise<PriceLevelRule> {
    const knex = this.tenantKnex();
    const [items, categoryIds] = await Promise.all([
      knex('price_level_items').where('price_level_id', level.id).select('item_id', 'min_quantity', 'price'),
      knex('price_level_categories').where('price_level_id', level.id).pluck('category_id'),
    ]);
    return {
      method: level.method as PriceLevelMethod,
      percentage: level.percentage == null ? null : Number(level.percentage),
      rounding: level.rounding as Rounding,
      categoryIds: categoryIds.map(Number),
      items: items.map((i: any) => ({
        itemId: i.itemId ?? i.item_id,
        minQuantity: Number(i.minQuantity ?? i.min_quantity),
        price: toUnits(i.price),
      })),
      active: !!level.active,
      validFrom: dateOnly(level.validFrom),
      validTo: dateOnly(level.validTo),
    };
  }

  private toDto(l: PriceLevel) {
    return {
      id: l.id,
      name: l.name,
      description: l.description,
      type: l.type,
      method: l.method,
      percentage: l.percentage == null ? null : Number(l.percentage),
      currencyCode: l.currencyCode,
      rounding: l.rounding,
      validFrom: dateOnly(l.validFrom),
      validTo: dateOnly(l.validTo),
      active: !!l.active,
      createdAt: l.createdAt,
      updatedAt: l.updatedAt,
    };
  }
}
