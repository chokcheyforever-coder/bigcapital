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
  GLTestLeg,
} from './_utils/gl';

const byName = (legs: GLTestLeg[], name: string) => legs.filter((l) => l.accountName === name);
const debit = (legs: GLTestLeg[]) => legs.reduce((s, l) => s + Number(l.debit.amount), 0);
const credit = (legs: GLTestLeg[]) => legs.reduce((s, l) => s + Number(l.credit.amount), 0);

/**
 * VAT, Specific Tax and PLT on credit notes and vendor credits (DiTech
 * compliance gaps G2): a credit reverses the taxes of the sale or purchase,
 * can be used up to its total with tax, and shows in the VAT books.
 */
describe('Credit note and vendor credit taxes (e2e)', () => {
  const http = () => request(app.getHttpServer());
  const MONTH = '2032-06';
  let customerId: number;
  let vendorId: number;
  let itemId: number;
  let exciseItemId: number;
  let vat10: number;
  let wine: any;
  let winePrevItems: number[] = [];

  beforeAll(async () => {
    await cancelTransactionsLock();
    const currency = await getBaseCurrency();
    vat10 = await createTaxRate(10);
    itemId = await createServiceItem();
    exciseItemId = await createServiceItem();
    customerId = (
      await http()
        .post('/customers')
        .set(authHeaders())
        .send({ displayName: `Credit Taxes ${faker.string.alphanumeric(6)}`, customerType: 'business', currencyCode: currency, taxNumber: 'K001-555111444', registeredTaxpayer: true })
        .expect(201)
    ).body.id;
    vendorId = await createVendor(currency);

    const codes = (await http().get('/tax-compliance/excise-codes').set(authHeaders()).expect(200)).body;
    wine = codes.find((c) => c.code === 'ST-ALCOHOL');
    winePrevItems = wine.item_ids;
    await http()
      .put(`/tax-compliance/excise-codes/${wine.id}/items`)
      .set(authHeaders())
      .send({ item_ids: [...winePrevItems, exciseItemId] })
      .expect(200);
  });

  afterAll(async () => {
    await http().put(`/tax-compliance/excise-codes/${wine.id}/items`).set(authHeaders()).send({ item_ids: winePrevItems }).expect(200);
  });

  const createCreditNote = (entries: any[], extra: Record<string, any> = {}) =>
    http()
      .post('/credit-notes')
      .set(authHeaders())
      .send({ customerId, creditNoteDate: `${MONTH}-05`, creditNoteNumber: faker.string.uuid(), open: true, branchId: 1, warehouseId: 1, entries, ...extra });

  it('reverses output VAT and can be applied up to its total with VAT', async () => {
    const id = (await createCreditNote([{ index: 1, itemId, quantity: 1, rate: 100, taxRateId: vat10 }]).expect(201)).body.id;

    const note = (await http().get(`/credit-notes/${id}`).set(authHeaders()).expect(200)).body;
    expect(Number(note.tax_amount_withheld)).toBeCloseTo(10, 2);
    expect(Number(note.total)).toBeCloseTo(110, 2);
    expect(Number(note.credits_remaining)).toBeCloseTo(110, 2);
    expect(note.tax_lines).toEqual([expect.objectContaining({ kind: 'vat', rate: 10, amount: 10 })]);

    const legs = await fetchLegs('CreditNote', id);
    expectBalanced(legs);
    expect(debit(byName(legs, 'Tax Payable'))).toBeCloseTo(10, 2);
    expect(credit(legs.filter((l) => l.contactId === customerId))).toBeCloseTo(110, 2);

    const invoiceId = (
      await http()
        .post('/sale-invoices')
        .set(authHeaders())
        .send({
          customerId, invoiceDate: `${MONTH}-02`, dueDate: `${MONTH}-30`, invoiceNo: faker.string.uuid(), delivered: true,
          branchId: 1, warehouseId: 1, entries: [{ index: 1, itemId, quantity: 1, rate: 500, taxRateId: vat10 }],
        })
        .expect(201)
    ).body.id;
    await http()
      .post(`/credit-notes/${id}/apply-invoices`)
      .set(authHeaders())
      .send({ entries: [{ invoiceId, amount: 110 }] })
      .expect(201);
    const after = (await http().get(`/credit-notes/${id}`).set(authHeaders()).expect(200)).body;
    expect(Number(after.credits_remaining)).toBe(0);
  });

  it('keeps VAT inside the prices of a tax-inclusive credit note', async () => {
    const id = (await createCreditNote([{ index: 1, itemId, quantity: 1, rate: 110, taxRateId: vat10 }], { isInclusiveTax: true }).expect(201)).body.id;
    const note = (await http().get(`/credit-notes/${id}`).set(authHeaders()).expect(200)).body;
    expect(Number(note.total)).toBeCloseTo(110, 2);
    expect(Number(note.tax_amount_withheld)).toBeCloseTo(10, 2);

    const legs = await fetchLegs('CreditNote', id);
    expectBalanced(legs);
    expect(debit(byName(legs, 'Tax Payable'))).toBeCloseTo(10, 2);
  });

  it('reverses Specific Tax to its payable account, before VAT', async () => {
    // 100 + Specific Tax 35% 35 + VAT (135 × 10%) 13.50
    const id = (await createCreditNote([{ index: 1, itemId: exciseItemId, quantity: 1, rate: 100, taxRateId: vat10 }]).expect(201)).body.id;
    const note = (await http().get(`/credit-notes/${id}`).set(authHeaders()).expect(200)).body;
    expect(Number(note.excise_amount)).toBeCloseTo(Number(wine.rate), 2);
    expect(Number(note.total)).toBeCloseTo((100 + Number(wine.rate)) * 1.1, 2);

    const legs = await fetchLegs('CreditNote', id);
    expectBalanced(legs);
    expect(debit(byName(legs, 'Specific Tax Payable'))).toBeCloseTo(Number(wine.rate), 2);
  });

  it('refuses to edit a credit below what was already used, counting VAT', async () => {
    const id = (await createCreditNote([{ index: 1, itemId, quantity: 1, rate: 100, taxRateId: vat10 }]).expect(201)).body.id;
    await http()
      .post(`/credit-notes/${id}/refunds`)
      .set(authHeaders())
      .send({ date: `${MONTH}-06`, amount: 105, fromAccountId: 1000, referenceNo: faker.string.alphanumeric(6), description: 'Refund', branchId: 1 })
      .expect((res) => expect([200, 201]).toContain(res.status));

    // Without VAT the credit would be 100, below the 105 refunded.
    await http()
      .put(`/credit-notes/${id}`)
      .set(authHeaders())
      .send({ customerId, creditNoteDate: `${MONTH}-05`, branchId: 1, warehouseId: 1, entries: [{ index: 1, itemId, quantity: 1, rate: 100 }] })
      .expect(400);
  });

  it('rejects an unknown tax rate', async () => {
    await createCreditNote([{ index: 1, itemId, quantity: 1, rate: 100, taxRateId: 987654 }]).expect(400);
  });

  it('reverses input VAT on a vendor credit', async () => {
    const id = (
      await http()
        .post('/vendor-credits')
        .set(authHeaders())
        .send({
          vendorId, exchangeRate: 1, vendorCreditDate: `${MONTH}-07`, vendorCreditNumber: faker.string.uuid(), open: true, branchId: 1, warehouseId: 1,
          entries: [{ index: 1, itemId, quantity: 1, rate: 40, taxRateId: vat10 }],
        })
        .expect(201)
    ).body.id;
    const vc = (await http().get(`/vendor-credits/${id}`).set(authHeaders()).expect(200)).body;
    expect(Number(vc.total)).toBeCloseTo(44, 2);
    expect(Number(vc.credits_remaining)).toBeCloseTo(44, 2);

    const legs = await fetchLegs('VendorCredit', id);
    expectBalanced(legs);
    expect(credit(byName(legs, 'Tax Payable'))).toBeCloseTo(4, 2);
    expect(debit(legs.filter((l) => l.contactId === vendorId))).toBeCloseTo(44, 2);

    const purchases = (await http().get('/tax-compliance/vat-books/purchases').query({ month: MONTH }).set(authHeaders()).expect(200)).body;
    expect(purchases.find((r) => r.type === 'vendor_credit' && r.id === id)).toMatchObject({ taxable: -40, vat: -4, total: -44 });
  });

  it('puts the credit notes VAT in the sales book as negative output VAT', async () => {
    const sales = (await http().get('/tax-compliance/vat-books/sales').query({ month: MONTH }).set(authHeaders()).expect(200)).body;
    const notes = sales.filter((r) => r.type === 'credit_note');
    expect(notes.length).toBeGreaterThanOrEqual(4);
    expect(notes.every((r) => r.vat < 0 && r.total < 0)).toBe(true);
  });
});
