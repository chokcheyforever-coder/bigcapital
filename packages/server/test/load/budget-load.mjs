// Phase 7 load test (docs/ditech/budgeting/phase-1-design.md §8): a budget of
// 10,000 lines on a company with 1,000,000 ledger rows. Seeds through the API
// where it matters (accounts, projects, the budget lines themselves) and
// straight into the tenant database for the ledger rows, then times the
// screens and reports that read them. Writes a table to $GITHUB_STEP_SUMMARY
// and fails when a step is slower than its limit.
//
//   API_URL=http://localhost:3000/api TOKEN=... ORG_ID=... \
//   DB_HOST=127.0.0.1 DB_ROOT_PASSWORD=root node test/load/budget-load.mjs
import { createRequire } from 'node:module';
import { appendFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const mysql = require('mysql2/promise');

const { API_URL, TOKEN, ORG_ID } = process.env;
const LEDGER_ROWS = Number(process.env.LEDGER_ROWS ?? 1_000_000);
const ACCOUNTS = 100;
const PROJECTS = 100; // ACCOUNTS x PROJECTS = 10,000 budget lines
const YEAR = 2026;
const months = Array.from({ length: 12 }, (_, i) => `${YEAR}-${String(i + 1).padStart(2, '0')}`);

// Slowest acceptable time per step, in seconds (CI runner: 2 vCPU, 7 GB).
const LIMITS = {
  'save 5,000 lines (1st half)': 60,
  'save 5,000 lines (2nd half)': 60,
  'open budget version (10k lines)': 10,
  'Budget vs Actual (year)': 20,
  'Budget vs Actual (by month)': 20,
  'Budget by Project': 20,
  'Budget Exceptions': 20,
  'Profit & Loss (year, 1M rows)': 20,
  'budget dashboard': 30,
  'export version to Excel': 30,
};

const headers = { authorization: `Bearer ${TOKEN}`, 'organization-id': ORG_ID, 'content-type': 'application/json', accept: 'application/json' };
async function api(method, path, body) {
  const res = await fetch(`${API_URL}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { return text; }
}

const results = [];
async function timed(name, fn, runs = 1) {
  const times = [];
  let out;
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    out = await fn();
    times.push((performance.now() - t) / 1000);
  }
  const s = times.sort((a, b) => a - b)[Math.floor(times.length / 2)];
  results.push({ name, seconds: s, limit: LIMITS[name] });
  console.log(`${name}: ${s.toFixed(2)} s`);
  return out;
}

// ---------------------------------------------------------------- seed
const run = Date.now().toString(36);
const accounts = await api('GET', '/accounts');
const list = accounts.accounts ?? accounts.data ?? accounts;
const bank = list.find((a) => a.slug === 'bank-account').id;

const expenseIds = [];
for (let i = 0; i < ACCOUNTS; i++) {
  const a = await api('POST', '/accounts', { name: `Load expense ${i} ${run}`, code: `L${String(i).padStart(3, "0")}`, accountType: 'expense' });
  expenseIds.push(a.id ?? a.data?.id);
}
const projectIds = [];
for (let i = 0; i < PROJECTS; i++) {
  const p = await api('POST', '/projects', { name: `Load project ${i} ${run}` });
  projectIds.push(p.id);
}
console.log(`seeded ${expenseIds.length} accounts, ${projectIds.length} projects`);

const db = await mysql.createConnection({
  host: process.env.DB_HOST ?? '127.0.0.1',
  user: 'root',
  password: process.env.DB_ROOT_PASSWORD ?? 'root',
  database: `bigcapital_tenant_${ORG_ID}`,
  multipleStatements: true,
});
await db.query('CREATE TEMPORARY TABLE LOAD_ACC (N INT PRIMARY KEY, ID INT); CREATE TEMPORARY TABLE LOAD_PRJ (N INT PRIMARY KEY, ID INT)');
await db.query('INSERT INTO LOAD_ACC VALUES ?', [expenseIds.map((id, n) => [n, id])]);
await db.query('INSERT INTO LOAD_PRJ VALUES ?', [projectIds.map((id, n) => [n, id])]);
const pairs = Math.floor(LEDGER_ROWS / 2);
const t0 = performance.now();
// Balanced journal pairs over the year: expense debit (with a project) and bank credit.
for (const [leg, account, dr, cr] of [
  ['debit', 'A.ID', 'AMT', '0'],
  ['credit', String(bank), '0', 'AMT'],
]) {
  await db.query(
    `INSERT INTO ACCOUNTS_TRANSACTIONS
       (CREDIT, DEBIT, TRANSACTION_TYPE, REFERENCE_TYPE, REFERENCE_ID, ACCOUNT_ID, PROJECT_ID, DATE, CREATED_AT, CURRENCY_CODE, EXCHANGE_RATE, \`INDEX\`, INDEX_GROUP)
     SELECT ${cr}, ${dr}, 'Journal', 'ManualJournal', 900000000 + S.SEQ, ${account}, P.ID,
            DATE_ADD('${YEAR}-01-01', INTERVAL (S.SEQ MOD 365) DAY), NOW(), 'USD', 1, ${leg === 'debit' ? 1 : 2}, 1
     FROM (SELECT SEQ, ((SEQ MOD 97) + 3) * 10 AS AMT FROM seq_1_to_${pairs}) S
     JOIN LOAD_ACC A ON A.N = S.SEQ MOD ${ACCOUNTS}
     JOIN LOAD_PRJ P ON P.N = FLOOR(S.SEQ / ${ACCOUNTS}) MOD ${PROJECTS}`,
  );
}
const [[{ total }]] = await db.query('SELECT COUNT(*) AS total FROM ACCOUNTS_TRANSACTIONS');
console.log(`ledger rows: ${total} (${((performance.now() - t0) / 1000).toFixed(1)} s to insert)`);
await db.end();

// ---------------------------------------------------------------- budget
const budget = await api('POST', '/budgets', {
  name: `Load test ${run}`, type: 'operating_expenses', fiscalYear: YEAR, startDate: `${YEAR}-01-01`, endDate: `${YEAR}-12-31`,
});
const lines = [];
for (const accountId of expenseIds) {
  for (const projectId of projectIds) {
    lines.push({ accountId, projectId, amounts: months.map((month, i) => ({ month, amount: 1000 + ((accountId + projectId + i) % 50) * 10 })) });
  }
}
let lockVersion = 0;
for (const [half, part] of [['1st', lines.slice(0, 5000)], ['2nd', lines.slice(5000)]]) {
  const saved = await timed(`save 5,000 lines (${half} half)`, () => api('PUT', `/budgets/${budget.id}/versions/1/lines`, { lockVersion, lines: part }));
  lockVersion = saved.version?.lock_version ?? saved.lock_version ?? lockVersion + 1;
}

// ---------------------------------------------------------------- reads
const q = (o) => new URLSearchParams(o).toString();
const version = await timed('open budget version (10k lines)', () => api('GET', `/budgets/${budget.id}/versions/1`), 3);
const lineCount = (version.lines ?? version.data?.lines ?? []).length;
const base = { budgetId: budget.id, fromMonth: `${YEAR}-01`, toMonth: `${YEAR}-12` };
const bva = await timed('Budget vs Actual (year)', () => api('GET', `/budgets/reports/budget-vs-actual?${q(base)}`), 3);
await timed('Budget vs Actual (by month)', () => api('GET', `/budgets/reports/budget-vs-actual?${q({ ...base, columns: 'month' })}`), 3);
await timed('Budget by Project', () => api('GET', `/budgets/reports/project?${q(base)}`), 3);
await timed('Budget Exceptions', () => api('GET', `/budgets/reports/exceptions?${q(base)}`), 3);
await timed('Profit & Loss (year, 1M rows)', () => api('GET', `/reports/profit-loss-sheet?${q({ fromDate: `${YEAR}-01-01`, toDate: `${YEAR}-12-31` })}`), 3);
await timed('budget dashboard', () => api('GET', `/budgets/dashboard?${q({ budgetId: budget.id, asOfMonth: `${YEAR}-12` })}`), 3);
await timed('export version to Excel', async () => {
  const res = await fetch(`${API_URL}/budgets/${budget.id}/versions/1/export?format=xlsx`, { headers });
  if (!res.ok) throw new Error(`export: ${res.status}`);
  return (await res.arrayBuffer()).byteLength;
});

// ---------------------------------------------------------------- checks
const totals = bva.totals ?? bva.data?.totals ?? bva.total;
const budgetTotal = lines.reduce((s, l) => s + l.amounts.reduce((a, m) => a + m.amount, 0), 0);
const failures = results.filter((r) => r.limit !== undefined && r.seconds > r.limit);
const summary = [
  `### Budget load test: ${lineCount.toLocaleString('en-US')} budget lines, ${Number(total).toLocaleString('en-US')} ledger rows`,
  '',
  `Budget total ${budgetTotal.toLocaleString('en-US')}; Budget vs Actual totals: \`${JSON.stringify(totals ?? {}).slice(0, 200)}\``,
  '',
  '| Step | Seconds (median) | Limit | |',
  '|---|---:|---:|---|',
  ...results.map((r) => `| ${r.name} | ${r.seconds.toFixed(2)} | ${r.limit ?? '-'} | ${r.limit !== undefined && r.seconds > r.limit ? 'SLOW' : 'ok'} |`),
];
console.log(summary.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary.join('\n')}\n`);
if (lineCount !== ACCOUNTS * PROJECTS) {
  console.error(`expected ${ACCOUNTS * PROJECTS} budget lines, got ${lineCount}`);
  process.exit(1);
}
if (failures.length) {
  console.error(`slower than the limit: ${failures.map((f) => f.name).join(', ')}`);
  process.exit(1);
}
