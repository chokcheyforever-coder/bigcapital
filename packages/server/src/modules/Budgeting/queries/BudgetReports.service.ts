import { Inject, Injectable } from '@nestjs/common';
import * as moment from 'moment';
import { ServiceError } from '@/modules/Items/ServiceError';
import { TenantModelProxy } from '@/modules/System/models/TenantBaseModel';
import { AccountTypesUtils } from '@/libs/accounts-utils/AccountTypesUtils';
import { Account } from '@/modules/Accounts/models/Account.model';
import { Branch } from '@/modules/Branches/models/Branch.model';
import { Project } from '@/modules/Projects/models/Project.model';
import { Budget } from '../models/Budget.model';
import { BudgetVersion } from '../models/BudgetVersion.model';
import { BudgetLine } from '../models/BudgetLine.model';
import { BudgetReportName, BudgetReportQueryDto } from '../dtos/Budget.dto';
import { BudgetValidator } from '../commands/BudgetValidator.service';
import { dateOnly, normalizeMonth } from '../commands/BudgetCommands.service';
import { BUDGET_TYPE_ACCOUNT_TYPES, BudgetType, BudgetVersionKind, BudgetVersionStatus, ERRORS, isBalanceBudget, PL_BUDGET_TYPES } from '../Budgeting.types';
import { fromMilli, Milli, periodMonths, toMilli } from '../calc/budget-calc';
import { Direction, isException, matchLine, utilizationStatus, variance, VarianceFigures } from '../calc/variance';
import { BudgetActualsService } from './BudgetActuals.service';
import { SheetFormat, writeSheet } from '../commands/BudgetSheet.service';
import { toBudgetDto, toVersionDto } from './BudgetQueries.service';

/** One amount of the report before grouping: a budget month or a ledger month. */
interface Fact {
  rowKey: string;
  accountId: number;
  /** Budget facts: the line's branch/project (or the budget's); actual facts: the ledger row's. */
  branchId: number | null;
  projectId: number | null;
  month: string;
  budget: Milli;
  actual: Milli;
  /** CAPEX only: credits to the asset account (disposals), kept apart from additions. */
  disposals: Milli;
  /** Cash flow only: debits (money in) and credits (money out) of the cash account. */
  inflow: Milli;
  outflow: Milli;
}

interface RowMeta {
  rowKey: string;
  lineId: number | null;
  accountId: number;
  branchId: number | null;
  projectId: number | null;
  note: string | null;
}

interface Column {
  key: string;
  label: string;
  months: string[];
}

type Cell = { budget: Milli; actual: Milli; disposals: Milli; inflow: Milli; outflow: Milli };

const ZERO = (): Cell => ({ budget: 0, actual: 0, disposals: 0, inflow: 0, outflow: 0 });
const addCell = (acc: Cell, c: Cell, sign = 1) => {
  acc.budget += sign * c.budget;
  acc.actual += sign * c.actual;
  acc.disposals += sign * c.disposals;
  acc.inflow += sign * c.inflow;
  acc.outflow += sign * c.outflow;
  return acc;
};
/** Ledger rows before the report's first month: the opening balance of a balance sheet row. */
const OPENING = 'opening';
const LEDGER_START = '1970-01-01';
const SPEND_ROOTS = ['expense', 'asset'];
const DEFAULT_THRESHOLD = 10;
const DEFAULT_NEAR = 90;

export const REPORT_TITLES: Record<BudgetReportName, string> = {
  'budget-vs-actual': 'Budget vs Actual',
  'monthly-variance': 'Monthly Variance',
  branch: 'Budget by Branch',
  project: 'Budget by Project',
  'revenue-achievement': 'Revenue Achievement',
  'expense-utilization': 'Expense Utilization',
  capex: 'CAPEX Budget',
  exceptions: 'Budget Exceptions',
};

type Extras = { disposals?: Milli; inflow?: Milli; outflow?: Milli };

