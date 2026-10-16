// @ts-nocheck
import { Fragment, useEffect, useMemo } from 'react';
import { Link, useHistory, useLocation, useParams } from 'react-router-dom';
import styled from 'styled-components';
import { keepPreviousData } from '@tanstack/react-query';
import {
  Button,
  ButtonGroup,
  Callout,
  Checkbox,
  Classes,
  Colors,
  HTMLSelect,
  Icon as BpIcon,
  Intent,
  Menu,
  MenuItem,
  NavbarDivider,
  NavbarGroup,
  NumericInput,
  Popover,
  Position,
  Spinner,
  Tag,
  Tooltip,
} from '@blueprintjs/core';
import { AppToaster, DashboardActionsBar, DashboardPageContent, EmptyStatus, Icon } from '@/components';
import { useBranches } from '@/hooks/query';
import { useProjects } from '@/hooks/query/projects';
import { useBudget, useBudgetReport } from '@/hooks/query/budgets';
import { useProjectsEnabled } from '@/ditech/projects/hooks';
import { BUDGET_TYPE_LABEL } from './BudgetDialogs';
import { currencyDecimals, formatAmount, toMilli } from './money';
import { statusLabel } from './BudgetsPage';
import { useBudgetFiles } from './files';
import { useBudgetingEnabled } from './hooks';

export const BUDGET_REPORTS = [
  { value: 'budget-vs-actual', label: 'Budget vs actual', hint: 'Budget, posted actuals and variance for each line.' },
  { value: 'monthly-variance', label: 'Monthly variance', hint: 'Budget against actual month by month.' },
  { value: 'branch', label: 'By branch', hint: 'Budget by the branch of each line; actuals by the branch they were posted to.' },
  { value: 'project', label: 'By project', hint: 'Budget by the project of each line; actuals by the project they were posted to.' },
  { value: 'revenue-achievement', label: 'Revenue achievement', hint: 'Income accounts: how much of the target was reached.' },
  { value: 'expense-utilization', label: 'Expense utilization', hint: 'Spending accounts: how much of the budget is used.' },
  { value: 'capex', label: 'CAPEX', hint: 'Additions to fixed assets against budget; disposals shown apart.' },
  { value: 'exceptions', label: 'Exceptions', hint: 'Unbudgeted spending and unfavorable variances past the threshold, worst first.' },
];

const STATUS = {
  over: { label: 'Over budget', intent: Intent.DANGER },
  near: { label: 'Near limit', intent: Intent.WARNING },
  on_track: { label: 'On track', intent: Intent.SUCCESS },
  unbudgeted: { label: 'Unbudgeted', intent: Intent.DANGER },
  no_activity: { label: 'No activity', intent: Intent.NONE },
};
const ROOT_LABEL = { income: 'Income', expense: 'Expenses', asset: 'Fixed assets' };

const pct = (v: number | null) => (v === null || v === undefined ? 'n/a' : `${v.toLocaleString('en-US', { maximumFractionDigits: 2 })}%`);

/** Report filters live in the URL, so a report can be bookmarked and shared. */
function useReportParams() {
  const location = useLocation();
  const history = useHistory();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const set = (patch: Record<string, string | number | boolean | null | undefined>) => {
    const next = new URLSearchParams(location.search);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === undefined || v === '') next.delete(k);
      else next.set(k, String(v));
    }
    history.replace({ pathname: location.pathname, search: next.toString() });
  };
  return { params, set };
}

/**
 * 103 DiTech: budget vs actual reports (Phase 4). Actuals are the posted
 * ledger, with the same rules as the Profit & Loss; drafts never count.
 */
