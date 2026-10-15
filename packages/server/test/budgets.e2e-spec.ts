import request = require('supertest');
import { faker } from '@faker-js/faker';
import { app } from './init-app-test';
import { authHeaders } from './_utils/gl';
import { fetchAccountsByCode } from './_utils/balance-sheet';

/**
 * Budget planning core (DiTech Phase 2, docs/ditech/budgeting/phase-1-design.md §8).
 * Budgets, versions, lines with monthly amounts, totals and allocation.
 */
describe('Budgets (e2e)', () => {
  const http = () => request(app.getHttpServer());
  let income: number;
  let expense: number;
  let bank: number;
  let fixedAsset: number;

  const pick = (accounts: Record<string, { id: number; accountType: string }>, type: string) => {
    const found = Object.values(accounts).find((a) => a.accountType === type);
    if (!found) throw new Error(`No ${type} account in the chart of accounts`);
    return found.id;
  };

  const createBudget = async (overrides: Record<string, any> = {}) => {
    const res = await http()
      .post('/budgets')
      .set(authHeaders())
      .send({ name: `Budget ${faker.string.alphanumeric(6)}`, type: 'profit_loss', fiscalYear: 2031, startDate: '2031-01-01', endDate: '2031-12-31', ...overrides });
    if (res.status !== 201) throw new Error(`create ${res.status}: ${JSON.stringify(res.body)}`);
    return res.body;
  };

  const saveLines = (budgetId: number, body: Record<string, any>, versionNo = 1) =>
    http().put(`/budgets/${budgetId}/versions/${versionNo}/lines`).set(authHeaders()).send(body);

  const months12 = (start = 2031) => Array.from({ length: 12 }, (_, i) => `${start}-${String(i + 1).padStart(2, '0')}`);
  const errorType = (res: request.Response) => res.body.errors?.[0]?.type;
  /** { '2031-01': 5 } -> [{ month: '2031-01', amount: 5 }] */
  const am = (byMonth: Record<string, any>) => Object.entries(byMonth).map(([month, amount]) => ({ month, amount }));

  beforeAll(async () => {
    const accounts = await fetchAccountsByCode();
    income = pick(accounts, 'income');
    expense = pick(accounts, 'expense');
    bank = pick(accounts, 'bank');
    fixedAsset = pick(accounts, 'fixed-asset');
  });

  describe('budgets', () => {
    it('creates a budget with an original draft version and a generated reference', async () => {
      const budget = await createBudget({ startDate: undefined, endDate: undefined });
      expect(budget.reference).toMatch(/^BUD-2031-\d{3}$/);
      expect(budget.months).toHaveLength(12);
      expect(budget.versions).toEqual([expect.objectContaining({ version_no: 1, kind: 'original', status: 'draft', lock_version: 0, total: 0 })]);
      expect(budget.currency_code).toMatch(/^[A-Z]{3}$/);
    });

    it('accepts a custom period of whole months and refuses others', async () => {
      const half = await createBudget({ startDate: '2031-01-01', endDate: '2031-06-30' });
      expect(half.months).toEqual(['2031-01-01', '2031-02-01', '2031-03-01', '2031-04-01', '2031-05-01', '2031-06-01']);

      for (const period of [
        { startDate: '2031-01-15', endDate: '2031-12-31' },
        { startDate: '2031-01-01', endDate: '2031-12-30' },
        { startDate: '2031-01-01', endDate: '2033-01-31' },
        { startDate: '2031-06-01', endDate: '2031-01-31' },
      ]) {
        const res = await http().post('/budgets').set(authHeaders()).send({ name: 'Bad', type: 'profit_loss', fiscalYear: 2031, ...period });
        expect(res.status).toBe(400);
        expect(errorType(res)).toBe('BUDGET_INVALID_PERIOD');
      }
    });

    it('refuses a duplicate reference and an unknown type', async () => {
      const reference = `REF-${faker.string.alphanumeric(8)}`;
      await createBudget({ reference });
      const dup = await http().post('/budgets').set(authHeaders()).send({ name: 'Dup', type: 'profit_loss', fiscalYear: 2031, reference });
      expect(errorType(dup)).toBe('BUDGET_REFERENCE_EXISTS');
      await http().post('/budgets').set(authHeaders()).send({ name: 'X', type: 'balance_sheet', fiscalYear: 2031 }).expect(400);
    });

    it('lists with search and pagination, edits the header, deletes a draft budget', async () => {
      const tag = faker.string.alphanumeric(10);
      const a = await createBudget({ name: `Search ${tag} A` });
      await createBudget({ name: `Search ${tag} B` });

      const page1 = await http().get('/budgets').query({ search: tag, pageSize: 1, page: 1 }).set(authHeaders()).expect(200);
      expect(page1.body.data).toHaveLength(1);
      expect(page1.body.pagination).toEqual({ page: 1, page_size: 1, total: 2 });
      expect(page1.body.data[0].latest_version).toMatchObject({ version_no: 1, status: 'draft' });

      const edited = await http().put(`/budgets/${a.id}`).set(authHeaders()).send({ name: `Renamed ${tag}`, notes: 'Board approved targets' }).expect(200);
      expect(edited.body).toMatchObject({ name: `Renamed ${tag}`, notes: 'Board approved targets', type: 'profit_loss' });

      await http().delete(`/budgets/${a.id}`).set(authHeaders()).expect(200);
      await http().get(`/budgets/${a.id}`).set(authHeaders()).expect(404);
      const after = await http().get('/budgets').query({ search: tag }).set(authHeaders()).expect(200);
      expect(after.body.pagination.total).toBe(1);
    });

    it('returns 404 for unknown budgets and versions', async () => {
      const budget = await createBudget();
      await http().get('/budgets/99999999').set(authHeaders()).expect(404);
      await http().get(`/budgets/${budget.id}/versions/9`).set(authHeaders()).expect(404);
      const res = await saveLines(99999999, { lockVersion: 0, lines: [] });
      expect(res.status).toBe(404);
    });
  });

  describe('lines and totals', () => {
    it('saves monthly amounts and totals them exactly by quarter, year, group and net income', async () => {
      const budget = await createBudget();
      const incomeAmounts = Object.fromEntries(months12().map((m, i) => [m, 1000 + i * 100])); // 1,000 … 2,100
      const expenseAmounts = Object.fromEntries(months12().map((m) => [m, '333.33']));
      const res = await saveLines(budget.id, {
        lockVersion: 0,
        lines: [
          { accountId: income, amounts: am(incomeAmounts), note: 'Price list 2031' },
          { accountId: expense, amounts: am(expenseAmounts), assumption: 'Flat rent' },
        ],
      }).expect(200);

      const v = res.body;
      expect(v.version.lock_version).toBe(1);
      expect(v.lines).toHaveLength(2);
      const inc = v.lines.find((l) => l.account_id === income);
      expect(inc.quarters).toEqual([3300, 4200, 5100, 6000]);
      expect(inc.total).toBe(18600);
      expect(inc.note).toBe('Price list 2031');
      const exp = v.lines.find((l) => l.account_id === expense);
      expect(exp.total).toBeCloseTo(3999.96, 3);
      expect(exp.assumption).toBe('Flat rent');

      expect(v.totals.groups).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ root_type: 'income', total: 18600 }),
          expect.objectContaining({ root_type: 'expense', total: 3999.96 }),
        ]),
      );
      expect(v.totals.net_income.total).toBeCloseTo(14600.04, 3);
      expect(v.totals.net_income.months['2031-01-01']).toBeCloseTo(666.67, 3);
      expect(v.totals.grand.quarters).toHaveLength(4);

      const summary = await http().get(`/budgets/${budget.id}`).set(authHeaders()).expect(200);
      expect(summary.body.versions[0].total).toBeCloseTo(22599.96, 3);
    });

    it('changes only the months given, removes a month with null, and updates instead of duplicating', async () => {
      const budget = await createBudget();
      await saveLines(budget.id, { lockVersion: 0, lines: [{ accountId: expense, amounts: am(Object.fromEntries(months12().map((m) => [m, 100]))) }] }).expect(200);

      const res = await saveLines(budget.id, {
        lockVersion: 1,
        lines: [{ accountId: expense, amounts: am({ '2031-03': 250, '2031-04-01': null }) }],
      }).expect(200);
      expect(res.body.lines).toHaveLength(1);
      const line = res.body.lines[0];
      expect(line.months['2031-01-01']).toBe(100);
      expect(line.months['2031-03-01']).toBe(250);
      expect(line.months['2031-04-01']).toBe(0);
      expect(line.total).toBe(100 * 10 + 250);
    });

    it('keeps branch/project lines apart and removes lines', async () => {
      const budget = await createBudget();
      const project = (await http().post('/projects').set(authHeaders()).send({ name: `Budget project ${faker.string.alphanumeric(6)}` }).expect(201)).body;
      const res = await saveLines(budget.id, {
        lockVersion: 0,
        lines: [
          { accountId: expense, amounts: am({ '2031-01': 10 }) },
          { accountId: expense, projectId: project.id, amounts: am({ '2031-01': 20 }) },
          { accountId: expense, branchId: 1, amounts: am({ '2031-01': 30 }) },
        ],
      }).expect(200);
      expect(res.body.lines).toHaveLength(3);
      expect(res.body.totals.grand.total).toBe(60);

      const withProject = res.body.lines.find((l) => l.project_id === project.id);
      const after = await saveLines(budget.id, { lockVersion: 1, lines: [], removeLineIds: [withProject.id] }).expect(200);
      expect(after.body.lines).toHaveLength(2);
      expect(after.body.totals.grand.total).toBe(40);

      const unknown = await saveLines(budget.id, { lockVersion: 2, lines: [], removeLineIds: [99999999] });
      expect(unknown.status).toBe(404);
      expect(errorType(unknown)).toBe('BUDGET_LINE_NOT_FOUND');
    });

    it('refuses a stale lock_version (two people editing at once)', async () => {
      const budget = await createBudget();
      await saveLines(budget.id, { lockVersion: 0, lines: [{ accountId: income, amounts: am({ '2031-01': 1 }) }] }).expect(200);
      const stale = await saveLines(budget.id, { lockVersion: 0, lines: [{ accountId: income, amounts: am({ '2031-01': 2 }) }] });
      expect(stale.status).toBe(409);
      expect(errorType(stale)).toBe('BUDGET_VERSION_CHANGED');
      const v = await http().get(`/budgets/${budget.id}/versions/1`).set(authHeaders()).expect(200);
      expect(v.body.lines[0].months['2031-01-01']).toBe(1);
    });

    it('validates lines and saves nothing when one is wrong', async () => {
      const budget = await createBudget();
      const cases: Array<[Record<string, any>, string]> = [
        [{ lines: [{ accountId: income }, { accountId: income }] }, 'BUDGET_DUPLICATE_LINE'],
        [{ lines: [{ accountId: bank, amounts: am({ '2031-01': 5 }) }] }, 'BUDGET_ACCOUNT_NOT_ALLOWED'],
        [{ lines: [{ accountId: 99999999 }] }, 'BUDGET_ACCOUNT_NOT_FOUND'],
        [{ lines: [{ accountId: income, amounts: am({ '2032-01': 5 }) }] }, 'BUDGET_MONTH_OUTSIDE_PERIOD'],
        [{ lines: [{ accountId: income, amounts: am({ '2031-13': 5 }) }] }, 'BUDGET_MONTH_OUTSIDE_PERIOD'],
        [{ lines: [{ accountId: income, amounts: am({ '2031-01': '1.005' }) }] }, 'BUDGET_INVALID_AMOUNT'],
        [{ lines: [{ accountId: income, amounts: am({ '2031-01': 'abc' }) }] }, 'BUDGET_INVALID_AMOUNT'],
        [{ lines: [{ accountId: income, projectId: 99999999 }] }, 'BUDGET_PROJECT_NOT_FOUND'],
        [{ lines: [{ accountId: income, amounts: am({ '2031-01': 5 }) }, { accountId: bank }] }, 'BUDGET_ACCOUNT_NOT_ALLOWED'],
      ];
      for (const [body, type] of cases) {
        const res = await saveLines(budget.id, { lockVersion: 0, ...body });
        expect([res.status, errorType(res)]).toEqual([400, type]);
      }
      const v = await http().get(`/budgets/${budget.id}/versions/1`).set(authHeaders()).expect(200);
      expect(v.body.lines).toEqual([]);
      expect(v.body.version.lock_version).toBe(0);
    });

    it('lets a CAPEX budget plan fixed assets only', async () => {
      const capex = await createBudget({ type: 'capex' });
      await saveLines(capex.id, { lockVersion: 0, lines: [{ accountId: fixedAsset, amounts: am({ '2031-06': 50000 }) }] }).expect(200);
      const res = await saveLines(capex.id, { lockVersion: 1, lines: [{ accountId: expense }] });
      expect(errorType(res)).toBe('BUDGET_ACCOUNT_NOT_ALLOWED');
    });
  });

  describe('allocation preview', () => {
    it('equal, percentage, seasonal and growth add up exactly and save nothing', async () => {
      const budget = await createBudget();
      const allocate = (body: Record<string, any>) => http().post(`/budgets/${budget.id}/allocate`).set(authHeaders()).send(body);

      const equal = (await allocate({ method: 'equal', amount: 1000 }).expect(200)).body;
      const values = Object.values(equal.amounts) as number[];
      expect(values.slice(0, 11).every((x) => x === 83.33)).toBe(true);
      expect(values[11]).toBe(83.37);
      expect(equal.total).toBe(1000);

      const pct = (await allocate({ method: 'percentage', amount: 1200, values: [10, 10, 10, 10, 5, 5, 5, 5, 10, 10, 10, 10] }).expect(200)).body;
      expect(pct.amounts['2031-01-01']).toBe(120);
      expect(pct.total).toBe(1200);

      const bad = await allocate({ method: 'percentage', amount: 1200, values: Array(12).fill(8) });
      expect(errorType(bad)).toBe('BUDGET_INVALID_ALLOCATION');
      const wrongCount = await allocate({ method: 'seasonal', amount: 100, values: [1, 2] });
      expect(errorType(wrongCount)).toBe('BUDGET_INVALID_ALLOCATION');

      const seasonal = (await allocate({ method: 'seasonal', amount: 999.99, values: [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 3] }).expect(200)).body;
      expect(seasonal.amounts['2031-01-01']).toBe(0);
      expect(seasonal.total).toBe(999.99);

      const growth = (await allocate({ method: 'growth', growthPercent: 5, baseAmounts: am({ '2031-01': 100, '2031-02': 33.33 }) }).expect(200)).body;
      expect(growth.amounts['2031-01-01']).toBe(105);
      expect(growth.amounts['2031-02-01']).toBe(35);
      expect(growth.amounts['2031-03-01']).toBe(0);

      const v = await http().get(`/budgets/${budget.id}/versions/1`).set(authHeaders()).expect(200);
      expect(v.body.lines).toEqual([]);
    });
  });

  describe('audit', () => {
    it('records creation, line changes with old and new values, and deletion', async () => {
      const budget = await createBudget();
      await saveLines(budget.id, { lockVersion: 0, lines: [{ accountId: income, amounts: am({ '2031-01': 10 }) }] }).expect(200);
      await saveLines(budget.id, { lockVersion: 1, lines: [{ accountId: income, amounts: am({ '2031-01': 15 }) }] }).expect(200);
      await http().delete(`/budgets/${budget.id}`).set(authHeaders()).expect(200);

      const res = await http().get('/audit-logs').query({ subject: ['Budget'], pageSize: 100 }).set(authHeaders()).expect(200);
      const rows = (res.body.data ?? res.body.audit_logs ?? res.body).filter((r) => r.subject_id === budget.id);
      expect(rows.map((r) => r.action).sort()).toEqual(['created', 'deleted', 'lines_saved', 'lines_saved']);
      const changes = rows.flatMap((r) => r.metadata?.changes ?? []);
      expect(changes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ month: '2031-01-01', before: null, after: 10 }),
          expect.objectContaining({ month: '2031-01-01', before: 10, after: 15 }),
        ]),
      );
    });
  });
});
