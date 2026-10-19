import request = require('supertest');
import { faker } from '@faker-js/faker';
import { app } from './init-app-test';
import { authHeaders, cancelTransactionsLock } from './_utils/gl';
import { accountTotalsMap, fetchAccountsByCode, fetchBalanceSheet } from './_utils/balance-sheet';

/**
 * Budgeting Phase 6 (design §15): forecasts, balance sheet and cash flow
 * budgets, the dashboard and notifications.
 *
 * Forecast: the design §15 fixture, posted for real as manual journals on an
 * expense account: 2040 at 100 a month (December 200), 2041 January 120,
 * February 90, March 150, against a 2041 budget of 110 a month, as of March.
 * Balance sheet and cash flow use 2043 and compare with the Balance Sheet report.
 */
describe('Budget forecasts, balance sheet, cash flow, dashboard (e2e)', () => {
  const http = () => request(app.getHttpServer());
  const errorType = (res: request.Response) => res.body.errors?.[0]?.type;
  const months = (year: number) => Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  const flat = (year: number, amount: number) => months(year).map((month) => ({ month, amount }));
  const lastDay = (m: string) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).toISOString().slice(0, 10);

  // Expense account used by the GL e2e suites; nothing else posts to it in 2040–2041.
  const EXPENSE = 1021;
  let cash: { id: number; accountType: string };
  let cashAccounts: number[] = [];
  let equity: { id: number };
  let budget: any;
  let savedRules: any[] = [];

  const ok = async (res: request.Response, status = 200) => {
    if (res.status !== status) throw new Error(`${res.req?.method} ${res.req?.path} ${res.status}: ${JSON.stringify(res.body)}`);
    return res.body;
  };
  const journal = (date: string, debitAccount: number, creditAccount: number, amount: number) =>
    http()
      .post('/manual-journals')
      .set(authHeaders())
      .send({
        date,
        journalNumber: `FC-${Date.now()}-${faker.string.alphanumeric(4)}`,
        reference: faker.string.uuid(),
        publish: true,
        entries: [
          { index: 1, accountId: debitAccount, debit: amount, credit: 0 },
          { index: 2, accountId: creditAccount, debit: 0, credit: amount },
        ],
      })
      .then((r) => ok(r, 201));
  const createBudget = (type: string, year: number) =>
    http()
      .post('/budgets')
      .set(authHeaders())
      .send({ name: `Phase 6 ${type} ${faker.string.alphanumeric(6)}`, type, fiscalYear: year, startDate: `${year}-01-01`, endDate: `${year}-12-31` })
      .then((r) => ok(r, 201));
  const saveLines = (budgetId: number, versionNo: number, lockVersion: number, lines: any[]) =>
    http().put(`/budgets/${budgetId}/versions/${versionNo}/lines`).set(authHeaders()).send({ lockVersion, lines }).then((r) => ok(r));
  const getVersion = (budgetId: number, versionNo: number) => http().get(`/budgets/${budgetId}/versions/${versionNo}`).set(authHeaders()).then((r) => ok(r));
  const report = (name: string, query: Record<string, unknown>) => http().get(`/budgets/reports/${name}`).query(query).set(authHeaders()).then((r) => ok(r));
  const expenseLine = (version: any) => version.lines.find((l: any) => l.account_id === EXPENSE);
  const values = (line: any) => months(2041).map((m) => line.months[`${m}-01`]);

  beforeAll(async () => {
    await cancelTransactionsLock();
    const accounts = await fetchAccountsByCode();
    cash = accounts['10001']; // a bank account
    cashAccounts = Object.values(accounts).filter((a) => a.accountType === 'cash' || a.accountType === 'bank').map((a) => a.id);
    equity = accounts['30002'];

    for (const m of months(2040)) await journal(`${m}-15`, EXPENSE, cash.id, m === '2040-12' ? 200 : 100);
    await journal('2041-01-15', EXPENSE, cash.id, 120);
    await journal('2041-02-15', EXPENSE, cash.id, 90);
    await journal('2041-03-15', EXPENSE, cash.id, 150);

    budget = await createBudget('operating_expenses', 2041);
    await saveLines(budget.id, 1, 0, [{ accountId: EXPENSE, amounts: flat(2041, 110) }]);

    const rules = await http().get('/budgets/settings/approval-rules').set(authHeaders()).then((r) => ok(r));
    savedRules = rules.rules.map((r: any) => ({
      minAmount: r.min_amount,
      maxAmount: r.max_amount,
      preventSelfApproval: r.prevent_self_approval,
      steps: r.steps.map((s: any) => ({ order: s.order, roleId: s.role_id ?? null, label: s.label })),
    }));
  });

  afterAll(async () => {
    await http().put('/budgets/settings/approval-rules').set(authHeaders()).send({ rules: savedRules });
    await http().put('/budgets/settings/notifications').set(authHeaders()).send({ email: true, alertLevel: 'exceeded' });
  });

  describe('forecast versions (fixture of design §15)', () => {
    const create = (body: Record<string, unknown>) =>
      http().post(`/budgets/${budget.id}/forecasts`).set(authHeaders()).send({ asOfMonth: '2041-03', ...body }).then((r) => ok(r, 201));

    it('budget remainder, run rate, growth and seasonal give the documented amounts', async () => {
      const expected: Record<string, number[]> = {
        budget: [120, 90, 150, ...Array(9).fill(110)],
        run_rate: [120, 90, 150, ...Array(9).fill(120)],
        growth: [120, 90, 150, ...Array(8).fill(110), 220],
        seasonal: [120, 90, 150, ...Array(8).fill(108), 216],
      };
      for (const [method, amounts] of Object.entries(expected)) {
        const created = await create({ method, growthPercent: method === 'growth' ? 10 : undefined });
        const v = created.version;
        expect({ method, kind: v.version.kind, status: v.version.status }).toEqual({ method, kind: 'forecast', status: 'draft' });
        expect(v.version.forecast).toMatchObject({ method, as_of_month: '2041-03-01', base_version_no: 1 });
        expect({ method, amounts: values(expenseLine(v)) }).toEqual({ method, amounts });
      }
    });

    it('a forecast is never submitted, and a balance sheet budget has no forecast', async () => {
      const created = await create({ method: 'run_rate' });
      const res = await http().post(`/budgets/${budget.id}/versions/${created.version_no}/submit`).set(authHeaders()).send({});
      expect(res.status).toBe(409);
      expect(errorType(res)).toBe('BUDGET_VERSION_NOT_SUBMITTABLE');

      const bs = await createBudget('balance_sheet', 2043);
      const refused = await http().post(`/budgets/${bs.id}/forecasts`).set(authHeaders()).send({ asOfMonth: '2043-03' });
      expect(refused.status).toBe(400);
      expect(errorType(refused)).toBe('BUDGET_NOT_FOR_TYPE');
    });

    it('refresh recomputes with new settings and needs the current lock', async () => {
      const created = await create({ method: 'run_rate' });
      const versionNo = created.version_no;
      const stale = await http().post(`/budgets/${budget.id}/versions/${versionNo}/forecast/refresh`).set(authHeaders()).send({ lockVersion: 5, method: 'budget' });
      expect(stale.status).toBe(409);
      const refreshed = await http()
        .post(`/budgets/${budget.id}/versions/${versionNo}/forecast/refresh`)
        .set(authHeaders())
        .send({ lockVersion: 0, method: 'budget' })
        .then((r) => ok(r));
      expect(refreshed.version.lock_version).toBe(1);
      expect(refreshed.version.forecast.method).toBe('budget');
      expect(values(expenseLine(refreshed))).toEqual([120, 90, 150, ...Array(9).fill(110)]);
    });

    it('forecast vs budget: actual to date + remaining forecast = projected', async () => {
      const created = await create({ method: 'run_rate' });
      const r = await http().get(`/budgets/${budget.id}/forecast-vs-budget`).query({ forecastVersionNo: created.version_no }).set(authHeaders()).then((x) => ok(x));
      const row = r.rows.find((x: any) => x.account.id === EXPENSE);
      expect(row).toMatchObject({ budget: 1320, actual_to_date: 360, forecast_remaining: 1080, projected: 1440, variance: 120, favorable: false });
      expect(row.months[2]).toEqual({ month: '2041-03-01', budget: 110, actual: 150, forecast: 150 });
      expect(row.months[3]).toEqual({ month: '2041-04-01', budget: 110, actual: null, forecast: 120 });
      const expenseGroup = r.groups.find((g: any) => g.root_type === 'expense');
      expect(expenseGroup.projected).toBeCloseTo(r.rows.filter((x: any) => x.account.root_type === 'expense').reduce((a: number, x: any) => a + x.projected, 0), 2);
    });

    it('rolling forecast: the 12 months after the as-of month, budget only inside the period', async () => {
      const r = await http().get(`/budgets/${budget.id}/rolling-forecast`).query({ asOfMonth: '2041-03', method: 'run_rate' }).set(authHeaders()).then((x) => ok(x));
      expect(r.months).toHaveLength(12);
      expect(r.months[0]).toBe('2041-04-01');
      expect(r.months[11]).toBe('2042-03-01');
      const row = r.rows.find((x: any) => x.account.id === EXPENSE);
      expect(row.months.map((m: any) => m.forecast)).toEqual(Array(12).fill(120));
      expect(row.months[0].budget).toBe(110);
      expect(row.months[11].budget).toBeNull();
      expect(row.history[11]).toEqual({ month: '2041-03-01', actual: 150 });
      expect(row.forecast_total).toBe(1440);
    });
  });

  describe('dashboard', () => {
    it('equals the budget vs actual reports and the forecast', async () => {
      const d = await http().get('/budgets/dashboard').query({ budgetId: budget.id, asOfMonth: '2041-03' }).set(authHeaders()).then((x) => ok(x));
      const annual = await report('budget-vs-actual', { budgetId: budget.id, columns: 'month' });
      const ytd = await report('budget-vs-actual', { budgetId: budget.id, fromMonth: '2041-01', toMonth: '2041-03' });
      const group = (r: any, root: string) => r.groups.find((g: any) => g.root_type === root).total;

      expect(d.as_of_month).toBe('2041-03-01');
      expect(d.kpis.expenses.annual_budget).toBe(group(annual, 'expense').budget);
      expect(d.kpis.expenses.ytd_budget).toBe(group(ytd, 'expense').budget);
      expect(d.kpis.expenses.ytd_actual).toBe(group(ytd, 'expense').actual);
      expect(d.kpis.expenses.ytd_actual).toBe(360);
      expect(d.kpis.expenses.utilization_percent).toBe(group(ytd, 'expense').used_percent);
      expect(d.kpis.net_income.ytd_actual).toBe(ytd.net_income.total.actual);
      d.monthly.forEach((m: any, i: number) => {
        expect({ month: m.month, budget: m.groups.expense.budget }).toEqual({ month: m.month, budget: annual.groups.find((g: any) => g.root_type === 'expense').columns[i].budget });
        if (i < 3) expect(m.groups.expense.actual).toBe(annual.groups.find((g: any) => g.root_type === 'expense').columns[i].actual);
        else expect(m.groups.expense.actual).toBeNull();
      });

      const f = await http().get(`/budgets/${budget.id}/forecast-vs-budget`).set(authHeaders()).then((x) => ok(x));
      expect(d.projection.forecast_version_no).toBe(f.forecast_version.version_no);
      expect(d.projection.groups.find((g: any) => g.root_type === 'expense').projected).toBe(f.groups.find((g: any) => g.root_type === 'expense').projected);
    });

    it('defaults to a budget and lists the budgets to choose from', async () => {
      const d = await http().get('/budgets/dashboard').set(authHeaders()).then((x) => ok(x));
      expect(Array.isArray(d.budgets)).toBe(true);
      expect(d.workflow).toEqual(expect.objectContaining({ waiting_for_me: expect.any(Number), pending_overrides: expect.any(Number) }));
    });
  });

  describe('balance sheet and cash flow budgets', () => {
    const balancesAt = async (toDate: string) => accountTotalsMap((await fetchBalanceSheet({ fromDate: `${toDate.slice(0, 4)}-01-01`, toDate })).data);
    const balanceAt = async (toDate: string, accountId: number) => Number((await balancesAt(toDate))[accountId] ?? 0);
    // The cash position covers every cash and bank account.
    const cashAt = async (toDate: string) => {
      const totals = await balancesAt(toDate);
      return cashAccounts.reduce((a, id) => a + Number(totals[id] ?? 0), 0);
    };

    beforeAll(async () => {
      // Owner puts in 300 in February 2043; 80 spent in March.
      await journal('2043-02-10', cash.id, equity.id, 300);
      await journal('2043-03-10', EXPENSE, cash.id, 80);
    });

    it('balance sheet: actuals are month-end balances equal to the Balance Sheet report', async () => {
      const bs = await createBudget('balance_sheet', 2043);
      await saveLines(bs.id, 1, 0, [{ accountId: cash.id, amounts: flat(2043, 1000) }]);
      const r = await report('budget-vs-actual', { budgetId: bs.id, columns: 'month' });
      expect(r.closing).toBe(true);
      const row = r.rows.find((x: any) => x.account.id === cash.id && x.line_id);
      for (const [i, m] of ['2043-01', '2043-02', '2043-03'].entries()) {
        expect({ m, actual: row.columns[i].actual }).toEqual({ m, actual: expect.closeTo(await balanceAt(lastDay(m), cash.id), 2) });
      }
      expect(row.columns[2].actual - row.columns[1].actual).toBeCloseTo(-80, 2);
      expect(row.columns[1].actual - row.columns[0].actual).toBeCloseTo(300, 2);
      // A quarter and the year show the last month, not a sum.
      const q = await report('budget-vs-actual', { budgetId: bs.id, columns: 'quarter' });
      const qRow = q.rows.find((x: any) => x.account.id === cash.id && x.line_id);
      expect(qRow.columns[0].budget).toBe(1000);
      expect(qRow.columns[0].actual).toBeCloseTo(row.columns[2].actual, 2);
      expect(qRow.total.budget).toBe(1000);
      expect(r.net_income).toBeNull();

      // Version totals show the closing month too.
      const v = await getVersion(bs.id, 1);
      expect(v.closing).toBe(true);
      expect(v.lines[0].total).toBe(1000);
      expect(v.lines[0].quarters).toEqual([1000, 1000, 1000, 1000]);
    });

    it('balance sheet and cash flow budgets are not under spending control', async () => {
      const bs = await createBudget('balance_sheet', 2043);
      const res = await http().put('/budgets/settings/policies').set(authHeaders()).send({ budgetId: bs.id, mode: 'block' });
      expect(res.status).toBe(400);
      expect(errorType(res)).toBe('BUDGET_NOT_FOR_TYPE');
    });

    it('cash flow: net movement with inflows, outflows and the cash position', async () => {
      const cf = await createBudget('cash_flow', 2043);
      await saveLines(cf.id, 1, 0, [{ accountId: cash.id, amounts: [{ month: '2043-02', amount: 250 }, { month: '2043-03', amount: -100 }] }]);
      const r = await report('budget-vs-actual', { budgetId: cf.id, columns: 'month' });
      const row = r.rows.find((x: any) => x.account.id === cash.id && x.line_id);
      expect(row.columns[1]).toMatchObject({ budget: 250, actual: 300, inflows: 300, outflows: 0, favorable: true });
      expect(row.columns[2]).toMatchObject({ budget: -100, actual: -80, inflows: 0, outflows: 80, favorable: true });

      const opening = await cashAt('2042-12-31');
      const closing = await cashAt('2043-12-31');
      expect(r.cash_position.opening).toBeCloseTo(opening, 2);
      expect(r.cash_position.closing.actual).toBeCloseTo(closing, 2);
      expect(r.cash_position.closing.budget).toBeCloseTo(opening + 150, 2);
      expect(r.cash_position.columns[2].actual).toBeCloseTo(opening + 220, 2);
    });
  });

  describe('notifications', () => {
    it('a submitted version notifies whoever can approve it, in the app', async () => {
      await http()
        .put('/budgets/settings/approval-rules')
        .set(authHeaders())
        .send({ rules: [{ minAmount: 0, maxAmount: null, preventSelfApproval: false, steps: [{ order: 1, label: 'Finance' }] }] })
        .then((r) => ok(r));
      const b = await createBudget('operating_expenses', 2041);
      await saveLines(b.id, 1, 0, [{ accountId: EXPENSE, amounts: flat(2041, 10) }]);
      await http().post(`/budgets/${b.id}/versions/1/submit`).set(authHeaders()).send({}).then((r) => ok(r));

      const list = await http().get('/budgets/notifications').query({ unread: true }).set(authHeaders()).then((r) => ok(r));
      const mine = list.data.find((n: any) => n.budget_id === b.id && n.kind === 'approval_waiting');
      expect(mine).toBeDefined();
      expect(mine.subject).toContain(b.name);
      expect(mine.link).toBe(`/budgets/${b.id}`);
      expect(list.unread).toBeGreaterThan(0);

      await http().post('/budgets/notifications/read').set(authHeaders()).send({ ids: [mine.id] }).then((r) => ok(r));
      const after = await http().get('/budgets/notifications').query({ unread: true }).set(authHeaders()).then((r) => ok(r));
      expect(after.data.some((n: any) => n.id === mine.id)).toBe(false);
      expect(after.unread).toBe(list.unread - 1);
    });

    it('a refused change notifies nobody', async () => {
      const b = await createBudget('operating_expenses', 2041);
      // Submitting an empty version is refused inside the transaction: nothing is written.
      const res = await http().post(`/budgets/${b.id}/versions/1/submit`).set(authHeaders()).send({});
      expect(res.status).toBe(409);
      const list = await http().get('/budgets/notifications').set(authHeaders()).then((r) => ok(r));
      expect(list.data.some((n: any) => n.budget_id === b.id)).toBe(false);
    });

    it('company settings for emails and alerts', async () => {
      const saved = await http().put('/budgets/settings/notifications').set(authHeaders()).send({ email: false, alertLevel: 'warning' }).then((r) => ok(r));
      expect(saved).toEqual({ email: false, alert_level: 'warning' });
      const read = await http().get('/budgets/settings/notifications').set(authHeaders()).then((r) => ok(r));
      expect(read).toEqual({ email: false, alert_level: 'warning' });
      const bad = await http().put('/budgets/settings/notifications').set(authHeaders()).send({ email: true, alertLevel: 'sometimes' });
      expect(bad.status).toBe(400);
    });
  });
});