export function BudgetReportsPage() {
  const { id } = useParams<{ id: string }>();
  const budgetId = Number(id);
  const history = useHistory();
  const enabled = useBudgetingEnabled();
  const projectsEnabled = useProjectsEnabled();
  const { params, set } = useReportParams();
  const { download } = useBudgetFiles();

  const { data: budget, isLoading: budgetLoading, error: budgetError } = useBudget(budgetId, { enabled });
  const { data: branches = [] } = useBranches(undefined, { enabled });
  const { data: projects = [] } = useProjects({ status: 'all' }, { enabled: enabled && projectsEnabled });

  const isCapexBudget = budget?.type === 'capex';
  const reportName = params.get('report') ?? (isCapexBudget ? 'capex' : 'budget-vs-actual');
  const columns = reportName === 'monthly-variance' ? 'month' : (params.get('columns') ?? 'total');
  const months = budget?.months ?? [];

  const query = useMemo(() => {
    if (!budget) return null;
    const q: Record<string, unknown> = { budgetId, columns };
    for (const k of ['versionNo', 'fromMonth', 'toMonth', 'thresholdPercent', 'nearPercent']) if (params.get(k)) q[k] = params.get(k);
    if (params.get('branch')) q.branchesIds = [Number(params.get('branch'))];
    if (params.get('project')) q.projectsIds = [Number(params.get('project'))];
    if (params.get('unbudgeted') === '0') q.includeUnbudgeted = false;
    return q;
  }, [budget, budgetId, columns, params]);

  const { data: report, isFetching, error, refetch } = useBudgetReport(reportName, query, { enabled: enabled && !!query, placeholderData: keepPreviousData });

  // A CAPEX budget only has the CAPEX report among the account-type views; others never have it.
  useEffect(() => {
    if (budget && !isCapexBudget && reportName === 'capex') set({ report: 'budget-vs-actual' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [budget, reportName]);

  if (!enabled) return <DashboardPageContent><EmptyStatus title="Budgeting is not in your plan" description={<p>Available on the Business plan and above.</p>} /></DashboardPageContent>;
  if (budgetError) return <DashboardPageContent><EmptyStatus title="Budget not found" description={<p>It may have been deleted.</p>} action={<Button onClick={() => history.push('/budgets')}>Back to budgets</Button>} /></DashboardPageContent>;
  if (budgetLoading || !budget) return <DashboardPageContent><div style={{ padding: 40 }}><Spinner /></div></DashboardPageContent>;

  const decimals = currencyDecimals(budget.currencyCode);
  const money = (n: number) => formatAmount(toMilli(n), decimals);
  const reportInfo = BUDGET_REPORTS.find((r) => r.value === reportName) ?? BUDGET_REPORTS[0];
  const reportOptions = BUDGET_REPORTS.filter((r) => (r.value === 'capex' ? isCapexBudget : true)).filter((r) => r.value !== 'project' || projectsEnabled);
  const exportQuery = () => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(query ?? {})) {
      if (Array.isArray(v)) v.forEach((x) => sp.append(k, String(x)));
      else sp.set(k, String(v));
    }
    return sp.toString();
  };
  const exportFile = (format: 'xlsx' | 'csv') =>
    download(`/api/budgets/reports/${reportName}/export?${exportQuery()}&format=${format}`, `${budget.reference}-${reportName}.${format}`).catch((e) =>
      AppToaster.show({ message: e.message, intent: Intent.DANGER }),
    );
  const serverError = error?.data?.errors?.[0]?.message ?? (error ? 'The report could not be loaded.' : null);

  return (
    <>
      <DashboardActionsBar>
        <NavbarGroup>
          <Button className={Classes.MINIMAL} icon="arrow-left" onClick={() => history.push(`/budgets/${budgetId}`)} aria-label="Back to the budget" />
          <HTMLSelect
            value={reportName}
            onChange={(e) => set({ report: e.target.value })}
            options={reportOptions.map((r) => ({ value: r.value, label: r.label }))}
            aria-label="Report"
            data-testid="report-select"
          />
          <NavbarDivider />
          {reportName !== 'monthly-variance' && (
            <ButtonGroup minimal>
              {[
                ['total', 'Total'],
                ['quarter', 'Quarters'],
                ['month', 'Months'],
              ].map(([v, label]) => (
                <Button key={v} active={columns === v} text={label} onClick={() => set({ columns: v === 'total' ? null : v })} />
              ))}
            </ButtonGroup>
          )}
          <Popover
            position={Position.BOTTOM_LEFT}
            minimal
            content={
              <Menu>
                <MenuItem text="Excel (.xlsx)" onClick={() => exportFile('xlsx')} />
                <MenuItem text="CSV" onClick={() => exportFile('csv')} />
              </Menu>
            }
          >
            <Button className={Classes.MINIMAL} icon={<Icon icon="file-export-16" iconSize={16} />} text="Export" />
          </Popover>
          <Button className={Classes.MINIMAL} icon="refresh" onClick={() => refetch()} loading={isFetching} aria-label="Refresh" />
        </NavbarGroup>
      </DashboardActionsBar>

      <DashboardPageContent>
        <div style={{ padding: '12px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
            <h2 style={{ margin: 0 }}>{reportInfo.label}</h2>
            <Link to={`/budgets/${budgetId}`}>{budget.name}</Link>
            <Tag minimal>{budget.reference}</Tag>
            <Tag minimal>{BUDGET_TYPE_LABEL[budget.type]}</Tag>
            <span className={Classes.TEXT_MUTED}>{budget.currencyCode}</span>
          </div>
          <p className={Classes.TEXT_MUTED} style={{ marginBottom: 10 }}>
            {reportInfo.hint} Actuals are posted transactions only (drafts are not counted), with the same rules as the Profit &amp; Loss.
          </p>

          <Filters>
            <label>
              Version
              <HTMLSelect
                value={params.get('versionNo') ?? report?.version.versionNo ?? ''}
                onChange={(e) => set({ versionNo: e.target.value })}
                options={budget.versions.map((v) => ({ value: v.versionNo, label: `v${v.versionNo} ${v.label ?? v.kind} — ${statusLabel(v.status)}` }))}
              />
            </label>
            <label>
              From
              <HTMLSelect
                value={params.get('fromMonth') ?? months[0]?.slice(0, 7)}
                onChange={(e) => set({ fromMonth: e.target.value === months[0]?.slice(0, 7) ? null : e.target.value })}
                options={months.map((m) => ({ value: m.slice(0, 7), label: monthLabel(m) }))}
                data-testid="from-month"
              />
            </label>
            <label>
              To
              <HTMLSelect
                value={params.get('toMonth') ?? months[months.length - 1]?.slice(0, 7)}
                onChange={(e) => set({ toMonth: e.target.value === months[months.length - 1]?.slice(0, 7) ? null : e.target.value })}
                options={months.map((m) => ({ value: m.slice(0, 7), label: monthLabel(m) }))}
                data-testid="to-month"
              />
            </label>
            {branches.length > 1 && !budget.branchId && (
              <label>
                Branch
                <HTMLSelect
                  value={params.get('branch') ?? ''}
                  onChange={(e) => set({ branch: e.target.value })}
                  options={[{ value: '', label: 'All branches' }, ...branches.map((b) => ({ value: b.id, label: b.name }))]}
                />
              </label>
            )}
            {projectsEnabled && projects.length > 0 && !budget.projectId && (
              <label>
                Project
                <HTMLSelect
                  value={params.get('project') ?? ''}
                  onChange={(e) => set({ project: e.target.value })}
                  options={[{ value: '', label: 'All projects' }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
                />
              </label>
            )}
            {reportName === 'exceptions' && (
              <label>
                Threshold %
                <NumericInput
                  value={params.get('thresholdPercent') ?? report?.filter.thresholdPercent ?? 10}
                  min={0}
                  max={1000}
                  minorStepSize={null}
                  onValueChange={(v) => set({ thresholdPercent: Number.isFinite(v) ? v : null })}
                  style={{ width: 70 }}
                />
              </label>
            )}
            {reportName === 'expense-utilization' && (
              <label>
                Near limit from %
                <NumericInput
                  value={params.get('nearPercent') ?? report?.filter.nearPercent ?? 90}
                  min={0}
                  max={100}
                  minorStepSize={null}
                  onValueChange={(v) => set({ nearPercent: Number.isFinite(v) ? v : null })}
                  style={{ width: 70 }}
                />
              </label>
            )}
            {reportName !== 'exceptions' && (
              <Checkbox
                checked={params.get('unbudgeted') !== '0'}
                label="Show unbudgeted accounts"
                onChange={(e) => set({ unbudgeted: e.currentTarget.checked ? null : '0' })}
                style={{ margin: 0 }}
              />
            )}
          </Filters>

          {(params.get('branch') || params.get('project')) && (
            <Callout icon="info-sign" style={{ marginBottom: 10 }}>
              Filtered: only lines of this {params.get('branch') ? 'branch' : 'project'} count as budget. Spending of the {params.get('branch') ? 'branch' : 'project'} on
              accounts budgeted only company-wide shows as unbudgeted.
            </Callout>
          )}
          {serverError && <Callout intent={Intent.DANGER} style={{ marginBottom: 10 }}>{serverError}</Callout>}

          {!report ? (
            <div style={{ padding: 40 }}><Spinner /></div>
          ) : (
            <>
              <Summary report={report} money={money} />
              {report.rows.length === 0 ? (
                <EmptyStatus
                  title={reportName === 'exceptions' ? 'No exceptions' : 'Nothing to report'}
                  description={<p>{reportName === 'exceptions' ? 'No unbudgeted spending and no variance past the threshold in this period.' : 'No budget lines or posted actuals in this period.'}</p>}
                />
              ) : (
                <ReportTable report={report} money={money} />
              )}
            </>
          )}
        </div>
      </DashboardPageContent>
    </>
  );
}

const monthLabel = (m: string) => new Date(`${m.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });

/** Headline numbers: each account group and net income, budget against actual. */
function Summary({ report, money }) {
  const cards = [
    ...report.groups.map((g) => ({ key: g.key, label: ROOT_LABEL[g.rootType] ?? g.rootType, f: g.total })),
    ...(report.netIncome ? [{ key: 'net', label: 'Net income', f: report.netIncome.total }] : []),
  ];
  if (cards.length === 0) return null;
  return (
    <Cards>
      {cards.map((c) => (
        <div key={c.key} className="card" data-testid={`summary-${c.key}`}>
          <div className="label">{c.label}</div>
          <div className="actual">{money(c.f.actual)}</div>
          <div className={Classes.TEXT_MUTED}>of {money(c.f.budget)} budget</div>
          <div style={{ color: c.f.favorable ? Colors.GREEN3 : Colors.RED3 }}>
            {c.f.variance >= 0 ? '+' : ''}
            {money(c.f.variance)} ({pct(c.f.variancePercent)})
          </div>
        </div>
      ))}
    </Cards>
  );
}

function ReportTable({ report, money }) {
  const isCapex = report.report === 'capex';
  const showUsed = ['revenue-achievement', 'expense-utilization', 'capex'].includes(report.report);
  const usedLabel = report.report === 'revenue-achievement' ? 'Achieved' : 'Used';
  const showStatus = ['expense-utilization', 'capex', 'exceptions'].includes(report.report);
  const cols = [...report.columns, { key: 'total', label: report.columns.length ? 'Total' : '', months: [] }];
  const metricCount = 4 + (showUsed ? 1 : 0) + (isCapex ? 1 : 0);
  const dimension = report.report === 'branch' ? 'branch' : report.report === 'project' ? 'project' : null;

  const figureCells = (f, bold = false) => (
    <>
      <td className="num">{money(f.budget)}</td>
      <td className="num">{money(f.actual)}</td>
      <td className="num" style={{ color: f.variance === 0 ? undefined : f.favorable ? Colors.GREEN3 : Colors.RED3, fontWeight: bold ? 600 : undefined }}>
        {money(f.variance)}
      </td>
      <td className="num">{pct(f.variancePercent)}</td>
      {showUsed && <td className="num">{pct(f.usedPercent)}</td>}
      {isCapex && <td className="num">{money(f.disposals ?? 0)}</td>}
    </>
  );
  const totalsRow = (label: string, t, key: string, className = 'group') => (
    <tr key={key} className={className}>
      <td className="account">{label}</td>
      {showStatus && <td />}
      {cols.map((c) => (
        <Fragment key={c.key}>{figureCells(c.key === 'total' ? t.total : t.columns.find((x) => x.key === c.key), true)}</Fragment>
      ))}
    </tr>
  );
  const glLink = (d) => {
    const sp = new URLSearchParams({ fromDate: d.fromDate, toDate: d.toDate });
    d.accountsIds.forEach((x) => sp.append('accountsIds', String(x)));
    d.branchesIds.forEach((x) => sp.append('branchesIds', String(x)));
    d.projectsIds.forEach((x) => sp.append('projectsIds', String(x)));
    return `/financial-reports/general-ledger?${sp.toString()}`;
  };
  const lineRow = (r) => (
    <tr key={r.key} data-testid="report-row" className={r.unbudgeted ? 'unbudgeted' : ''}>
      <td className="account">
        <div className="account-cell">
          <span className="code">{r.account.code}</span>
          <span className="name" title={r.note ?? undefined}>{r.account.name}</span>
          {!dimension && r.branch && <Tag minimal>{r.branch.name}</Tag>}
          {!dimension && r.project && <Tag minimal>{r.project.name}</Tag>}
          {r.unbudgeted && !showStatus && <Tag minimal intent={Intent.WARNING}>Unbudgeted</Tag>}
          <Tooltip content={r.drilldown.exact ? 'Open the General Ledger rows' : 'Open the General Ledger (includes rows of other lines of this account)'}>
            <Link to={glLink(r.drilldown)} className="drill" aria-label={`General Ledger for ${r.account.name}`}>
              <BpIcon icon="share" size={12} />
            </Link>
          </Tooltip>
        </div>
      </td>
      {showStatus && (
        <td>
          {r.status ? (
            <Tag minimal intent={STATUS[r.status]?.intent}>{STATUS[r.status]?.label ?? r.status}</Tag>
          ) : (
            <Tag minimal intent={r.total.favorable ? Intent.SUCCESS : Intent.DANGER}>{r.total.favorable ? 'Above target' : 'Below target'}</Tag>
          )}
        </td>
      )}
      {cols.map((c) => (
        <Fragment key={c.key}>{figureCells(c.key === 'total' ? r.total : r.columns.find((x) => x.key === c.key))}</Fragment>
      ))}
    </tr>
  );

  const sections = dimension
    ? (report.dimensions ?? []).map((d) => {
        const dimId = d[dimension]?.id ?? null;
        return {
          key: d.key,
          title: d[dimension]?.name ?? (dimension === 'branch' ? 'No branch' : 'No project'),
          rows: report.rows.filter((r) => (r[dimension]?.id ?? null) === dimId),
          groups: d.groups,
          netIncome: d.netIncome,
        };
      })
    : report.report === 'exceptions'
      ? [{ key: 'all', title: null, rows: report.rows, groups: [], netIncome: null }]
      : report.groups.map((g) => ({ key: g.key, title: ROOT_LABEL[g.rootType] ?? g.rootType, rows: report.rows.filter((r) => r.account.rootType === g.rootType), groups: [g], netIncome: null }));

  return (
    <TableWrap>
      <table className={Classes.HTML_TABLE}>
        <thead>
          {cols.length > 1 && (
            <tr>
              <th className="account" />
              {showStatus && <th />}
              {cols.map((c) => (
                <th key={c.key} colSpan={metricCount} className="period">
                  {c.label}
                </th>
              ))}
            </tr>
          )}
          <tr>
            <th className="account">Account</th>
            {showStatus && <th>Status</th>}
            {cols.map((c) => (
              <Fragment key={c.key}>
                <th className="num">Budget</th>
                <th className="num">Actual</th>
                <th className="num">Variance</th>
                <th className="num">Var %</th>
                {showUsed && <th className="num">{usedLabel}</th>}
                {isCapex && <th className="num">Disposals</th>}
              </Fragment>
            ))}
          </tr>
        </thead>
        <tbody>
          {sections.map((s) => (
            <Fragment key={s.key}>
              {s.title && (
                <tr className="section">
                  <td className="account" colSpan={1}>{s.title}</td>
                  <td colSpan={(showStatus ? 1 : 0) + cols.length * metricCount} />
                </tr>
              )}
              {s.rows.map(lineRow)}
              {dimension
                ? s.groups.map((g) => totalsRow(`Total ${ROOT_LABEL[g.rootType]?.toLowerCase() ?? g.rootType}`, g, `${s.key}-${g.rootType}`))
                : s.groups.map((g) => totalsRow(`Total ${(ROOT_LABEL[g.rootType] ?? g.rootType).toLowerCase()}`, g, `${s.key}-total`))}
              {dimension && s.netIncome && totalsRow(`Net income — ${s.title}`, s.netIncome, `${s.key}-net`)}
            </Fragment>
          ))}
        </tbody>
        {report.netIncome && (
          <tfoot>{totalsRow('Net income', report.netIncome, 'net', 'net')}</tfoot>
        )}
      </table>
    </TableWrap>
  );
}

const Filters = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px;
  margin-bottom: 12px;
  label {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
  }
`;

const Cards = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 14px;
  .card {
    min-width: 180px;
    padding: 10px 14px;
    border: 1px solid rgba(128, 128, 128, 0.25);
    border-radius: 6px;
  }
  .label {
    font-weight: 600;
    margin-bottom: 4px;
  }
  .actual {
    font-size: 18px;
    font-variant-numeric: tabular-nums;
  }
`;

const TableWrap = styled.div`
  overflow: auto;
  max-height: calc(100vh - 300px);
  table {
    border-collapse: separate;
    border-spacing: 0;
    width: max-content;
    min-width: 100%;
    font-size: 13px;
  }
  th,
  td {
    padding: 3px 8px !important;
    white-space: nowrap;
    border-bottom: 1px solid rgba(128, 128, 128, 0.15);
  }
  thead th {
    position: sticky;
    top: 0;
    z-index: 2;
    background: var(--color-background, #fff);
    font-weight: 600;
  }
  thead tr:nth-child(2) th {
    top: 26px;
  }
  th.period {
    text-align: center;
    border-left: 1px solid rgba(128, 128, 128, 0.25);
  }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  th.account,
  td.account {
    position: sticky;
    left: 0;
    z-index: 1;
    background: var(--color-background, #fff);
    min-width: 280px;
    max-width: 380px;
  }
  thead th.account {
    z-index: 3;
  }
  .account-cell {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .code {
    opacity: 0.6;
    min-width: 44px;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .drill {
    opacity: 0.5;
    margin-left: auto;
  }
  tr:hover .drill {
    opacity: 1;
  }
  tr.section td {
    font-weight: 600;
    padding-top: 10px !important;
  }
  tr.group td,
  tr.net td {
    font-weight: 600;
  }
  tr.net td {
    border-top: 2px solid rgba(128, 128, 128, 0.4);
  }
`;