const figuresDto = (f: VarianceFigures, extras: Extras = {}) => ({
  budget: fromMilli(f.budget),
  actual: fromMilli(f.actual),
  variance: fromMilli(f.variance),
  variancePercent: f.variancePercent,
  usedPercent: f.usedPercent,
  favorable: f.favorable,
  unbudgeted: f.unbudgeted,
  ...(extras.disposals !== undefined ? { disposals: fromMilli(extras.disposals) } : {}),
  ...(extras.inflow !== undefined ? { inflows: fromMilli(extras.inflow), outflows: fromMilli(extras.outflow ?? 0) } : {}),
});

/**
 * Budget vs actual reports (DiTech Phase 4, design §2/§5).
 *
 * Actuals come from the ledger with the Profit & Loss rules (BudgetActualsService),
 * one grouped query per report. Every ledger amount is given to exactly one
 * budget line, the most specific one that matches its account, branch and
 * project; amounts that match no line are "unbudgeted" rows. So, with
 * unbudgeted rows included, the actuals of a report add up to the P&L of the
 * same accounts, period and branches.
 */
@Injectable()
export class BudgetReportsService {
  constructor(
    private readonly validator: BudgetValidator,
    private readonly actuals: BudgetActualsService,
    @Inject(Account.name) private readonly accountModel: TenantModelProxy<typeof Account>,
    @Inject(Branch.name) private readonly branchModel: TenantModelProxy<typeof Branch>,
    @Inject(Project.name) private readonly projectModel: TenantModelProxy<typeof Project>,
    @Inject(BudgetVersion.name) private readonly versionModel: TenantModelProxy<typeof BudgetVersion>,
    @Inject(BudgetLine.name) private readonly lineModel: TenantModelProxy<typeof BudgetLine>,
  ) {}

