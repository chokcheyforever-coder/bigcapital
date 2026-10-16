import request = require('supertest');
import * as XLSX from 'xlsx';
import { faker } from '@faker-js/faker';
import { app } from './init-app-test';
import { authHeaders, cancelTransactionsLock, createCustomer, createServiceItem, createVendor, getBaseCurrency } from './_utils/gl';
import { findNode } from './_utils/balance-sheet';

/**
 * Budget vs actual (DiTech Phase 4). Real invoices, bills, expenses and
 * journals in 2034 on two branches, plus a deleted invoice and draft
 * documents; the report's actuals must equal the Profit & Loss month by month
 * and by branch, and every ledger amount must land on exactly one line.
 */
describe('Budget vs actual (e2e)', () => {
  const http = () => request(app.getHttpServer());
  const am = (byMonth: Record<string, number>) => Object.entries(byMonth).map(([month, amount]) => ({ month, amount }));
  const YEAR = { fromDate: '2034-01-01', toDate: '2034-12-31' };
  const MONTHS = Array.from({ length: 12 }, (_, i) => `2034-${String(i + 1).padStart(2, '0')}`);
  const lastDay = (m: string) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).toISOString().slice(0, 10);

  // Accounts used by the GL e2e suites: the service item sells to 1026 and costs to 1019.
  const INCOME = 1026;
  const COST = 1019;
  const EXPENSE = 1021;
  const CASH = 1000;

  let branch2: number;
  let budget: any;
  let incomeLine: any;
  let expenseBranch1Line: any;
  let expenseLine: any;

  const report = async (name: string, query: Record<string, unknown> = {}, status = 200) => {
    const res = await http().get(`/budgets/reports/${name}`).query({ budgetId: budget.id, ...query }).set(authHeaders());
    if (res.status !== status) throw new Error(`${name} ${res.status}: ${JSON.stringify(res.body)}`);
    return res.body;
  };
  const plNet = async (fromDate: string, toDate: string, branchesIds?: number[]) => {
    const res = await http()
      .get('/reports/profit-loss-sheet')
      .query({ fromDate, toDate, ...(branchesIds ? { branchesIds } : {}) })
      .set(authHeaders());
    if (res.status !== 200) throw new Error(`P&L ${res.status}: ${JSON.stringify(res.body)}`);
    return Number(findNode(res.body.data, 'NET_INCOME')?.total?.amount ?? 0);
  };
  const row = (r: any, predicate: (row: any) => boolean) => r.rows.find(predicate);

  beforeAll(async () => {
    await cancelTransactionsLock();
    const currency = await getBaseCurrency();
    const customerId = await createCustomer(currency);
    const vendorId = await createVendor(currency);
    const itemId = await createServiceItem();
    branch2 = (await http().post('/branches').set(authHeaders()).send({ name: `BvA ${faker.string.alphanumeric(5)}`, code: faker.string.alpha(4) }).expect(201)).body.id;

    const invoice = (date: string, branchId: number, rate: number) =>
      http()
        .post('/sale-invoices')
        .set(authHeaders())
        .send({
          customerId, invoiceDate: date, dueDate: date, invoiceNo: faker.string.uuid(), delivered: true,
          branchId, warehouseId: 1, entries: [{ index: 1, itemId, quantity: 1, rate }],
        })
        .expect(201);
    const bill = (date: string, branchId: number, rate: number, open = true) =>
      http()
        .post('/bills')
        .set(authHeaders())
        .send({
          vendorId, billDate: date, dueDate: date, billNumber: faker.string.alphanumeric(10), open,
          branchId, warehouseId: 1, entries: [{ index: 1, itemId, quantity: 1, rate }],
        })
        .expect(201);
    const expense = (date: string, branchId: number, amount: number, publish = true) =>
      http()
        .post('/expenses')
        .set(authHeaders())
        .send({
          exchangeRate: 1, paymentAccountId: CASH, referenceNo: faker.string.alphanumeric(10), publish,
          paymentDate: date, branchId, categories: [{ index: 1, expenseAccountId: EXPENSE, amount }],
        })
        .expect(201);

    // Posted: Jan income 1000 (branch 1) + 500 (branch 2); Feb bill 400 (b1), expense 150 (b2); Mar journal 70 (b1).
    await invoice('2034-01-15', 1, 1000);
    await invoice('2034-01-20', branch2, 500);
    await bill('2034-02-10', 1, 400);
    await expense('2034-02-11', branch2, 150);
    await http()
      .post('/manual-journals')
      .set(authHeaders())
      .send({
        date: '2034-03-05', journalNumber: `BVA-${Date.now()}`, reference: faker.string.uuid(), publish: true, branchId: 1,
        entries: [
          { index: 1, accountId: EXPENSE, debit: 70, credit: 0 },
          { index: 2, accountId: CASH, debit: 0, credit: 70 },
        ],
      })
      .expect(201);

    // Not actuals: a deleted invoice, a draft bill and a draft expense.
    const deleted = await invoice('2034-01-25', 1, 9999);
    await http().delete(`/sale-invoices/${deleted.body.id}`).set(authHeaders()).expect(200);
    await bill('2034-02-12', 1, 888, false);
    await expense('2034-02-13', 1, 777, false);

    const created = await http()
      .post('/budgets')
      .set(authHeaders())
      .send({ name: `BvA ${faker.string.alphanumeric(6)}`, type: 'profit_loss', fiscalYear: 2034, startDate: '2034-01-01', endDate: '2034-12-31' })
      .expect(201);
    budget = created.body;
    const version = await http()
      .put(`/budgets/${budget.id}/versions/1/lines`)
      .set(authHeaders())
      .send({
        lockVersion: 0,
        lines: [
          { accountId: INCOME, amounts: am({ '2034-01': 1200 }) },
          { accountId: EXPENSE, branchId: 1, amounts: am({ '2034-03': 100 }) },
          { accountId: EXPENSE, amounts: am({ '2034-02': 200 }) },
        ],
      });
    if (version.status !== 200) throw new Error(`lines ${version.status}: ${JSON.stringify(version.body)}`);
    incomeLine = version.body.lines.find((l) => l.account_id === INCOME);
    expenseBranch1Line = version.body.lines.find((l) => l.account_id === EXPENSE && l.branch_id === 1);
    expenseLine = version.body.lines.find((l) => l.account_id === EXPENSE && l.branch_id === null);
  });

  describe('reconciles with the Profit & Loss', () => {
    it('net income actual equals the P&L for the year and for each month', async () => {
      const r = await report('budget-vs-actual', { columns: 'month' });
      expect(r.columns.map((c) => c.key)).toEqual(MONTHS.map((m) => `${m}-01`));
      expect(r.net_income.total.actual).toBeCloseTo(await plNet(YEAR.fromDate, YEAR.toDate), 2);
      for (const [i, m] of MONTHS.slice(0, 4).entries()) {
        expect({ m, actual: r.net_income.columns[i].actual }).toEqual({ m, actual: expect.closeTo(await plNet(`${m}-01`, lastDay(m)), 2) });
      }
    });

    it('equals the P&L for each branch', async () => {
      for (const branchId of [1, branch2]) {
        const r = await report('budget-vs-actual', { branchesIds: [branchId] });
        expect({ branchId, actual: r.net_income.total.actual }).toEqual({
          branchId,
          actual: expect.closeTo(await plNet(YEAR.fromDate, YEAR.toDate, [branchId]), 2),
        });
      }
    });

    it('the branch report splits actuals by ledger branch, adding up to the P&L', async () => {
      const r = await report('branch');
      for (const branchId of [1, branch2]) {
        const dim = r.dimensions.find((d) => d.branch?.id === branchId);
        expect(dim.net_income.total.actual).toBeCloseTo(await plNet(YEAR.fromDate, YEAR.toDate, [branchId]), 2);
      }
      const sum = r.dimensions.reduce((a, d) => a + (d.net_income?.total.actual ?? 0), 0);
      expect(sum).toBeCloseTo(r.net_income.total.actual, 2);
    });
  });

  describe('lines', () => {
    it('gives each ledger amount to the most specific line, once; drafts and deleted documents never count', async () => {
      const r = await report('budget-vs-actual');
      const income = row(r, (x) => x.line_id === incomeLine.id);
      expect(income.total).toMatchObject({ budget: 1200, actual: 1500, variance: 300, variance_percent: 25, used_percent: 125, favorable: true });

      // Branch 1 expense (journal 70) → the branch line; branch 2 expense (150) → the line without branch.
      expect(row(r, (x) => x.line_id === expenseBranch1Line.id).total).toMatchObject({ budget: 100, actual: 70, variance: -30, favorable: true });
      expect(row(r, (x) => x.line_id === expenseLine.id).total).toMatchObject({ budget: 200, actual: 150, variance: -50, favorable: true });

      // The bill's cost account has no line: an unbudgeted row.
      const cost = row(r, (x) => x.account.id === COST && x.line_id === null);
      expect(cost).toMatchObject({ unbudgeted: true, status: 'unbudgeted' });
      expect(cost.total).toMatchObject({ budget: 0, actual: 400, variance_percent: null, used_percent: null, unbudgeted: true });
    });

    it('includeUnbudgeted=false leaves out accounts without a line', async () => {
      const r = await report('budget-vs-actual', { includeUnbudgeted: false });
      expect(r.rows.every((x) => x.line_id !== null)).toBe(true);
      expect(r.rows).toHaveLength(3);
    });

    it('limits the period to the months asked for, by quarter', async () => {
      const r = await report('budget-vs-actual', { fromMonth: '2034-02', toMonth: '2034-06', columns: 'quarter' });
      expect(r.columns.map((c) => [c.key, c.months.length])).toEqual([['Q1', 2], ['Q2', 3]]);
      expect(row(r, (x) => x.line_id === incomeLine.id).total).toMatchObject({ budget: 0, actual: 0 });
      expect(r.net_income.total.actual).toBeCloseTo(await plNet('2034-02-01', '2034-06-30'), 2);
    });

    it('drill-down points to the General Ledger rows of the line', async () => {
      const r = await report('budget-vs-actual');
      const income = row(r, (x) => x.line_id === incomeLine.id);
      expect(income.drilldown).toMatchObject({ from_date: '2034-01-01', to_date: '2034-12-31', accounts_ids: [INCOME], exact: true });
      // Expense has two lines, so the line without branch is not an exact GL filter.
      expect(row(r, (x) => x.line_id === expenseLine.id).drilldown.exact).toBe(false);
      expect(row(r, (x) => x.line_id === expenseBranch1Line.id).drilldown.branches_ids).toEqual([1]);
    });
  });

  describe('views', () => {
    it('revenue achievement and expense utilization', async () => {
      const revenue = await report('revenue-achievement');
      expect(revenue.rows.every((x) => x.account.root_type === 'income')).toBe(true);
      expect(row(revenue, (x) => x.line_id === incomeLine.id).total.used_percent).toBe(125);
      expect(revenue.net_income).toBeNull();

      const expense = await report('expense-utilization', { nearPercent: 70 });
      expect(expense.rows.every((x) => x.account.root_type === 'expense')).toBe(true);
      expect(row(expense, (x) => x.line_id === expenseBranch1Line.id).status).toBe('near'); // 70 %
      expect(row(expense, (x) => x.line_id === expenseLine.id).status).toBe('near'); // 75 %
    });

    it('exceptions list unbudgeted spend and variances past the threshold, worst first', async () => {
      const r = await report('exceptions', { thresholdPercent: 10 });
      expect(r.rows[0]).toMatchObject({ account: expect.objectContaining({ id: COST }), unbudgeted: true });
      expect(r.rows.some((x) => x.line_id === incomeLine.id)).toBe(false); // favorable
    });

    it('monthly variance is always by month', async () => {
      const r = await report('monthly-variance', { columns: 'total' });
      expect(r.columns).toHaveLength(12);
      const jan = row(r, (x) => x.line_id === incomeLine.id).columns[0];
      expect(jan).toMatchObject({ key: '2034-01-01', budget: 1200, actual: 1500, variance: 300 });
    });

    it('refuses the CAPEX report for a P&L budget, unknown reports and months outside the budget', async () => {
      const capex = await report('capex', {}, 400);
      expect(capex.errors?.[0]?.type).toBe('BUDGET_REPORT_NOT_FOR_TYPE');
      await report('no-such-report', {}, 404);
      const bad = await report('budget-vs-actual', { fromMonth: '2035-01' }, 400);
      expect(bad.errors?.[0]?.type).toBe('BUDGET_INVALID_PERIOD');
      await http().get('/budgets/reports/budget-vs-actual').query({ budgetId: 99999999 }).set(authHeaders()).expect(404);
    });
  });

  describe('CAPEX', () => {
    it('counts additions to fixed assets as actuals and disposals apart', async () => {
      const fixed = (
        await http()
          .post('/accounts')
          .set(authHeaders())
          .send({ name: `Equipment ${Date.now()}`, accountType: 'fixed-asset', code: faker.string.alphanumeric({ length: 6 }).toUpperCase() })
          .expect(201)
      ).body;
      await http()
        .post('/manual-journals')
        .set(authHeaders())
        .send({
          date: '2034-04-10', journalNumber: `CPX-${Date.now()}`, reference: faker.string.uuid(), publish: true, branchId: 1,
          entries: [
            { index: 1, accountId: fixed.id, debit: 5000, credit: 0 },
            { index: 2, accountId: CASH, debit: 0, credit: 5000 },
          ],
        })
        .expect(201);
      await http()
        .post('/manual-journals')
        .set(authHeaders())
        .send({
          date: '2034-05-10', journalNumber: `CPX-${Date.now()}-d`, reference: faker.string.uuid(), publish: true, branchId: 1,
          entries: [
            { index: 1, accountId: CASH, debit: 800, credit: 0 },
            { index: 2, accountId: fixed.id, debit: 0, credit: 800 },
          ],
        })
        .expect(201);
      const capex = await http()
        .post('/budgets')
        .set(authHeaders())
        .send({ name: `CAPEX ${faker.string.alphanumeric(6)}`, type: 'capex', fiscalYear: 2034, startDate: '2034-01-01', endDate: '2034-12-31' })
        .expect(201);
      await http()
        .put(`/budgets/${capex.body.id}/versions/1/lines`)
        .set(authHeaders())
        .send({ lockVersion: 0, lines: [{ accountId: fixed.id, amounts: am({ '2034-04': 4000 }) }] })
        .expect(200);

      const r = await http().get('/budgets/reports/capex').query({ budgetId: capex.body.id }).set(authHeaders()).expect(200);
      const line = r.body.rows.find((x) => x.account.id === fixed.id);
      expect(line.total).toMatchObject({ budget: 4000, actual: 5000, disposals: 800, variance: 1000, favorable: false, used_percent: 125 });
      expect(line.status).toBe('over');
      expect(r.body.net_income).toBeNull();
    });
  });

  describe('export', () => {
    it('downloads XLSX and CSV with the same figures', async () => {
      const xlsx = await http()
        .get('/budgets/reports/budget-vs-actual/export')
        .query({ budgetId: budget.id, format: 'xlsx' })
        .set(authHeaders())
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(xlsx.headers['content-type']).toContain('spreadsheetml');
      const book = XLSX.read(xlsx.body, { type: 'buffer' });
      const table = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1, defval: null }) as unknown[][];
      const header = table[3] as string[];
      expect(header.slice(0, 9)).toEqual(['Account code', 'Account', 'Branch', 'Project', 'Budget', 'Actual', 'Variance', 'Variance %', 'Used %']);
      const net = table.find((r) => r[1] === 'Net income');
      const api = await report('budget-vs-actual');
      expect(Number(net[5])).toBeCloseTo(api.net_income.total.actual, 2);

      const csv = await http()
        .get('/budgets/reports/monthly-variance/export')
        .query({ budgetId: budget.id, format: 'csv' })
        .set(authHeaders())
        .expect(200);
      expect(csv.headers['content-type']).toContain('text/csv');
      expect(csv.text).toContain('Jan 2034 Budget');
    });
  });
});
