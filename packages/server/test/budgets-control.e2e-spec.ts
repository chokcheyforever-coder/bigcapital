import request = require('supertest');
import { faker } from '@faker-js/faker';
import { app } from './init-app-test';
import { authHeaders, cancelTransactionsLock, createServiceItem, createVendor, getBaseCurrency } from './_utils/gl';

/**
 * Budget spending control (DiTech Phase 5b, design §13). Real bills, expenses
 * and journals in June 2036 against approved budgets with their own policies
 * (never the company default, so other test files are not controlled):
 * block refuses an over-budget bill, concurrent bills for the last amount
 * let exactly one through, a draft is a commitment and counts once when
 * posted, warn_approve needs an approved override, inform only records.
 */
describe('Budget spending control (e2e)', () => {
  const http = () => request(app.getHttpServer());
  const errorType = (res: request.Response) => res.body.errors?.[0]?.type;
  const payload = (res: request.Response) => res.body.errors?.[0]?.payload;

  const COST = 1019; // the service item's cost account: bills
  const EXPENSE = 1021; // expenses and journals
  const CASH = 1000;
  const JUNE = '2036-06-15';

  let vendorId: number;
  let itemId: number;
  let billBudget: any;
  let expenseBudget: any;
  let savedRules: any[] = [];
  let postedBillId: number;

  const bill = (rate: number, open = true, date = JUNE) =>
    http()
      .post('/bills')
      .set(authHeaders())
      .send({
        vendorId, billDate: date, dueDate: date, billNumber: faker.string.alphanumeric(12), open,
        branchId: 1, warehouseId: 1, entries: [{ index: 1, itemId, quantity: 1, rate }],
      });
  const expense = (amount: number, publish = true) =>
    http()
      .post('/expenses')
      .set(authHeaders())
      .send({
        exchangeRate: 1, paymentAccountId: CASH, referenceNo: faker.string.alphanumeric(10), publish,
        paymentDate: JUNE, branchId: 1, categories: [{ index: 1, expenseAccountId: EXPENSE, amount }],
      });
  const journal = (debitExpense: number, creditExpense = 0) =>
    http()
      .post('/manual-journals')
      .set(authHeaders())
      .send({
        date: JUNE, journalNumber: `CTL-${faker.string.alphanumeric(10)}`, publish: true, branchId: 1,
        entries: debitExpense
          ? [
              { index: 1, accountId: EXPENSE, debit: debitExpense, credit: 0 },
              { index: 2, accountId: CASH, debit: 0, credit: debitExpense },
            ]
          : [
              { index: 1, accountId: CASH, debit: creditExpense, credit: 0 },
              { index: 2, accountId: EXPENSE, debit: 0, credit: creditExpense },
            ],
      });
  const policy = (budgetId: number, mode: string, extra: Record<string, unknown> = {}) =>
    http().put('/budgets/settings/policies').set(authHeaders()).send({ budgetId, mode, periodBasis: 'month', thresholds: [75, 90], ...extra });
  const availability = async (budgetId: number, query: Record<string, string> = { month: '2036-06', basis: 'month' }) =>
    (await http().get(`/budgets/${budgetId}/availability`).query(query).set(authHeaders()).expect(200)).body;
  const alerts = async (budgetId: number) =>
    (await http().get('/budgets/alerts').query({ budgetId, pageSize: 200 }).set(authHeaders()).expect(200)).body.data;

  /** An approved budget with one June line. */
  const approvedBudget = async (type: string, accountId: number, june: number) => {
    const created = await http()
      .post('/budgets')
      .set(authHeaders())
      .send({ name: `Control ${faker.string.alphanumeric(6)}`, type, fiscalYear: 2036 })
      .expect(201);
    await http()
      .put(`/budgets/${created.body.id}/versions/1/lines`)
      .set(authHeaders())
      .send({ lockVersion: 0, lines: [{ accountId, amounts: [{ month: '2036-06', amount: june }] }] })
      .expect(200);
    await http().post(`/budgets/${created.body.id}/versions/1/submit`).set(authHeaders()).send({}).expect(200);
    const approved = await http().post(`/budgets/${created.body.id}/versions/1/approve`).set(authHeaders()).send({}).expect(200);
    expect(approved.body.version.status).toBe('approved');
    return created.body;
  };

  beforeAll(async () => {
    await cancelTransactionsLock();
    const currency = await getBaseCurrency();
    vendorId = await createVendor(currency);
    itemId = await createServiceItem();

    // One approver in the test tenant: let them approve their own budgets and overrides here.
    const rules = await http().get('/budgets/settings/approval-rules').set(authHeaders()).expect(200);
    savedRules = rules.body.rules.map((r: any) => ({
      minAmount: r.min_amount,
      maxAmount: r.max_amount,
      preventSelfApproval: r.prevent_self_approval,
      steps: r.steps.map((s: any) => ({ order: s.order, roleId: s.role_id ?? null, label: s.label })),
    }));
    await http()
      .put('/budgets/settings/approval-rules')
      .set(authHeaders())
      .send({ rules: [{ minAmount: 0, preventSelfApproval: false, steps: [{ order: 1, label: 'Approver' }] }] })
      .expect(200);

    billBudget = await approvedBudget('profit_loss', COST, 100);
    expenseBudget = await approvedBudget('operating_expenses', EXPENSE, 100);
    await policy(billBudget.id, 'block').expect(200);
    await policy(expenseBudget.id, 'warn_approve').expect(200);
  });

  afterAll(async () => {
    for (const b of [billBudget, expenseBudget]) {
      if (b) await http().delete('/budgets/settings/policies').query({ budgetId: b.id }).set(authHeaders());
    }
    await http().put('/budgets/settings/approval-rules').set(authHeaders()).send({ rules: savedRules });
  });

  describe('policies', () => {
    it('validates thresholds and the budget', async () => {
      const bad = await policy(billBudget.id, 'block', { thresholds: [0] });
      expect(bad.status).toBe(400);
      const unknown = await policy(99999999, 'block');
      expect([unknown.status, errorType(unknown)]).toEqual([404, 'BUDGET_NOT_FOUND']);
      const list = await http().get('/budgets/settings/policies').set(authHeaders()).expect(200);
      expect(list.body.budgets.find((p: any) => p.budget_id === billBudget.id)).toMatchObject({ mode: 'block', period_basis: 'month', thresholds: [75, 90] });
    });
  });

  describe('block', () => {
    it('refuses an over-budget bill and posts nothing', async () => {
      const res = await bill(120);
      expect([res.status, errorType(res)]).toEqual([400, 'BUDGET_EXCEEDED']);
      expect(payload(res).checks[0]).toMatchObject({ budget: 100, available: 100, document: 120, excess: 20 });
      const a = await availability(billBudget.id);
      expect(a.lines[0]).toMatchObject({ budget: 100, actual: 0, commitments: 0, available: 100 });
    });

    it('lets a bill within budget through and records the threshold it reached', async () => {
      const res = await bill(80);
      expect(res.status).toBe(201);
      postedBillId = res.body.id;
      const list = await alerts(billBudget.id);
      expect(list[0]).toMatchObject({ reference_type: 'bill', reference_id: res.body.id, level: 'info', outcome: 'allowed', document: 80, percent_after: 80 });
    });

    it('counts a draft as a commitment, and once when it is posted', async () => {
      const draft = await bill(15, false);
      expect(draft.status).toBe(201);
      expect((await availability(billBudget.id)).lines[0]).toMatchObject({ actual: 80, commitments: 15, available: 5, used_percent: 95 });

      await http().patch(`/bills/${draft.body.id}/open`).set(authHeaders()).expect(200);
      expect((await availability(billBudget.id)).lines[0]).toMatchObject({ actual: 95, commitments: 0, available: 5 });
    });

    it('editing a posted bill leaves its own old amount out', async () => {
      const posted = await bill(1);
      expect(posted.status).toBe(201); // 96 of 100
      const edit = (rate: number) =>
        http()
          .put(`/bills/${posted.body.id}`)
          .set(authHeaders())
          .send({
            vendorId, billDate: JUNE, dueDate: JUNE, billNumber: posted.body.bill_number, open: true,
            branchId: 1, warehouseId: 1, entries: [{ index: 1, itemId, quantity: 1, rate }],
          });
      expect((await edit(1)).status).toBe(200);
      const over = await edit(6); // 95 + 6 > 100
      expect([over.status, errorType(over)]).toEqual([400, 'BUDGET_EXCEEDED']);
      expect((await availability(billBudget.id)).lines[0]).toMatchObject({ actual: 96, available: 4 });
    });

    it('two concurrent bills for the last 4: exactly one succeeds', async () => {
      const results = await Promise.all([bill(4), bill(4)]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 400]);
      expect(errorType(results.find((r) => r.status === 400)!)).toBe('BUDGET_EXCEEDED');
      expect((await availability(billBudget.id)).lines[0]).toMatchObject({ actual: 100, available: 0 });
    });

    it('does not control dates outside the budget or budgets without an approved version', async () => {
      expect((await bill(500, true, '2037-01-15')).status).toBe(201);
      const draftBudget = await http()
        .post('/budgets')
        .set(authHeaders())
        .send({ name: `Draft ${faker.string.alphanumeric(6)}`, type: 'profit_loss', fiscalYear: 2036 })
        .expect(201);
      await http()
        .put(`/budgets/${draftBudget.body.id}/versions/1/lines`)
        .set(authHeaders())
        .send({ lockVersion: 0, lines: [{ accountId: EXPENSE, amounts: [{ month: '2036-06', amount: 1 }] }] })
        .expect(200);
      await policy(draftBudget.body.id, 'block').expect(200);
      // Only the approved expense budget (warn_approve, 100) controls this.
      const res = await expense(50);
      expect(res.status).toBe(201);
      await http().delete('/budgets/settings/policies').query({ budgetId: draftBudget.body.id }).set(authHeaders()).expect(200);
    });
  });

  describe('warn and approve', () => {
    it('needs an approved override; the draft then posts', async () => {
      // 50 already spent (previous test).
      const direct = await expense(60);
      expect([direct.status, errorType(direct)]).toEqual([400, 'BUDGET_APPROVAL_REQUIRED']);
      expect(payload(direct).checks[0]).toMatchObject({ available: 50, document: 60, excess: 10 });

      const draft = await expense(60, false);
      expect(draft.status).toBe(201);
      const requested = await http()
        .post('/budgets/overrides')
        .set(authHeaders())
        .send({ referenceType: 'expense', referenceId: draft.body.id, reason: 'Urgent repair' })
        .expect(201);
      expect(requested.body.overrides).toEqual([expect.objectContaining({ status: 'pending', amount: 10, reference_type: 'expense', budget_id: expenseBudget.id })]);

      const stillBlocked = await http().post(`/expenses/${draft.body.id}/publish`).set(authHeaders());
      expect(errorType(stillBlocked)).toBe('BUDGET_APPROVAL_REQUIRED');

      const pending = await http().get('/budgets/overrides').query({ status: 'pending', referenceType: 'expense', referenceId: draft.body.id }).set(authHeaders()).expect(200);
      expect(pending.body.data).toHaveLength(1);
      const approved = await http().post(`/budgets/overrides/${pending.body.data[0].id}/approve`).set(authHeaders()).send({ comment: 'OK' }).expect(200);
      expect(approved.body.status).toBe('approved');
      const again = await http().post(`/budgets/overrides/${pending.body.data[0].id}/approve`).set(authHeaders()).send({});
      expect(again.status).toBe(409);

      await http().post(`/expenses/${draft.body.id}/publish`).set(authHeaders()).expect(201);
      const list = await alerts(expenseBudget.id);
      expect(list[0]).toMatchObject({ reference_type: 'expense', reference_id: draft.body.id, level: 'exceeded', outcome: 'override' });
    });

    it('refuses an override that is not needed', async () => {
      const posted = await http().post('/budgets/overrides').set(authHeaders()).send({ referenceType: 'bill', referenceId: postedBillId, reason: 'x' });
      expect([posted.status, errorType(posted)]).toEqual([400, 'BUDGET_OVERRIDE_NOT_NEEDED']);
      const missing = await http().post('/budgets/overrides').set(authHeaders()).send({ referenceType: 'bill', referenceId: 99999999, reason: 'x' });
      expect(missing.status).toBe(404);
      const draft = await bill(1, false, '2037-02-01');
      const notNeeded = await http().post('/budgets/overrides').set(authHeaders()).send({ referenceType: 'bill', referenceId: draft.body.id, reason: 'x' });
      expect([notNeeded.status, errorType(notNeeded)]).toEqual([400, 'BUDGET_OVERRIDE_NOT_NEEDED']);
    });

    it('controls manual journals; a journal that lowers spending passes', async () => {
      const over = await journal(10);
      expect([over.status, errorType(over)]).toEqual([400, 'BUDGET_APPROVAL_REQUIRED']);
      expect((await journal(0, 5)).status).toBe(201);
    });
  });

  describe('inform', () => {
    it('lets over-budget spending through and records it', async () => {
      await policy(expenseBudget.id, 'inform').expect(200);
      const res = await journal(10);
      expect(res.status).toBe(201);
      const list = await alerts(expenseBudget.id);
      expect(list[0]).toMatchObject({ reference_type: 'manual_journal', level: 'exceeded', outcome: 'allowed' });
    });

    it('off: nothing is checked or recorded', async () => {
      await policy(expenseBudget.id, 'off').expect(200);
      const before = (await alerts(expenseBudget.id)).length;
      expect((await journal(10)).status).toBe(201);
      expect((await alerts(expenseBudget.id)).length).toBe(before);
    });
  });
});
