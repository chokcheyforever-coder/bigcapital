import request = require('supertest');
import * as XLSX from 'xlsx';
import { faker } from '@faker-js/faker';
import { app } from './init-app-test';
import { authHeaders, cancelTransactionsLock, createCustomer, createServiceItem, getBaseCurrency } from './_utils/gl';
import { fetchAccountsByCode, findNode } from './_utils/balance-sheet';

/**
 * Budget data (DiTech Phase 3): prefill from posted actuals and other budgets,
 * export, template and import (all rows or none).
 */
describe('Budget data (e2e)', () => {
  const http = () => request(app.getHttpServer());
  const am = (byMonth: Record<string, any>) => Object.entries(byMonth).map(([month, amount]) => ({ month, amount }));
  const errorType = (res: request.Response) => res.body.errors?.[0]?.type;
  const INCOME_TYPES = ['income', 'other-income'];
  let income: number;
  let incomeCode: string;
  let expense: number;
  let expenseCode: string;

  const createBudget = async (overrides: Record<string, any> = {}) => {
    const res = await http()
      .post('/budgets')
      .set(authHeaders())
      .send({ name: `Data ${faker.string.alphanumeric(6)}`, type: 'profit_loss', fiscalYear: 2031, startDate: '2031-01-01', endDate: '2031-12-31', ...overrides });
    if (res.status !== 201) throw new Error(`create ${res.status}: ${JSON.stringify(res.body)}`);
    return res.body;
  };
  const version = (id: number, no = 1) => http().get(`/budgets/${id}/versions/${no}`).set(authHeaders()).expect(200).then((r) => r.body);
  const upload = (path: string, csv: string, fields: Record<string, string> = {}) => {
    const req = http().post(path).set(authHeaders());
    for (const [k, v] of Object.entries(fields)) req.field(k, v);
    return req.attach('file', Buffer.from(csv, 'utf8'), 'budget.csv');
  };
  const pl = async (fromDate: string, toDate: string) => {
    const res = await http().get('/reports/profit-loss-sheet').query({ fromDate, toDate }).set(authHeaders());
    if (res.status !== 200) throw new Error(`P&L ${res.status}: ${JSON.stringify(res.body)}`);
    return Number(findNode(res.body.data, 'NET_INCOME')?.total?.amount ?? 0);
  };
  /** Net income of prefilled lines: income accounts add, the others subtract. */
  const net = (lines: any[], month?: string) =>
    lines.reduce((sum, l) => {
      const value = month ? l.amounts.find((a) => a.month === month)?.amount ?? 0 : l.total;
      return sum + (INCOME_TYPES.includes(l.account.account_type) ? value : -value);
    }, 0);

  beforeAll(async () => {
    await cancelTransactionsLock();
    const accounts = await fetchAccountsByCode();
    const pick = (type: string) => Object.entries(accounts).find(([, a]) => a.accountType === type);
    [incomeCode, { id: income }] = pick('income') as any;
    [expenseCode, { id: expense }] = pick('expense') as any;

    // Known 2030 activity, so last year's actuals are not empty.
    const customerId = await createCustomer(await getBaseCurrency());
    const itemId = await createServiceItem();
    await http()
      .post('/sale-invoices')
      .set(authHeaders())
      .send({
        customerId, invoiceDate: '2030-03-10', dueDate: '2030-03-10', invoiceNo: faker.string.uuid(), delivered: true,
        branchId: 1, warehouseId: 1, entries: [{ index: 1, itemId, quantity: 1, rate: 1234.56 }],
      })
      .expect(201);
    await http()
      .post('/expenses')
      .set(authHeaders())
      .send({
        exchangeRate: 1, paymentAccountId: 1000, publish: true, paymentDate: '2030-05-20', branchId: 1,
        categories: [{ index: 1, expenseAccountId: expense, amount: 321.09 }],
      })
      .expect(201);
  });

  describe('prefill', () => {
    it('from last year\'s actuals equals the Profit & Loss for that year, in total and by month', async () => {
      const budget = await createBudget();
      const res = await http().post(`/budgets/${budget.id}/prefill`).set(authHeaders()).send({ source: 'actuals', yearsBack: 1 }).expect(200);
      expect(res.body.source).toMatchObject({ type: 'actuals', from_date: '2030-01-01', to_date: '2030-12-31' });
      expect(res.body.months[0]).toBe('2031-01-01');
      expect(res.body.lines.length).toBeGreaterThan(0);

      expect(net(res.body.lines)).toBeCloseTo(await pl('2030-01-01', '2030-12-31'), 2);
      // 2030-03 actuals land in 2031-03.
      expect(net(res.body.lines, '2031-03-01')).toBeCloseTo(await pl('2030-03-01', '2030-03-31'), 2);
      expect(net(res.body.lines, '2031-05-01')).toBeCloseTo(await pl('2030-05-01', '2030-05-31'), 2);

      // Nothing was saved.
      expect((await version(budget.id)).lines).toEqual([]);
    });

    it('applies growth and can be saved as it is', async () => {
      const budget = await createBudget();
      const base = (await http().post(`/budgets/${budget.id}/prefill`).set(authHeaders()).send({ source: 'actuals' }).expect(200)).body;
      const grown = (await http().post(`/budgets/${budget.id}/prefill`).set(authHeaders()).send({ source: 'actuals', growthPercent: 10, accountIds: [income] }).expect(200)).body;
      expect(grown.lines.every((l) => l.account_id === income)).toBe(true);
      const before = base.lines.find((l) => l.account_id === income);
      const after = grown.lines.find((l) => l.account_id === income);
      if (before) expect(after.total).toBeCloseTo(before.total * 1.1, 0);

      const saved = await http()
        .put(`/budgets/${budget.id}/versions/1/lines`)
        .set(authHeaders())
        .send({ lockVersion: 0, lines: base.lines.map((l) => ({ accountId: l.account_id, branchId: l.branch_id, projectId: l.project_id, amounts: l.amounts })) })
        .expect(200);
      expect(saved.body.totals.net_income.total).toBeCloseTo(net(base.lines), 2);
    });

    it('from another budget version, month by month, with growth', async () => {
      const source = await createBudget({ fiscalYear: 2030, startDate: '2030-01-01', endDate: '2030-12-31' });
      await http()
        .put(`/budgets/${source.id}/versions/1/lines`)
        .set(authHeaders())
        .send({ lockVersion: 0, lines: [{ accountId: expense, amounts: am({ '2030-01': 100, '2030-12': 50.5 }) }] })
        .expect(200);
      const target = await createBudget();
      const res = await http().post(`/budgets/${target.id}/prefill`).set(authHeaders()).send({ source: 'budget', sourceBudgetId: source.id, growthPercent: 10 }).expect(200);
      expect(res.body.source).toMatchObject({ type: 'budget', budget_id: source.id, version_no: 1 });
      expect(res.body.lines).toHaveLength(1);
      const amounts = Object.fromEntries(res.body.lines[0].amounts.map((a) => [a.month, a.amount]));
      expect(amounts['2031-01-01']).toBe(110);
      expect(amounts['2031-12-01']).toBe(55.55);
      expect(res.body.total).toBe(165.55);

      const missing = await http().post(`/budgets/${target.id}/prefill`).set(authHeaders()).send({ source: 'budget', sourceBudgetId: 99999999 });
      expect(missing.status).toBe(404);
    });
  });

  describe('export and template', () => {
    it('exports a version as CSV and Excel', async () => {
      const budget = await createBudget();
      await http()
        .put(`/budgets/${budget.id}/versions/1/lines`)
        .set(authHeaders())
        .send({ lockVersion: 0, lines: [{ accountId: income, amounts: am({ '2031-01': 1000, '2031-02': 2000.5 }), note: 'Target' }] })
        .expect(200);

      const csv = await http().get(`/budgets/${budget.id}/versions/1/export`).query({ format: 'csv' }).set(authHeaders()).expect(200);
      expect(csv.headers['content-type']).toMatch(/text\/csv/);
      expect(csv.headers['content-disposition']).toMatch(/\.csv"/);
      const rows = csv.text.trim().split('\n').map((r) => r.split(','));
      expect(rows[0].slice(0, 6)).toEqual(['Account code', 'Account name', 'Branch', 'Project', '2031-01', '2031-02']);
      expect(rows[0].slice(-3)).toEqual(['Total', 'Note', 'Assumption']);
      expect(rows[1][0]).toBe(incomeCode);
      expect(rows[1].slice(4, 6)).toEqual(['1000', '2000.5']);
      expect(rows[1][16]).toBe('3000.5');
      expect(rows[2][1]).toBe('Total');

      const xlsx = await http()
        .get(`/budgets/${budget.id}/versions/1/export`)
        .query({ format: 'xlsx' })
        .set(authHeaders())
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      const book = XLSX.read(xlsx.body, { type: 'buffer' });
      const table = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1 }) as any[][];
      expect(table[1][4]).toBe(1000);
    });

    it('offers a template with the budget months and allowed accounts only', async () => {
      const budget = await createBudget({ type: 'revenue', startDate: '2031-07-01', endDate: '2031-09-30' });
      const csv = await http().get(`/budgets/${budget.id}/import-template`).query({ format: 'csv' }).set(authHeaders()).expect(200);
      const rows = csv.text.trim().split('\n');
      expect(rows[0]).toBe('Account code,Account name,Branch,Project,2031-07,2031-08,2031-09,Total,Note,Assumption');
      expect(rows.some((r) => r.startsWith(`${incomeCode},`))).toBe(true);
      expect(rows.some((r) => r.startsWith(`${expenseCode},`))).toBe(false);
    });
  });

  describe('import', () => {
    const header = 'Account code,Branch,Project,2031-01,Jan 2031x,2031-02,Note';

    it('previews every row, and saves nothing when one row is wrong', async () => {
      const budget = await createBudget();
      const csv = [
        header,
        `${incomeCode},,,1000,,"1,250.50",Price list`,
        `NO-SUCH-CODE,,,5,,,`,
        `${expenseCode},,,1.005,,abc,`,
        `${incomeCode},,,7,,,`,
        `${expenseCode},No such branch,,1,,,`,
      ].join('\n');

      const preview = await upload(`/budgets/${budget.id}/versions/1/import/preview`, csv).expect(200);
      expect(preview.body.committed).toBe(false);
      expect(preview.body.ignored_columns).toEqual(['Jan 2031x']);
      expect(preview.body.summary).toMatchObject({ rows: 5, valid: 1, invalid: 4, months: ['2031-01-01', '2031-02-01'] });
      const byRow = Object.fromEntries(preview.body.rows.map((r) => [r.row, r]));
      expect(byRow[2]).toMatchObject({ status: 'ok', months: 2 });
      expect(byRow[3].errors[0]).toMatchObject({ column: 'Account code' });
      expect(byRow[4].errors.map((e) => e.column)).toEqual(['2031-01', '2031-02']);
      expect(byRow[5].errors[0].message).toMatch(/row 2/);
      expect(byRow[6].errors[0]).toMatchObject({ column: 'Branch' });

      const commit = await upload(`/budgets/${budget.id}/versions/1/import`, csv, { lock_version: '0' }).expect(200);
      expect(commit.body.committed).toBe(false);
      const v = await version(budget.id);
      expect(v.lines).toEqual([]);
      expect(v.version.lock_version).toBe(0);
    });

    it('refuses months outside the budget and unreadable files', async () => {
      const budget = await createBudget();
      const outside = await upload(`/budgets/${budget.id}/versions/1/import/preview`, `Account code,2032-01\n${incomeCode},5`).expect(200);
      expect(outside.body.file_errors[0]).toMatch(/not a month of this budget/);
      const noMonths = await upload(`/budgets/${budget.id}/versions/1/import/preview`, `Account code,Amount\n${incomeCode},5`).expect(200);
      expect(noMonths.body.file_errors).toContain('No month columns found (headers like 2031-01 or Jan 2031).');

      const wrongType = await http()
        .post(`/budgets/${budget.id}/versions/1/import/preview`)
        .set(authHeaders())
        .attach('file', Buffer.from('x'), 'budget.pdf');
      expect(wrongType.status).toBe(400);
    });

    it('imports a valid file in one go, keeps empty cells unchanged, and checks lock_version', async () => {
      const budget = await createBudget();
      await http()
        .put(`/budgets/${budget.id}/versions/1/lines`)
        .set(authHeaders())
        .send({ lockVersion: 0, lines: [{ accountId: income, amounts: am({ '2031-01': 1, '2031-03': 3 }), note: 'Keep me' }] })
        .expect(200);

      const csv = ['Account code,2031-01,2031-02,2031-03,Note', `${incomeCode},100,200,,`, `${expenseCode},0,"1,000",,Rent`].join('\n');
      const stale = await upload(`/budgets/${budget.id}/versions/1/import`, csv, { lock_version: '0' });
      expect([stale.status, errorType(stale)]).toEqual([409, 'BUDGET_VERSION_CHANGED']);
      const missingLock = await upload(`/budgets/${budget.id}/versions/1/import`, csv);
      expect(missingLock.status).toBe(400);

      const res = await upload(`/budgets/${budget.id}/versions/1/import`, csv, { lock_version: '1' }).expect(200);
      expect(res.body).toMatchObject({ committed: true, lock_version: 2, summary: { rows: 2, valid: 2, invalid: 0, cells: 4 } });

      const v = await version(budget.id);
      const inc = v.lines.find((l) => l.account_id === income);
      expect(inc.months).toMatchObject({ '2031-01-01': 100, '2031-02-01': 200, '2031-03-01': 3 });
      expect(inc.note).toBe('Keep me');
      const exp = v.lines.find((l) => l.account_id === expense);
      expect(exp.months).toMatchObject({ '2031-01-01': 0, '2031-02-01': 1000 });
      expect(exp.note).toBe('Rent');
    });

    it('round-trips: an exported file imports into another budget with the same totals', async () => {
      const a = await createBudget();
      await http()
        .put(`/budgets/${a.id}/versions/1/lines`)
        .set(authHeaders())
        .send({ lockVersion: 0, lines: [{ accountId: income, amounts: am({ '2031-01': 10.1, '2031-06': 20.2 }) }, { accountId: expense, amounts: am({ '2031-12': 5 }) }] })
        .expect(200);
      const exported = await http().get(`/budgets/${a.id}/versions/1/export`).query({ format: 'csv' }).set(authHeaders()).expect(200);

      const b = await createBudget();
      const res = await upload(`/budgets/${b.id}/versions/1/import`, exported.text, { lock_version: '0' }).expect(200);
      expect(res.body.committed).toBe(true);
      const [va, vb] = [await version(a.id), await version(b.id)];
      expect(vb.totals.grand).toEqual(va.totals.grand);
      expect(vb.totals.net_income.total).toBe(va.totals.net_income.total);
    });
  });
});
