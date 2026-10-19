// @ts-nocheck
// 103 DiTech: budget dashboard (Phase 6, design §15). Every number comes from
// GET /api/budgets/dashboard, which takes them from the budget reports.
import { useHistory, useLocation } from 'react-router-dom';
import styled from 'styled-components';
import { Button, Callout, Classes, Colors, HTMLSelect, HTMLTable, InputGroup, Intent, NavbarGroup, Spinner, Tag } from '@blueprintjs/core';
import { DashboardActionsBar, DashboardPageContent, EmptyStatus } from '@/components';
import { useBudgetDashboard } from '@/hooks/query/budgets';
import { BUDGET_TYPE_LABEL } from './BudgetDialogs';
import { currencyDecimals, formatAmount, toMilli } from './money';
import { BudgetChart, ChartLegend } from './BudgetCharts';
import { useBudgetingEnabled } from './hooks';

const ROOT_LABEL = { income: 'Income', expense: 'Expenses', asset: 'Assets', liability: 'Liabilities', equity: 'Equity' };
const pct = (v: number | null | undefined) => (v === null || v === undefined ? 'n/a' : `${v.toLocaleString('en-US', { maximumFractionDigits: 1 })}%`);
const monthLabel = (m: string) => new Date(`${m.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
const monthYear = (m: string) => new Date(`${m.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** 103 DiTech: Financial > Budgets > Dashboard. Budget and as-of month live in the URL. */
export function BudgetDashboardPage() {
  const history = useHistory();
  const location = useLocation();
  const enabled = useBudgetingEnabled();
  const params = new URLSearchParams(location.search);
  const budgetId = params.get('budgetId') ? Number(params.get('budgetId')) : undefined;
  const asOfMonth = params.get('asOf') ?? undefined;
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(location.search);
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    history.replace({ search: next.toString() });
  };
  const { data, isLoading, error, isFetching } = useBudgetDashboard({ budgetId, asOfMonth });

  if (!enabled) return <DashboardPageContent><EmptyStatus title="Budgeting is not in your plan" description={<p>Available on the Business plan and above.</p>} /></DashboardPageContent>;

  const decimals = currencyDecimals(data?.currencyCode ?? 'USD');
  const money = (n: number | null | undefined) => (n === null || n === undefined ? '—' : formatAmount(toMilli(n), decimals));
  const k = data?.kpis;

  return (
    <>
      <DashboardActionsBar>
        <NavbarGroup>
          <Button className={Classes.MINIMAL} icon="arrow-left" onClick={() => history.push('/budgets')} aria-label="Back to budgets" />
          {data?.budgets?.length > 0 && (
            <HTMLSelect
              value={data.budget?.id ?? ''}
              onChange={(e) => set({ budgetId: e.target.value, asOf: null })}
              options={data.budgets.map((b) => ({ value: b.id, label: `${b.reference} · ${b.name}${b.hasActiveVersion ? '' : ' (not approved)'}` }))}
              data-testid="dashboard-budget"
            />
          )}
          {data?.months && (
            <>
              <span style={{ margin: '0 6px 0 12px' }}>Year to date up to</span>
              <InputGroup
                type="month"
                value={(data.asOfMonth ?? '').slice(0, 7)}
                min={data.months[0].slice(0, 7)}
                max={data.months[data.months.length - 1].slice(0, 7)}
                onChange={(e) => set({ asOf: e.target.value || null })}
                data-testid="dashboard-as-of"
              />
            </>
          )}
          {isFetching && <Spinner size={16} style={{ marginLeft: 8 }} />}
        </NavbarGroup>
        <NavbarGroup align="right">
          {data?.budget && <Button className={Classes.MINIMAL} icon="comparison" text="Reports" onClick={() => history.push(`/budgets/${data.budget.id}/reports`)} />}
          {data?.budget && <Button className={Classes.MINIMAL} icon="th" text="Open budget" onClick={() => history.push(`/budgets/${data.budget.id}`)} />}
        </NavbarGroup>
      </DashboardActionsBar>

      <DashboardPageContent>
        <Page data-testid="budget-dashboard">
          {isLoading && <Spinner />}
          {error && <Callout intent={Intent.DANGER}>{error?.data?.errors?.[0]?.message ?? 'Could not load the dashboard.'}</Callout>}
          {data && (
            <>
              <WorkflowStrip workflow={data.workflow} onOpen={(tab) => history.push(`/budgets/approvals?tab=${tab}`)} />
              {!data.budget ? (
                <EmptyStatus title="No budgets yet" description={<p>Create a budget to see it here.</p>} action={<Button intent={Intent.PRIMARY} onClick={() => history.push('/budgets')}>Budgets</Button>} />
              ) : (
                <>
                  <h3 style={{ margin: '4px 0 2px' }}>
                    {data.budget.name}{' '}
                    <Tag minimal>{BUDGET_TYPE_LABEL[data.budget.type] ?? data.budget.type}</Tag>{' '}
                    <span className={Classes.TEXT_MUTED} style={{ fontSize: 13, fontWeight: 400 }}>
                      v{data.version.versionNo} {data.version.label ?? ''} · {data.approved ? (data.activeVersion ? 'active approved version' : 'approved') : 'not approved yet: showing the latest draft'}
                    </span>
                  </h3>
                  <p className={Classes.TEXT_MUTED} style={{ marginTop: 0 }}>
                    {data.asOfMonth ? `Year to date: ${monthYear(data.months[0])} to ${monthYear(data.asOfMonth)}.` : 'The budget period has not started; no actuals yet.'} {data.currencyCode}.
                  </p>

                  <Cards>
                    {k.revenue && (
                      <Card testId="kpi-revenue" title="Revenue" value={money(k.revenue.ytdActual)} sub={`of ${money(k.revenue.ytdBudget)} budget to date`} note={`Achievement ${pct(k.revenue.achievementPercent)} · year budget ${money(k.revenue.annualBudget)}`} good={(k.revenue.achievementPercent ?? 100) >= 100} />
                    )}
                    {k.expenses && (
                      <Card testId="kpi-expenses" title="Expenses" value={money(k.expenses.ytdActual)} sub={`of ${money(k.expenses.ytdBudget)} budget to date`} note={`Used ${pct(k.expenses.utilizationPercent)} to date · ${pct(k.expenses.annualUsedPercent)} of the year · ${money(k.expenses.remaining)} left`} good={(k.expenses.utilizationPercent ?? 0) <= 100} />
                    )}
                    {k.netIncome && (
                      <Card testId="kpi-net-income" title="Net income" value={money(k.netIncome.ytdActual)} sub={`of ${money(k.netIncome.ytdBudget)} budget to date`} note={`Variance ${money(k.netIncome.ytdVariance)} · year budget ${money(k.netIncome.annualBudget)}`} good={k.netIncome.ytdVariance >= 0} />
                    )}
                    {!k.revenue && !k.expenses &&
                      k.groups.map((g) => (
                        <Card
                          key={g.rootType}
                          testId={`kpi-${g.rootType}`}
                          title={`${ROOT_LABEL[g.rootType] ?? g.rootType}${data.budget.type === 'balance_sheet' ? ' (balance)' : ''}`}
                          value={money(g.ytd?.actual)}
                          sub={`budget ${money(g.ytd?.budget)}`}
                          note={g.ytd ? `Variance ${money(g.ytd.variance)} (${pct(g.ytd.variancePercent)})` : ''}
                          good={g.ytd?.favorable ?? true}
                        />
                      ))}
                    {k.cashPosition && (
                      <Card testId="kpi-cash" title="Cash now" value={money(k.cashPosition.closing.actual)} sub={`budgeted ${money(k.cashPosition.closing.budget)}`} note={`Opening ${money(k.cashPosition.opening)}`} good={k.cashPosition.closing.variance >= 0} />
                    )}
                    <Card
                      testId="kpi-lines"
                      title="Lines"
                      value={`${k.lines.over} over`}
                      sub={`${k.lines.near} near the limit · ${k.lines.unbudgeted} unbudgeted`}
                      note={`${k.lines.exceptions} exceptions to date`}
                      good={k.lines.over === 0 && k.lines.unbudgeted === 0}
                    />
                  </Cards>

                  <Section>
                    <h4>By month</h4>
                    <BudgetChart
                      testId="dashboard-chart"
                      points={data.monthly.map((m) => {
                        const v = m.netIncome ?? sumGroups(m.groups);
                        return { label: monthLabel(m.month), bar: v.budget, line: v.actual };
                      })}
                    />
                    <ChartLegend />
                    <HTMLTable compact striped style={{ width: '100%', marginTop: 8 }} data-testid="dashboard-months">
                      <thead>
                        <tr>
                          <th>Month</th>
                          {Object.keys(data.monthly[0]?.groups ?? {}).map((root) => (
                            <th key={root} colSpan={2} style={{ textAlign: 'center' }}>
                              {ROOT_LABEL[root] ?? root}
                            </th>
                          ))}
                          {data.monthly[0]?.netIncome && <th colSpan={2} style={{ textAlign: 'center' }}>Net income</th>}
                          <th colSpan={2} style={{ textAlign: 'center' }}>Running total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.monthly.map((m) => (
                          <tr key={m.month}>
                            <td>{monthYear(m.month)}</td>
                            {Object.entries(m.groups).map(([root, g]) => (
                              <BudgetActual key={root} budget={g.budget} actual={g.actual} money={money} />
                            ))}
                            {m.netIncome && <BudgetActual budget={m.netIncome.budget} actual={m.netIncome.actual} money={money} />}
                            <BudgetActual budget={m.cumulative.budget} actual={m.cumulative.actual} money={money} />
                          </tr>
                        ))}
                      </tbody>
                    </HTMLTable>
                    <p className={Classes.TEXT_MUTED} style={{ fontSize: 12 }}>
                      Each pair is budget / actual. {data.budget.type === 'balance_sheet' ? 'Balance sheet figures are month-end balances.' : ''}
                    </p>
                  </Section>

                  <Columns>
                    <Section>
                      <h4>Largest variances to date</h4>
                      {data.topExceptions.length === 0 ? (
                        <p className={Classes.TEXT_MUTED}>No exceptions: nothing unbudgeted and no unfavorable variance past 10%.</p>
                      ) : (
                        <HTMLTable compact style={{ width: '100%' }} data-testid="dashboard-exceptions">
                          <tbody>
                            {data.topExceptions.map((r, i) => (
                              <tr key={i}>
                                <td>
                                  {r.account.code ? `${r.account.code} ` : ''}
                                  {r.account.name}
                                  {r.branch && <Tag minimal style={{ marginLeft: 4 }}>{r.branch.name}</Tag>}
                                  {r.project && <Tag minimal style={{ marginLeft: 4 }}>{r.project.name}</Tag>}
                                  {r.unbudgeted && <Tag minimal intent={Intent.WARNING} style={{ marginLeft: 4 }}>unbudgeted</Tag>}
                                </td>
                                <td style={{ textAlign: 'right' }}>{money(r.actual)}</td>
                                <td style={{ textAlign: 'right' }} className={Classes.TEXT_MUTED}>
                                  of {money(r.budget)}
                                </td>
                                <td style={{ textAlign: 'right', color: Colors.RED3 }}>{r.variancePercent === null ? 'n/a' : pct(r.variancePercent)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </HTMLTable>
                      )}
                      <Button minimal small rightIcon="arrow-right" text="All exceptions" onClick={() => history.push(`/budgets/${data.budget.id}/reports?report=exceptions`)} />
                    </Section>
                    <Section>
                      <h4>Year-end projection</h4>
                      {!data.projection ? (
                        <p className={Classes.TEXT_MUTED}>
                          No forecast yet. Open the budget and use Version › New forecast… to project the year from actuals.
                        </p>
                      ) : (
                        <HTMLTable compact style={{ width: '100%' }} data-testid="dashboard-projection">
                          <thead>
                            <tr>
                              <th />
                              <th style={{ textAlign: 'right' }}>Budget</th>
                              <th style={{ textAlign: 'right' }}>Projected</th>
                              <th style={{ textAlign: 'right' }}>Variance</th>
                            </tr>
                          </thead>
                          <tbody>
                            {[...data.projection.groups.map((g) => ({ ...g, label: ROOT_LABEL[g.rootType] ?? g.rootType })), ...(data.projection.netIncome ? [{ ...data.projection.netIncome, label: 'Net income' }] : [])].map((g) => (
                              <tr key={g.label}>
                                <td>{g.label}</td>
                                <td style={{ textAlign: 'right' }}>{money(g.budget)}</td>
                                <td style={{ textAlign: 'right' }}>{money(g.projected)}</td>
                                <td style={{ textAlign: 'right', color: g.variance === 0 ? undefined : g.favorable ? Colors.GREEN3 : Colors.RED3 }}>
                                  {money(g.variance)} ({pct(g.variancePercent)})
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </HTMLTable>
                      )}
                      {data.projection && (
                        <p className={Classes.TEXT_MUTED} style={{ fontSize: 12 }}>
                          From forecast v{data.projection.forecastVersionNo}, actuals to {data.projection.asOfMonth ? monthYear(data.projection.asOfMonth) : '—'}.
                        </p>
                      )}
                    </Section>
                  </Columns>
                </>
              )}
            </>
          )}
        </Page>
      </DashboardPageContent>
    </>
  );
}

const sumGroups = (groups: Record<string, { budget: number; actual: number | null }>) =>
  Object.values(groups).reduce(
    (a, g) => ({ budget: a.budget + g.budget, actual: g.actual === null || a.actual === null ? null : a.actual + g.actual }),
    { budget: 0, actual: 0 },
  );

function BudgetActual({ budget, actual, money }) {
  return (
    <>
      <td style={{ textAlign: 'right' }} className={Classes.TEXT_MUTED}>
        {money(budget)}
      </td>
      <td style={{ textAlign: 'right' }}>{actual === null ? '' : money(actual)}</td>
    </>
  );
}

function Card({ title, value, sub, note, good, testId }) {
  return (
    <div className="card" data-testid={testId}>
      <div className="label">{title}</div>
      <div className="value">{value}</div>
      <div className={Classes.TEXT_MUTED}>{sub}</div>
      {note && <div style={{ color: good ? Colors.GREEN3 : Colors.RED3, fontSize: 12, marginTop: 2 }}>{note}</div>}
    </div>
  );
}

function WorkflowStrip({ workflow, onOpen }) {
  const items = [
    { key: 'mine', label: 'Waiting for my approval', n: workflow.waitingForMe },
    { key: 'overrides', label: 'Override requests', n: workflow.pendingOverrides },
    { key: 'alerts', label: 'Alerts (30 days)', n: workflow.alertsLast30Days },
    { key: 'notifications', label: 'Unread notifications', n: workflow.unreadNotifications },
  ];
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }} data-testid="dashboard-workflow">
      {items.map((i) => (
        <Button key={i.key} small minimal={i.n === 0} intent={i.n > 0 ? Intent.PRIMARY : Intent.NONE} onClick={() => onOpen(i.key)}>
          {i.label}: {i.n}
        </Button>
      ))}
    </div>
  );
}

const Page = styled.div`
  padding: 12px 16px;
  max-width: 1200px;
`;

const Cards = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
  margin-bottom: 16px;
  .card {
    padding: 10px 14px;
    border: 1px solid rgba(128, 128, 128, 0.25);
    border-radius: 6px;
  }
  .label {
    font-weight: 600;
    margin-bottom: 4px;
  }
  .value {
    font-size: 20px;
    font-variant-numeric: tabular-nums;
  }
`;

const Section = styled.div`
  border: 1px solid rgba(128, 128, 128, 0.25);
  border-radius: 6px;
  padding: 10px 14px;
  margin-bottom: 16px;
  h4 {
    margin: 0 0 8px;
  }
  td,
  th {
    font-variant-numeric: tabular-nums;
  }
`;

const Columns = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(380px, 1fr));
  gap: 16px;
`;

export default BudgetDashboardPage;