  async report(name: BudgetReportName, q: BudgetReportQueryDto) {
    const budget = await this.validator.getBudgetOrThrow(q.budgetId);
    if (name === 'capex' && budget.type !== BudgetType.Capex) {
      throw new ServiceError(ERRORS.REPORT_NOT_FOR_TYPE, 'The CAPEX report needs a CAPEX budget.', { type: budget.type });
    }
    const version = await this.pickVersion(budget, q.versionNo);
    const months = this.selectMonths(budget, q);
    const isCapex = budget.type === BudgetType.Capex;
    const isCash = budget.type === BudgetType.CashFlow;
    // Balance sheet: budget amounts and actuals are month-end balances (design §15).
    const balance = isBalanceBudget(budget.type);
    const extrasOf = (c: Cell): Extras =>
      isCapex ? { disposals: c.disposals } : isCash ? { inflow: c.inflow, outflow: c.outflow } : {};
    // A balance is read at the end of a column; movements add up over it.
    const span = (ms: string[]) => (balance ? ms.slice(-1) : ms);
    const branchFilter = q.branchesIds?.length ? q.branchesIds : null;
    const projectFilter = q.projectsIds?.length ? q.projectsIds : null;

    // Budget lines in scope: a line's branch/project is its own or the budget's.
    const effBranch = (id: number | null) => id ?? budget.branchId ?? null;
    const effProject = (id: number | null) => id ?? budget.projectId ?? null;
    const allLines = await this.lineModel().query().where('versionId', version.id).withGraphFetched('amounts');
    const lines = allLines.filter(
      (l) =>
        (!branchFilter || branchFilter.includes(effBranch(l.branchId))) &&
        (!projectFilter || projectFilter.includes(effProject(l.projectId))),
    );

    const accounts = await this.accountModel()
      .query()
      .whereIn('accountType', BUDGET_TYPE_ACCOUNT_TYPES[budget.type as BudgetType] ?? []);
    const accountsById = new Map(accounts.map((a) => [a.id, a]));
    // Lines on accounts whose type no longer fits are still reported.
    const missing = [...new Set(lines.map((l) => l.accountId).filter((id) => !accountsById.has(id)))];
    if (missing.length) for (const a of await this.accountModel().query().whereIn('id', missing)) accountsById.set(a.id, a);

    const facts: Fact[] = [];
    const metas = new Map<string, RowMeta>();
    const inRange = new Set(months);

    for (const line of lines) {
      const rowKey = `L${line.id}`;
      metas.set(rowKey, {
        rowKey,
        lineId: line.id,
        accountId: line.accountId,
        branchId: effBranch(line.branchId),
        projectId: effProject(line.projectId),
        note: line.note ?? null,
      });
      for (const a of (line as any).amounts ?? []) {
        const month = dateOnly(a.month);
        if (!inRange.has(month)) continue;
        facts.push({
          rowKey,
          accountId: line.accountId,
          branchId: effBranch(line.branchId),
          projectId: effProject(line.projectId),
          month,
          budget: toMilli(String(a.amount)),
          actual: 0,
          disposals: 0,
          inflow: 0,
          outflow: 0,
        });
      }
    }

    // Ledger scope: the budget's own branch/project, narrowed by the filter.
    const scope = (own: number | null, filter: number[] | null): number[] | null | 'none' =>
      own ? (filter && !filter.includes(own) ? 'none' : [own]) : filter;
    const branchScope = scope(budget.branchId, branchFilter);
    const projectScope = scope(budget.projectId, projectFilter);
    const cells =
      branchScope === 'none' || projectScope === 'none'
        ? []
        : await this.actuals.byDimensions({
            accountIds: [...accountsById.keys()],
            // Balances and the cash position need everything posted before the period too.
            fromDate: balance || isCash ? LEDGER_START : months[0],
            toDate: moment(months[months.length - 1]).endOf('month').format('YYYY-MM-DD'),
            branchIds: branchScope ?? undefined,
            projectIds: projectScope ?? undefined,
          });

    // Cash flow: money in the cash accounts before the period (opening cash position).
    let openingCash = 0;
    for (const c of cells) {
      const account = accountsById.get(c.accountId);
      if (!account) continue;
      if (c.month < months[0] && !balance) {
        openingCash += c.debit - c.credit;
        continue;
      }
      const line = matchLine(lines, c.accountId, c.branchId, c.projectId);
      const rowKey = line ? `L${line.id}` : `U${c.accountId}`;
      if (!line && !metas.has(rowKey)) {
        metas.set(rowKey, { rowKey, lineId: null, accountId: c.accountId, branchId: null, projectId: null, note: null });
      }
      const natural = account.accountNormal === 'credit' ? c.credit - c.debit : c.debit - c.credit;
      facts.push({
        rowKey,
        accountId: c.accountId,
        branchId: c.branchId,
        projectId: c.projectId,
        month: c.month < months[0] ? OPENING : c.month,
        // CAPEX: additions are the debits; disposals are shown on their own.
        budget: 0,
        actual: isCapex ? c.debit : natural,
        disposals: isCapex ? c.credit : 0,
        inflow: isCash ? c.debit : 0,
        outflow: isCash ? c.credit : 0,
      });
    }

    const columns = this.columnsFor(name === 'monthly-variance' ? 'month' : (q.columns ?? 'total'), budget, months);
    const [branches, projects] = await Promise.all([this.branchModel().query(), this.projectModel().query()]);
    const branchName = new Map(branches.map((b) => [b.id, b.name]));
    const projectName = new Map(projects.map((p) => [p.id, p.name]));
    const linesByAccount = new Map<number, number>();
    for (const l of lines) linesByAccount.set(l.accountId, (linesByAccount.get(l.accountId) ?? 0) + 1);

    const accountDto = (id: number) => {
      const a = accountsById.get(id);
      return {
        id: a.id,
        code: a.code,
        name: a.name,
        accountType: a.accountType,
        rootType: AccountTypesUtils.getType(a.accountType, 'rootType'),
        normal: a.accountNormal,
      };
    };
    // Balance sheet and cash: more assets, equity and cash is favorable, more liabilities is not.
    const direction = (accountId: number): Direction =>
      balance || isCash
        ? accountDto(accountId).rootType === 'liability' ? 'spend' : 'income'
        : SPEND_ROOTS.includes(accountDto(accountId).rootType) ? 'spend' : 'income';
    const rootDirection = (rootType: string): Direction =>
      balance || isCash ? (rootType === 'liability' ? 'spend' : 'income') : SPEND_ROOTS.includes(rootType) ? 'spend' : 'income';
    const dim = (id: number | null, names: Map<number, string>) => (id ? { id, name: names.get(id) ?? `#${id}` } : null);

    // Rows: by budget line (and unbudgeted account), or by branch/project and account.
    const dimension = name === 'branch' ? 'branch' : name === 'project' ? 'project' : null;
    const rowKeyOf = (f: Fact) =>
      dimension === 'branch' ? `B${f.branchId ?? 0}:${f.accountId}` : dimension === 'project' ? `P${f.projectId ?? 0}:${f.accountId}` : f.rowKey;
    const grouped = new Map<string, { facts: Fact[]; accountId: number; branchId: number | null; projectId: number | null }>();
    for (const f of facts) {
      const key = rowKeyOf(f);
      const g = grouped.get(key) ?? {
        facts: [],
        accountId: f.accountId,
        // Branch/project reports: one row per dimension value and account; the other dimension is not shown.
        branchId: dimension === 'branch' ? f.branchId : dimension ? null : metas.get(f.rowKey).branchId,
        projectId: dimension === 'project' ? f.projectId : dimension ? null : metas.get(f.rowKey).projectId,
      };
      g.facts.push(f);
      grouped.set(key, g);
    }
    // Budget lines without amounts in the period still show (budget 0).
    if (!dimension) {
      for (const meta of metas.values()) {
        if (!grouped.has(meta.rowKey)) grouped.set(meta.rowKey, { facts: [], accountId: meta.accountId, branchId: meta.branchId, projectId: meta.projectId });
      }
    }

    const toDate = moment(months[months.length - 1]).endOf('month').format('YYYY-MM-DD');
    const threshold = q.thresholdPercent ?? DEFAULT_THRESHOLD;
    const near = q.nearPercent ?? DEFAULT_NEAR;

    let rows = [...grouped.entries()].map(([key, g]) => {
      const byMonth = new Map<string, Cell>();
      for (const f of g.facts) addCell((byMonth.get(f.month) ?? byMonth.set(f.month, ZERO()).get(f.month)), f);
      if (balance) {
        // Movements → month-end balances: opening plus everything up to the month.
        let running = byMonth.get(OPENING)?.actual ?? 0;
        byMonth.delete(OPENING);
        for (const m of months) {
          const c = byMonth.get(m) ?? ZERO();
          running += c.actual;
          c.actual = running;
          byMonth.set(m, c);
        }
      }
      const dir = direction(g.accountId);
      const sumOf = (ms: string[]) =>
        span(ms).reduce((acc, m) => {
          const c = byMonth.get(m);
          return c ? addCell(acc, c) : acc;
        }, ZERO());
      const totalCell = sumOf(months);
      const total = variance(totalCell.budget, totalCell.actual, dir);
      const meta = metas.get(key);
      const lineId = dimension ? null : (meta?.lineId ?? null);
      const unbudgetedRow = dimension ? total.unbudgeted : lineId === null;
      const account = accountDto(g.accountId);

      // Drill-down to the General Ledger: same account, period and dimension.
      // Exact unless other lines of the account take part of its ledger rows.
      const drillBranches = g.branchId ? [g.branchId] : (branchScope && branchScope !== 'none' ? branchScope : []);
      const drillProjects = g.projectId ? [g.projectId] : (projectScope && projectScope !== 'none' ? projectScope : []);
      // (The GL cannot filter "no branch"/"no project", so those rows are not exact either.)
      const exact =
        dimension === 'branch' ? g.branchId !== null
        : dimension === 'project' ? g.projectId !== null
        : (linesByAccount.get(g.accountId) ?? 0) <= (lineId === null ? 0 : 1);

      return {
        key,
        lineId,
        account,
        branch: dim(g.branchId, branchName),
        project: dim(g.projectId, projectName),
        note: dimension ? null : (meta?.note ?? null),
        unbudgeted: unbudgetedRow,
        direction: dir,
        columns: columns.map((col) => {
          const c = sumOf(col.months);
          return { key: col.key, ...figuresDto(variance(c.budget, c.actual, dir), extrasOf(c)) };
        }),
        total: figuresDto(total, extrasOf(totalCell)),
        status: dir === 'spend' && !balance && !isCash ? utilizationStatus(total, near) : null,
        exception: isException(total, threshold),
        drilldown: {
          fromDate: months[0],
          toDate,
          accountsIds: [g.accountId],
          branchesIds: drillBranches,
          projectsIds: drillProjects,
          exact,
        },
        _cells: byMonth,
        _total: total,
      };
    });

    // Rows with nothing in the period: keep budget lines, drop empty ledger groups.
    rows = rows.filter(
      (r) => r.lineId !== null || r._total.actual !== 0 || r._total.budget !== 0 || [...r._cells.values()].some((c) => c.disposals !== 0 || c.inflow !== 0 || c.outflow !== 0),
    );
    if (q.includeUnbudgeted === false) rows = rows.filter((r) => !r.unbudgeted);

    if (name === 'revenue-achievement') rows = rows.filter((r) => r.account.rootType === 'income');
    if (name === 'expense-utilization') rows = rows.filter((r) => r.account.rootType === 'expense');
    if (name === 'exceptions') rows = rows.filter((r) => r.exception);

    const sortKey = (r: (typeof rows)[number]) =>
      `${r.branch?.name ?? ''}\u0000${r.project?.name ?? ''}\u0000${r.account.code ?? ''}\u0000${r.account.name}`;
    if (name === 'exceptions') {
      // Worst first: the amount by which the row is on the wrong side of its budget.
      const overrun = (r: (typeof rows)[number]) => (r.direction === 'income' ? -r._total.variance : r._total.variance);
      rows.sort((a, b) => overrun(b) - overrun(a) || sortKey(a).localeCompare(sortKey(b)));
    } else if (dimension) {
      rows.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    } else {
      rows.sort((a, b) => String(a.account.code ?? '').localeCompare(String(b.account.code ?? '')) || sortKey(a).localeCompare(sortKey(b)) || (a.lineId ?? 0) - (b.lineId ?? 0));
    }

    // Totals of the rows shown: by account root type, by branch/project, and net income.
    const sumRows = (list: typeof rows, dir: Direction, sign: (r: (typeof rows)[number]) => number = () => 1) => {
      const per = (ms: string[]) =>
        list.reduce((acc, r) => {
          for (const m of span(ms)) {
            const c = r._cells.get(m);
            if (c) addCell(acc, c, sign(r));
          }
          return acc;
        }, ZERO());
      const t = per(months);
      return {
        columns: columns.map((col) => {
          const c = per(col.months);
          return { key: col.key, ...figuresDto(variance(c.budget, c.actual, dir), extrasOf(c)) };
        }),
        total: figuresDto(variance(t.budget, t.actual, dir), extrasOf(t)),
      };
    };

    const ROOT_ORDER = ['income', 'expense', 'asset', 'liability', 'equity'];
    const roots = [...new Set(rows.map((r) => r.account.rootType))].sort((a, b) => ROOT_ORDER.indexOf(a) - ROOT_ORDER.indexOf(b));
    const groups = roots.map((rootType) => ({
      key: rootType,
      rootType,
      ...sumRows(rows.filter((r) => r.account.rootType === rootType), rootDirection(rootType)),
    }));

    // P&L-style budgets always have a net income line (zeros when a filter leaves no rows).
    const hasPl = PL_BUDGET_TYPES.includes(budget.type) || rows.some((r) => r.account.rootType === 'income' || r.account.rootType === 'expense');
    const plRows = rows.filter((r) => r.account.rootType === 'income' || r.account.rootType === 'expense');
    const netOf = (list: typeof rows) => sumRows(list, 'income', (r) => (r.account.rootType === 'income' ? 1 : -1));
    const netIncome = hasPl && name !== 'revenue-achievement' && name !== 'expense-utilization' && name !== 'exceptions' ? netOf(plRows) : null;

    const dimensionGroups = dimension
      ? [...new Set(rows.map((r) => (dimension === 'branch' ? r.branch?.id : r.project?.id) ?? 0))].map((id) => {
          const list = rows.filter((r) => ((dimension === 'branch' ? r.branch?.id : r.project?.id) ?? 0) === id);
          return {
            key: `${dimension}:${id}`,
            [dimension]: id ? { id, name: (dimension === 'branch' ? branchName : projectName).get(id) ?? `#${id}` } : null,
            groups: [...new Set(list.map((r) => r.account.rootType))].map((rootType) => ({
              rootType,
              ...sumRows(list.filter((r) => r.account.rootType === rootType), rootDirection(rootType)),
            })),
            netIncome: list.some((r) => r.account.rootType === 'income' || r.account.rootType === 'expense')
              ? netOf(list.filter((r) => r.account.rootType === 'income' || r.account.rootType === 'expense'))
              : null,
          };
        })
      : undefined;

    // Cash flow: cash at the start, and at the end of each column, actual and budgeted
    // (budgeted = the actual opening plus the budgeted net movements).
    let cashPosition = null;
    if (isCash) {
      const net = new Map<string, Cell>();
      for (const f of facts) if (f.month !== OPENING) addCell(net.get(f.month) ?? net.set(f.month, ZERO()).get(f.month), f);
      const closingAt = (last: string) => {
        let budgetCash = openingCash;
        let actualCash = openingCash;
        for (const m of months) {
          if (m > last) break;
          budgetCash += net.get(m)?.budget ?? 0;
          actualCash += net.get(m)?.actual ?? 0;
        }
        return { budget: fromMilli(budgetCash), actual: fromMilli(actualCash), variance: fromMilli(actualCash - budgetCash) };
      };
      cashPosition = {
        opening: fromMilli(openingCash),
        columns: columns.map((col) => ({ key: col.key, ...closingAt(col.months[col.months.length - 1]) })),
        closing: closingAt(months[months.length - 1]),
      };
    }

    return {
      report: name,
      closing: balance,
      cashPosition,
      budget: toBudgetDto(budget),
      version: toVersionDto(version),
      currencyCode: budget.currencyCode,
      period: { fromMonth: months[0], toMonth: months[months.length - 1], fromDate: months[0], toDate, months },
      filter: {
        branchesIds: branchFilter ?? [],
        projectsIds: projectFilter ?? [],
        columns: columns.length === 0 ? 'total' : name === 'monthly-variance' ? 'month' : (q.columns ?? 'total'),
        thresholdPercent: threshold,
        nearPercent: near,
        includeUnbudgeted: q.includeUnbudgeted !== false,
      },
      columns: columns.map(({ key, label, months: ms }) => ({ key, label, months: ms })),
      rows: rows.map(({ _cells, _total, ...r }) => r),
      groups,
      dimensions: dimensionGroups,
      netIncome,
    };
  }

