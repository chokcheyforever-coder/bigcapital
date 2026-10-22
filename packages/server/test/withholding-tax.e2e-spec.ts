import request = require('supertest');
import { faker } from '@faker-js/faker';
import { app } from './init-app-test';
import {
  authHeaders,
  cancelTransactionsLock,
  createServiceItem,
  expectBalanced,
  fetchLegs,
  getBaseCurrency,
} from './_utils/gl';
import { fetchAccountsByCode } from './_utils/balance-sheet';

/**
 * Withholding tax (DiTech part C2): a bill or expense keeps back the tax from
 * the vendor and posts it to Withholding Tax Payable; the month's report and
 * the vendor's certificate list it.
 */
describe('Withholding tax (e2e)', () => {
  const http = () => request(app.getHttpServer());
  const MONTH = '2026-11';
  let vendorId: number;
  let vendorName: string;
  let itemId: number;
  let expenseAccountId: number;
  let rent: any;
  let service: any;

  const createBill = (overrides: Record<string, any> = {}) =>
    http()
      .post('/bills')
      .set(authHeaders())
      .send({
        vendorId,
        billDate: `${MONTH}-05`,
        dueDate: `${MONTH}-30`,
        billNumber: faker.string.alphanumeric(10),
        open: true,
        branchId: 1,
        warehouseId: 1,
        entries: [{ index: 1, itemId, quantity: 1, rate: 1000 }],
        ...overrides,
      });

  beforeAll(async () => {
    await cancelTransactionsLock();
    const codes = (await http().get('/tax-compliance/wht-codes').set(authHeaders()).expect(200)).body;
    rent = codes.find((c) => c.code === 'WHT-RENT');
    service = codes.find((c) => c.code === 'WHT-SERVICE');

    vendorName = `WHT Landlord ${faker.string.alphanumeric(6)}`;
    vendorId = (
      await http()
        .post('/vendors')
        .set(authHeaders())
        .send({ displayName: vendorName, currencyCode: await getBaseCurrency(), taxNumber: 'K001-777000111', defaultWhtCodeId: rent.id })
        .expect(201)
    ).body.id;
    itemId = await createServiceItem();
    const accounts = await fetchAccountsByCode();
    expenseAccountId = (Object.values(accounts).find((a: any) => a.accountType === 'expense') as any).id;
  });

  it('starts with codes by payment type, each with a payable account', async () => {
    const codes = (await http().get('/tax-compliance/wht-codes').set(authHeaders()).expect(200)).body;
    expect(codes.map((c) => [c.code, c.rate])).toEqual(
      expect.arrayContaining([
        ['WHT-SERVICE', 15],
        ['WHT-RENT', 10],
        ['WHT-NR', 14],
      ]),
    );
    expect(codes.every((c) => c.account_id)).toBe(true);
  });

  it("a bill takes the vendor's usual code: the vendor is owed the rest", async () => {
    const id = (await createBill().expect(201)).body.id;
    const bill = (await http().get(`/bills/${id}`).set(authHeaders()).expect(200)).body;
    expect(bill.wht_code_id).toBe(rent.id);
    expect(Number(bill.wht_amount)).toBeCloseTo(100, 2);
    expect(Number(bill.payable_amount)).toBeCloseTo(900, 2);
    expect(Number(bill.due_amount)).toBeCloseTo(900, 2);

    const legs = await fetchLegs('Bill', id);
    expectBalanced(legs);
    const payable = legs.find((l) => l.contactId === vendorId);
    expect(Number(payable!.credit.amount)).toBeCloseTo(900, 2);
    const wht = legs.filter((l) => l.accountId === rent.account_id);
    expect(wht.reduce((s, l) => s + Number(l.credit.amount), 0)).toBeCloseTo(100, 2);
  });

  it('a bill can be saved without withholding', async () => {
    const id = (await createBill({ whtCodeId: null }).expect(201)).body.id;
    const bill = (await http().get(`/bills/${id}`).set(authHeaders()).expect(200)).body;
    expect(Number(bill.wht_amount)).toBe(0);
    expect(Number(bill.due_amount)).toBeCloseTo(1000, 2);
  });

  it('an expense pays the rest from the payment account', async () => {
    const res = await http()
      .post('/expenses')
      .set(authHeaders())
      .send({
        exchangeRate: 1,
        paymentAccountId: 1000,
        referenceNo: faker.string.alphanumeric(8),
        publish: true,
        paymentDate: `${MONTH}-10`,
        payeeId: vendorId,
        whtCodeId: service.id,
        branchId: 1,
        categories: [{ index: 1, expenseAccountId, amount: 200 }],
      })
      .expect(201);
    const legs = await fetchLegs('Expense', res.body.id);
    expectBalanced(legs);
    const wht = legs.filter((l) => l.accountId === service.account_id);
    expect(wht.reduce((s, l) => s + Number(l.credit.amount), 0)).toBeCloseTo(30, 2);
    const payment = legs.find((l) => l.accountId === 1000);
    expect(Number(payment!.credit.amount)).toBeCloseTo(170, 2);
  });

  it("lists the month's withholding by vendor and payment type, and prints the certificate", async () => {
    const report = (await http().get('/tax-compliance/wht').query({ month: MONTH }).set(authHeaders()).expect(200)).body;
    const mine = report.lines.filter((l) => l.vendor_id === vendorId);
    expect(mine.map((l) => [l.code, Number(l.amount.toFixed(2))]).sort()).toEqual([
      ['WHT-RENT', 100],
      ['WHT-SERVICE', 30],
    ]);
    expect(report.due_date).toBe('2026-12-20');

    const cert = (await http().get('/tax-compliance/wht/certificate').query({ vendorId, month: MONTH }).set(authHeaders()).expect(200)).body;
    const html: string = cert.html_content ?? cert.htmlContent;
    expect(html).toContain(vendorName);
    expect(html).toContain('K001-777000111');
    expect(html).toContain('130.00');

    await http().get('/tax-compliance/wht').query({ month: '2026-13' }).set(authHeaders()).expect(400);
  });
});
