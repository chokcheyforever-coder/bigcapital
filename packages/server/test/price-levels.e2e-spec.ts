import request = require('supertest');
import { faker } from '@faker-js/faker';
import { app } from './init-app-test';
import {
  authHeaders,
  cancelTransactionsLock,
  createCustomer,
  createVendor,
  expectBalanced,
  fetchLegs,
  getBaseCurrency,
  sumCredits,
} from './_utils/gl';

/**
 * Price levels (DiTech, docs/ditech/pricing/price-levels-design.md).
 * The fixture of design §6: Laptop 900 (cost 650, in a category), Printer ink
 * 25 (cost 12). Resolved rates must match the formula; documents keep the
 * rates they were given, record the normal price per line, and post as usual.
 */
describe('Price levels (e2e)', () => {
  const http = () => request(app.getHttpServer());
  const DATE = '2026-11-15';
  const run = faker.string.alphanumeric(6);

  let customerId: number;
  let vendorId: number;
  let categoryId: number;
  let laptop: number;
  let ink: number;

  const createItem = async (name: string, sellPrice: number, costPrice: number, extra: Record<string, any> = {}) => {
    const res = await http()
      .post('/items')
      .set(authHeaders())
      .send({ name: `${name} ${run}`, type: 'service', sellable: true, purchasable: true, sellAccountId: 1026, costAccountId: 1019, sellPrice, costPrice, ...extra })
      .expect(201);
    return Number(res.body.id);
  };

  const createLevel = (body: Record<string, any>) =>
    http().post('/price-levels').set(authHeaders()).send({ name: `Level ${faker.string.alphanumeric(8)}`, type: 'sales', ...body });

  const resolve = (body: Record<string, any>) => http().post('/price-levels/resolve').set(authHeaders()).send({ type: 'sales', date: DATE, ...body });

  const rates = (res: request.Response) => res.body.lines.map((l) => [l.rate, l.source]);

  const invoice = (body: Record<string, any>) =>
    http()
      .post('/sale-invoices')
      .set(authHeaders())
      .send({ customerId, invoiceDate: DATE, dueDate: DATE, invoiceNo: faker.string.uuid(), delivered: true, branchId: 1, warehouseId: 1, ...body });

  beforeAll(async () => {
    await cancelTransactionsLock();
    const baseCurrency = await getBaseCurrency();
    customerId = await createCustomer(baseCurrency);
    vendorId = await createVendor(baseCurrency);
    const category = await http().post('/item-categories').set(authHeaders()).send({ name: `Computers ${run}` }).expect(201);
    categoryId = Number(category.body.id);
    laptop = await createItem('Laptop', 900, 650, { categoryId });
    ink = await createItem('Printer ink', 25, 12);
  });

  describe('setting up', () => {
    it('creates a percentage level and a per-item level with quantity breaks', async () => {
      const pct = await createLevel({ method: 'percentage', percentage: -15, rounding: 'x.99', description: 'Wholesale' }).expect(201);
      expect(pct.body).toMatchObject({ type: 'sales', method: 'percentage', percentage: -15, rounding: 'x.99', active: true, items: [], categories: [] });

      const perItem = await createLevel({
        method: 'per_item',
        items: [
          { itemId: ink, price: 10 },
          { itemId: ink, minQuantity: 10, price: 8 },
          { itemId: ink, minQuantity: 50, price: 7 },
          { itemId: laptop, price: 850 },
        ],
      }).expect(201);
      expect(perItem.body.items.map((i) => [i.item_id, i.min_quantity, i.price, i.standard_price])).toEqual(
        expect.arrayContaining([[ink, 1, 10, 25], [ink, 10, 8, 25], [ink, 50, 7, 25], [laptop, 1, 850, 900]]),
      );

      const list = await http().get('/price-levels').query({ type: 'sales', search: perItem.body.name }).set(authHeaders()).expect(200);
      expect(list.body).toEqual([expect.objectContaining({ id: perItem.body.id, item_prices_count: 4, contacts_count: 0 })]);
    });

    it('refuses bad levels', async () => {
      const name = `Dup ${run}`;
      await createLevel({ name, method: 'percentage', percentage: 5 }).expect(201);
      expect((await createLevel({ name, method: 'percentage', percentage: 5 }).expect(400)).body.errors[0].type).toBe('PRICE_LEVEL_NAME_EXISTS');
      const twice = await createLevel({ method: 'per_item', items: [{ itemId: ink, price: 1 }, { itemId: ink, minQuantity: 1, price: 2 }] }).expect(400);
      expect(twice.body.errors[0].type).toBe('PRICE_LEVEL_INVALID');
      await createLevel({ method: 'per_item', categoryIds: [categoryId] }).expect(400);
      await createLevel({ method: 'percentage', percentage: 5, validFrom: '2026-12-01', validTo: '2026-11-01' }).expect(400);
      await createLevel({ method: 'per_item', items: [{ itemId: 99999999, price: 1 }] }).expect(400);
      await createLevel({ method: 'flat', percentage: 5 }).expect(400);
    });
  });

  describe('resolving rates (design §6 fixture)', () => {
    it('percentage -15%, prices ending in .99', async () => {
      const level = (await createLevel({ method: 'percentage', percentage: -15, rounding: 'x.99' }).expect(201)).body;
      const res = await resolve({ priceLevelId: level.id, lines: [{ itemId: laptop }, { itemId: ink, quantity: 3 }] }).expect(200);
      expect(res.body).toMatchObject({ price_level_id: level.id, applies: true });
      expect(rates(res)).toEqual([[764.99, 'percentage'], [20.99, 'percentage']]);
      expect(res.body.lines.map((l) => l.standard_rate)).toEqual([900, 25]);
    });

    it('a category-limited percentage leaves other items at the normal price', async () => {
      const level = (await createLevel({ method: 'percentage', percentage: -15, categoryIds: [categoryId] }).expect(201)).body;
      expect(level.categories).toEqual([expect.objectContaining({ id: categoryId })]);
      const res = await resolve({ priceLevelId: level.id, lines: [{ itemId: laptop }, { itemId: ink }] }).expect(200);
      expect(rates(res)).toEqual([[765, 'percentage'], [25, 'standard']]);
    });

    it('per-item prices with quantity breaks', async () => {
      const level = (
        await createLevel({ method: 'per_item', items: [{ itemId: ink, price: 10 }, { itemId: ink, minQuantity: 10, price: 8 }, { itemId: ink, minQuantity: 50, price: 7 }] }).expect(201)
      ).body;
      const res = await resolve({ priceLevelId: level.id, lines: [1, 9, 10, 49, 50].map((quantity) => ({ itemId: ink, quantity })).concat([{ itemId: laptop, quantity: 1 }]) }).expect(200);
      expect(rates(res)).toEqual([[10, 'item_price'], [10, 'item_price'], [8, 'quantity_break'], [8, 'quantity_break'], [7, 'quantity_break'], [900, 'standard']]);
    });

    it('uses the contact\'s default level; normal prices when inactive or outside its dates', async () => {
      const level = (await createLevel({ method: 'percentage', percentage: 10, rounding: '1', validFrom: '2026-11-01', validTo: '2026-11-30' }).expect(201)).body;
      const customer = await createCustomer(await getBaseCurrency());
      await http().post(`/price-levels/${level.id}/assign`).set(authHeaders()).send({ contactIds: [customer] }).expect(200);
      const byContact = await resolve({ contactId: customer, lines: [{ itemId: laptop }] }).expect(200);
      expect(byContact.body).toMatchObject({ price_level_id: level.id, applies: true });
      expect(rates(byContact)).toEqual([[990, 'percentage']]);

      const december = await resolve({ contactId: customer, date: '2026-12-01', lines: [{ itemId: laptop }] }).expect(200);
      expect(december.body.applies).toBe(false);
      expect(rates(december)).toEqual([[900, 'standard']]);

      await http().put(`/price-levels/${level.id}`).set(authHeaders()).send({ name: level.name, type: 'sales', method: 'percentage', percentage: 10, active: false }).expect(200);
      const inactive = await resolve({ contactId: customer, lines: [{ itemId: laptop }] }).expect(200);
      expect(rates(inactive)).toEqual([[900, 'standard']]);
    });

    it('purchase levels price from the cost; types cannot be mixed', async () => {
      const level = (await createLevel({ type: 'purchase', method: 'per_item', items: [{ itemId: laptop, price: 600 }] }).expect(201)).body;
      const res = await resolve({ type: 'purchase', priceLevelId: level.id, lines: [{ itemId: laptop }, { itemId: ink }] }).expect(200);
      expect(rates(res)).toEqual([[600, 'item_price'], [12, 'standard']]);
      expect((await resolve({ type: 'sales', priceLevelId: level.id, lines: [{ itemId: laptop }] }).expect(400)).body.errors[0].type).toBe('PRICE_LEVEL_WRONG_TYPE');
    });
  });

  describe('customers, vendors and documents', () => {
    let wholesale: any;
    let buying: any;

    beforeAll(async () => {
      wholesale = (await createLevel({ method: 'percentage', percentage: -15, rounding: 'x.99' }).expect(201)).body;
      buying = (await createLevel({ type: 'purchase', method: 'per_item', items: [{ itemId: laptop, price: 600 }] }).expect(201)).body;
    });

    it('a customer takes a sales level, a vendor a purchase level', async () => {
      const ok = await http().post('/customers').set(authHeaders()).send({ displayName: `PL Customer ${run}`, customerType: 'business', currencyCode: await getBaseCurrency(), priceLevelId: wholesale.id }).expect(201);
      const customer = await http().get(`/customers/${ok.body.id}`).set(authHeaders()).expect(200);
      expect(customer.body.price_level_id).toBe(wholesale.id);

      const wrong = await http().post('/vendors').set(authHeaders()).send({ displayName: `PL Vendor ${run}`, currencyCode: await getBaseCurrency(), priceLevelId: wholesale.id }).expect(400);
      expect(wrong.body.errors[0].type).toBe('PRICE_LEVEL_WRONG_TYPE');
      await http().post('/vendors').set(authHeaders()).send({ displayName: `PL Vendor ${run}`, currencyCode: await getBaseCurrency(), priceLevelId: buying.id }).expect(201);
    });

    it('an invoice keeps the price-level rates, records the normal price per line and posts them', async () => {
      const res = await resolve({ priceLevelId: wholesale.id, lines: [{ itemId: laptop, quantity: 2 }, { itemId: ink, quantity: 4 }] }).expect(200);
      const entries = res.body.lines.map((l, i) => ({ index: i + 1, itemId: l.item_id, quantity: l.quantity, rate: l.rate }));
      const created = await invoice({ priceLevelId: wholesale.id, entries }).expect(201);

      const saved = await http().get(`/sale-invoices/${created.body.id}`).set(authHeaders()).expect(200);
      expect(saved.body.price_level_id).toBe(wholesale.id);
      expect(saved.body.entries.map((e) => [Number(e.rate), Number(e.standard_rate)])).toEqual([[764.99, 900], [20.99, 25]]);

      const legs = await fetchLegs('SaleInvoice', created.body.id);
      expectBalanced(legs);
      // 2 x 764.99 + 4 x 20.99 = 1,613.94 of income.
      expect(sumCredits(legs)).toBeCloseTo(1613.94, 2);
    });

    it('Sales by price level equals the sales on those invoices', async () => {
      const res = await http()
        .get('/price-levels/reports/sales')
        .query({ fromDate: '2026-01-01', toDate: '2026-12-31', priceLevelId: wholesale.id })
        .set(authHeaders())
        .expect(200);
      // The invoice above: 2 laptops at 764.99 (normal 900) and 4 ink at 20.99 (normal 25).
      expect(res.body.total).toEqual({ normal_amount: 1900, charged_amount: 1613.94, difference: -286.06 });
      expect(res.body.rows.map((r) => [r.item_id, r.quantity, r.charged_amount])).toEqual(
        expect.arrayContaining([[laptop, 2, 1529.98], [ink, 4, 83.96]]),
      );
    });

    it('a document without a level has no normal price recorded', async () => {
      const created = await invoice({ entries: [{ index: 1, itemId: laptop, quantity: 1, rate: 900 }] }).expect(201);
      const saved = await http().get(`/sale-invoices/${created.body.id}`).set(authHeaders()).expect(200);
      expect(saved.body.price_level_id).toBeNull();
      expect(saved.body.entries[0].standard_rate).toBeNull();
    });

    it('refuses a purchase level on an invoice and a sales level on a bill', async () => {
      const inv = await invoice({ priceLevelId: buying.id, entries: [{ index: 1, itemId: laptop, quantity: 1, rate: 600 }] }).expect(400);
      expect(inv.body.errors[0].type).toBe('PRICE_LEVEL_WRONG_TYPE');
      const bill = await http()
        .post('/bills')
        .set(authHeaders())
        .send({ vendorId, billDate: DATE, dueDate: DATE, billNumber: faker.string.uuid(), open: true, branchId: 1, warehouseId: 1, priceLevelId: wholesale.id, entries: [{ index: 1, itemId: laptop, quantity: 1, rate: 600 }] })
        .expect(400);
      expect(bill.body.errors[0].type).toBe('PRICE_LEVEL_WRONG_TYPE');
    });

    it('a bill with a purchase level records the normal cost price', async () => {
      const created = await http()
        .post('/bills')
        .set(authHeaders())
        .send({ vendorId, billDate: DATE, dueDate: DATE, billNumber: faker.string.uuid(), open: true, branchId: 1, warehouseId: 1, priceLevelId: buying.id, entries: [{ index: 1, itemId: laptop, quantity: 1, rate: 600 }] })
        .expect(201);
      const saved = await http().get(`/bills/${created.body.id}`).set(authHeaders()).expect(200);
      expect(saved.body.price_level_id).toBe(buying.id);
      expect(Number(saved.body.entries[0].standard_rate)).toBe(650);
    });

    it('an inactive level is refused on new documents but kept on old ones; a used level cannot be deleted', async () => {
      const level = (await createLevel({ method: 'percentage', percentage: -5 }).expect(201)).body;
      const entries = [{ index: 1, itemId: ink, quantity: 1, rate: 23.75 }];
      const created = await invoice({ priceLevelId: level.id, entries }).expect(201);

      await http().put(`/price-levels/${level.id}`).set(authHeaders()).send({ name: level.name, type: 'sales', method: 'percentage', percentage: -5, active: false }).expect(200);
      expect((await invoice({ priceLevelId: level.id, entries }).expect(400)).body.errors[0].type).toBe('PRICE_LEVEL_INACTIVE');
      await http()
        .put(`/sale-invoices/${created.body.id}`)
        .set(authHeaders())
        .send({ customerId, invoiceDate: DATE, dueDate: DATE, invoiceNo: faker.string.uuid(), delivered: true, branchId: 1, warehouseId: 1, priceLevelId: level.id, entries })
        .expect(200);

      expect((await http().delete(`/price-levels/${level.id}`).set(authHeaders()).expect(400)).body.errors[0].type).toBe('PRICE_LEVEL_IN_USE');
      const unused = (await createLevel({ method: 'percentage', percentage: 1 }).expect(201)).body;
      await http().delete(`/price-levels/${unused.id}`).set(authHeaders()).expect(200);
      await http().get(`/price-levels/${unused.id}`).set(authHeaders()).expect(404);
    });
  });
});
