import request = require('supertest');
import { faker } from '@faker-js/faker';
import { app } from './init-app-test';
import {
  authHeaders,
  cancelTransactionsLock,
  createCustomer,
  createServiceItem,
  createTaxRate,
  expectBalanced,
  fetchLegs,
  getBaseCurrency,
} from './_utils/gl';

/**
 * Specific Tax and Public Lighting Tax (DiTech part C1, shared pdf-templates
 * ExciseTax.ts): charged on invoice lines before VAT from the item's codes,
 * posted to each code's payable account, printed above VAT, and kept at the
 * rates the invoice was saved with.
 */
describe('Specific Tax and PLT (e2e)', () => {
  const http = () => request(app.getHttpServer());
  let customerId: number;
  let itemId: number;
  let vat10: number;
  let wine: any;
  let plt: any;

  const codes = async () => (await http().get('/tax-compliance/excise-codes').set(authHeaders()).expect(200)).body as any[];

  const createInvoice = (overrides: Record<string, any> = {}) =>
    http()
      .post('/sale-invoices')
      .set(authHeaders())
      .send({
        customerId,
        invoiceDate: '2026-11-20',
        dueDate: '2026-11-30',
        invoiceNo: faker.string.uuid(),
        delivered: true,
        branchId: 1,
        warehouseId: 1,
        entries: [{ index: 1, itemId, quantity: 1, rate: 200, taxRateId: vat10 }],
        ...overrides,
      });

  beforeAll(async () => {
    await cancelTransactionsLock();
    customerId = await createCustomer(await getBaseCurrency());
    itemId = await createServiceItem();
    vat10 = await createTaxRate(10);

    const list = await codes();
    wine = list.find((c) => c.code === 'ST-ALCOHOL');
    plt = list.find((c) => c.code === 'PLT');
    await http().put(`/tax-compliance/excise-codes/${wine.id}/items`).set(authHeaders()).send({ item_ids: [itemId] }).expect(200);
    await http().put(`/tax-compliance/excise-codes/${plt.id}/items`).set(authHeaders()).send({ item_ids: [itemId] }).expect(200);
  });

  afterAll(async () => {
    await http().put(`/tax-compliance/excise-codes/${wine.id}`).set(authHeaders()).send({ rate: 35 }).expect(200);
    await http().put(`/tax-compliance/excise-codes/${wine.id}/items`).set(authHeaders()).send({ item_ids: [] }).expect(200);
    await http().put(`/tax-compliance/excise-codes/${plt.id}/items`).set(authHeaders()).send({ item_ids: [] }).expect(200);
  });

  it('starts with codes of each kind, each with a payable account', async () => {
    const list = await codes();
    expect(list.map((c) => c.kind)).toEqual(expect.arrayContaining(['specific', 'accommodation', 'plt']));
    expect(list.every((c) => c.account_id)).toBe(true);
    expect(list.find((c) => c.id === wine.id)).toMatchObject({ rate: 35, base_percent: 100, item_ids: [itemId] });
  });

  it('charges Specific Tax and PLT before VAT and posts them to their accounts', async () => {
    const res = await createInvoice().expect(201);
    const id = res.body.id;

    // 200 + Specific Tax 70 + PLT (270 × 3%) 8.10 + VAT (278.10 × 10%) 27.81
    const invoice = (await http().get(`/sale-invoices/${id}`).set(authHeaders()).expect(200)).body;
    expect(Number(invoice.excise_amount)).toBeCloseTo(78.1, 2);
    expect(Number(invoice.tax_amount_withheld)).toBeCloseTo(27.81, 2);
    expect(Number(invoice.total)).toBeCloseTo(305.91, 2);
    expect(invoice.excise_taxes.map((t) => [t.code, t.rate, Number(t.amount.toFixed(2))])).toEqual([
      ['ST-ALCOHOL', 35, 70],
      ['PLT', 3, 8.1],
    ]);

    const legs = await fetchLegs('SaleInvoice', id);
    expectBalanced(legs);
    const credit = (accountId: number) => legs.filter((l) => l.accountId === accountId).reduce((s, l) => s + Number(l.credit.amount), 0);
    expect(credit(wine.account_id)).toBeCloseTo(70, 2);
    expect(credit(plt.account_id)).toBeCloseTo(8.1, 2);
    const receivable = legs.find((l) => l.contactId === customerId);
    expect(Number(receivable!.debit.amount)).toBeCloseTo(305.91, 2);

    const html = await http().get(`/sale-invoices/${id}`).set(authHeaders()).set('accept', 'application/json+html').expect(200);
    const content: string = html.body.html_content ?? html.body.htmlContent;
    expect(content).toContain('Specific Tax – wine and spirits [35%]');
    expect(content).toContain('Public Lighting Tax [3%]');
  });

  it('keeps the rates an invoice was saved with when a code changes', async () => {
    const id = (await createInvoice().expect(201)).body.id;
    await http().put(`/tax-compliance/excise-codes/${wine.id}`).set(authHeaders()).send({ rate: 50 }).expect(200);
    try {
      const before = (await http().get(`/sale-invoices/${id}`).set(authHeaders()).expect(200)).body;
      expect(Number(before.total)).toBeCloseTo(305.91, 2);

      // A new invoice uses the new rate: 200 + 100 + 9 + 30.9
      const after = (await createInvoice().expect(201)).body.id;
      const invoice = (await http().get(`/sale-invoices/${after}`).set(authHeaders()).expect(200)).body;
      expect(Number(invoice.total)).toBeCloseTo(339.9, 2);
    } finally {
      // Retries run the other tests again: leave the rate as they expect it.
      await http().put(`/tax-compliance/excise-codes/${wine.id}`).set(authHeaders()).send({ rate: 35 }).expect(200);
    }
  });

  it('refuses tax-inclusive prices for items with these taxes', async () => {
    const res = await createInvoice({ isInclusiveTax: true }).expect(400);
    expect(res.body.errors?.[0]?.type).toBe('EXCISE_TAX_INCLUSIVE_UNSUPPORTED');
  });

  it('leaves invoices without these items unchanged', async () => {
    const plainItem = await createServiceItem();
    const id = (await createInvoice({ entries: [{ index: 1, itemId: plainItem, quantity: 1, rate: 200, taxRateId: vat10 }] }).expect(201)).body.id;
    const invoice = (await http().get(`/sale-invoices/${id}`).set(authHeaders()).expect(200)).body;
    expect(Number(invoice.excise_amount)).toBe(0);
    expect(Number(invoice.total)).toBeCloseTo(220, 2);
  });
});