  /** The report as CSV or XLSX: one row per report row, Budget/Actual/Variance/Variance % per column. */
  async exportReport(name: BudgetReportName, q: BudgetReportQueryDto, format: SheetFormat) {
    const r = await this.report(name, q);
    const isCapex = r.budget.type === BudgetType.Capex;
    const isCash = r.budget.type === BudgetType.CashFlow;
    const cols = [...r.columns.map((c) => ({ key: c.key, label: c.label })), { key: 'total', label: r.closing ? 'Closing' : 'Total' }];
    const metrics = [
      'Budget',
      'Actual',
      'Variance',
      'Variance %',
      name === 'revenue-achievement' ? 'Achievement %' : 'Used %',
      ...(isCapex ? ['Disposals'] : []),
      ...(isCash ? ['Inflows', 'Outflows'] : []),
    ];
    const header = ['Account code', 'Account', 'Branch', 'Project', ...cols.flatMap((c) => metrics.map((m) => (cols.length > 1 ? `${c.label} ${m}` : m))), 'Status'];
    const cellsOf = (f: any) => [
      f.budget,
      f.actual,
      f.variance,
      f.variancePercent ?? 'n/a',
      f.usedPercent ?? 'n/a',
      ...(isCapex ? [f.disposals ?? 0] : []),
      ...(isCash ? [f.inflows ?? 0, f.outflows ?? 0] : []),
    ];
    const figuresOf = (x: { columns: any[]; total: any }) => [...x.columns.flatMap(cellsOf), ...cellsOf(x.total)];
    const statusOf = (row: (typeof r.rows)[number]) =>
      row.unbudgeted ? 'Unbudgeted' : row.status ? row.status.replace('_', ' ') : row.total.favorable ? 'Favorable' : 'Unfavorable';

    const aoa: unknown[][] = [
      [`${r.budget.name} (${r.budget.reference}) v${r.version.versionNo}: ${REPORT_TITLES[name]}`],
      [`${r.period.fromMonth.slice(0, 7)} to ${r.period.toMonth.slice(0, 7)}, ${r.currencyCode}`],
      [],
      header,
      ...r.rows.map((row) => [row.account.code ?? '', row.account.name, row.branch?.name ?? '', row.project?.name ?? '', ...figuresOf(row), statusOf(row)]),
      [],
      ...r.groups.map((g) => ['', `Total ${g.rootType}`, '', '', ...figuresOf(g), '']),
      ...(r.netIncome ? [['', 'Net income', '', '', ...figuresOf(r.netIncome), '']] : []),
      ...(r.cashPosition
        ? [
            [],
            ['', 'Opening cash', '', '', r.cashPosition.opening],
            ['', 'Closing cash (budget / actual / variance)', '', '', r.cashPosition.closing.budget, r.cashPosition.closing.actual, r.cashPosition.closing.variance],
          ]
        : []),
    ];
    const base = `${r.budget.reference}-v${r.version.versionNo}-${name}`;
    return writeSheet(aoa, format, base, REPORT_TITLES[name].slice(0, 31));
  }

