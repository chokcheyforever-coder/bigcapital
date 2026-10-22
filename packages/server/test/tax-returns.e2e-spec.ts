import request = require('supertest');
import { faker } from '@faker-js/faker';
import { app } from './init-app-test';
import {
  authHeaders,
  cancelTransactionsLock,
  createServiceItem,
  createTaxRate,
  createVendor,
  expectBalanced,
  fetchLegs,
  getBaseCurrency,
} from './_utils/gl';

/**
 * Monthly tax returns (DiTech part C3): the VAT books of a month, the return
 * worksheet, and the 1% prepayment of tax on income posted once.
 */
describe('Tax returns (e2e)', () => {
  const http = () => request(app.getHttpServer());
  const MONTH = '2032-03';
  let invoiceId: number;
  let billId: number;

  beforeAll(async () => {
    await cancelTransactionsLock();
    const currency = await getBaseCurrency();
    const vat10 = await createTaxRate(10);
    const itemId = await createServiceItem();
    const customerId = (
      await http()
        .post('/customers')
        .set(authHeaders())
        .send({ displayName: `Returns Buyer ${faker.string.alphanumeric(6)}`, customerType: 'business', currencyCode: currency, taxNumber: 'K001-555111222', registeredTaxpayer: true })
        .expect(201)
    ).body.id;
    invoiceId = (
      await http()
        .post('/sale-invoices')
        .set(authHeaders())
        .send({
          customerId, invoiceDate: `${MONTH}-10`, dueDate: `${MONTH}-30`, invoiceNo: faker.string.uuid(), delivered: true, isInclusiveTax: false,
          branchId: 1, warehouseId: 1, entries: [{ index: 1, itemId, quantity: 1, rate: 1000, taxRateId: vat10 }],
        })
        .expect(201)
    ).body.id;
    const vendorId = await createVendor(currency);
    billId = (
      await http()
        .post('/bills')
        .set(authHeaders())
        .send({
          vendorId, billDate: `${MONTH}-12`, dueDate: `${MONTH}-30`, billNumber: faker.string.alphanumeric(10), open: true, isInclusiveTax: false,
          whtCodeId: null, branchId: 1, warehouseId: 1, entries: [{ index: 1, itemId, quantity: 1, rate: 400, taxRateId: vat10 }],
        })
        .expect(201)
    ).body.id;
  });

  it('lists the month in the sales and purchase books', async () => {
    const sales = (await http().get('/tax-compliance/vat-books/sales').query({ month: MONTH }).set(authHeaders()).expect(200)).body;
    const inv = sales.find((r) => r.type === 'invoice' && r.id === invoiceId);
    expect(inv).toMatchObject({ party: 'taxpayer', party_tin: 'K001-555111222', taxable: 1000, vat: 100, total: 1100 });

    const purchases = (await http().get('/tax-compliance/vat-books/purchases').query({ month: MONTH }).set(authHeaders()).expect(200)).body;
    expect(purchases.find((r) => r.id === billId)).toMatchObject({ taxable: 400, vat: 40, total: 440 });

    await http().get('/tax-compliance/vat-books/other').query({ month: MONTH }).set(authHeaders()).expect(400);
  });

  it('nets the VAT and works out the 1% prepayment', async () => {
    const sheet = (await http().get('/tax-compliance/returns/worksheet').query({ month: MONTH }).set(authHeaders()).expect(200)).body;
    expect(sheet.vat).toMatchObject({ output_vat: 100, input_vat: 40, payable: 60 });
    expect(sheet.prepayment).toMatchObject({ turnover: 1000, rate: 1, amount: 10, posted: null });
    expect(sheet.due_date).toBe('2032-04-20');
  });

  it('posts the prepayment once, as a balanced journal', async () => {
    const first = (await http().post('/tax-compliance/returns/prepayment').query({ month: MONTH }).set(authHeaders()).expect(200)).body;
    expect(first.amount).toBe(10);
    const again = (await http().post('/tax-compliance/returns/prepayment').query({ month: MONTH }).set(authHeaders()).expect(200)).body;
    expect(again.journal_id).toBe(first.journal_id);

    const legs = await fetchLegs('Journal', first.journal_id);
    expectBalanced(legs);
    expect(legs.reduce((s, l) => s + Number(l.debit.amount), 0)).toBeCloseTo(10, 2);

    const sheet = (await http().get('/tax-compliance/returns/worksheet').query({ month: MONTH }).set(authHeaders()).expect(200)).body;
    expect(sheet.prepayment.posted).toMatchObject({ journal_id: first.journal_id, amount: 10 });
  });

  it('exports both books as an Excel workbook', async () => {
    const res = await http().get('/tax-compliance/vat-books-export').query({ month: MONTH }).set(authHeaders()).buffer(true).expect(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toContain(`VAT-books-${MONTH}.xlsx`);
  });
});