  /** Active version; else the latest approved or locked; else the latest. */
  private async pickVersion(budget: Budget, versionNo?: number): Promise<BudgetVersion> {
    if (versionNo) return this.validator.getVersionOrThrow(budget.id, versionNo);
    // Forecasts are never the budget (design §15): the fallback is the latest plan.
    const versions = (await this.versionModel().query().where('budgetId', budget.id).orderBy('versionNo', 'desc')).filter(
      (v) => v.kind !== BudgetVersionKind.Forecast && v.status !== BudgetVersionStatus.Cancelled,
    );
    const pick =
      versions.find((v) => v.id === budget.activeVersionId) ??
      versions.find((v) => v.status === BudgetVersionStatus.Approved || v.status === BudgetVersionStatus.Locked) ??
      versions[0];
    if (!pick) throw new ServiceError(ERRORS.VERSION_NOT_FOUND, 'The budget has no version.', null, 404);
    return pick;
  }

  private selectMonths(budget: Budget, q: BudgetReportQueryDto): string[] {
    const all = periodMonths(dateOnly(budget.startDate), dateOnly(budget.endDate));
    const from = q.fromMonth ? normalizeMonth(q.fromMonth) : all[0];
    const to = q.toMonth ? normalizeMonth(q.toMonth) : all[all.length - 1];
    if (!from || !to || from > to || !all.includes(from) || !all.includes(to)) {
      throw new ServiceError(ERRORS.INVALID_PERIOD, `Choose months between ${all[0].slice(0, 7)} and ${all[all.length - 1].slice(0, 7)}, the first not after the last.`);
    }
    return all.filter((m) => m >= from && m <= to);
  }

  /** Period columns. Quarters follow the budget's own months (Q1 = its first three). */
  private columnsFor(kind: 'total' | 'quarter' | 'month', budget: Budget, months: string[]): Column[] {
    if (kind === 'month') return months.map((m) => ({ key: m, label: moment(m).format('MMM YYYY'), months: [m] }));
    if (kind === 'quarter') {
      const all = periodMonths(dateOnly(budget.startDate), dateOnly(budget.endDate));
      const byQ = new Map<number, string[]>();
      for (const m of months) {
        const q = Math.floor(all.indexOf(m) / 3);
        byQ.set(q, [...(byQ.get(q) ?? []), m]);
      }
      return [...byQ.entries()].map(([q, ms]) => ({ key: `Q${q + 1}`, label: `Q${q + 1}`, months: ms }));
    }
    return [];
  }
}
