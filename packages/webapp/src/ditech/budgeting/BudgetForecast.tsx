// @ts-nocheck
// 103 DiTech: forecast versions, forecast vs budget and the rolling forecast (Phase 6, design §15).
import { useState } from 'react';
import { Button, Callout, Classes, Dialog, Drawer, FormGroup, HTMLSelect, HTMLTable, InputGroup, Intent, NumericInput, Spinner, Tag } from '@blueprintjs/core';
import { AppToaster } from '@/components';
import { useBudgetForecastVsBudget, useBudgetRollingForecast, useCreateBudgetForecast, useRefreshBudgetForecast } from '@/hooks/query/budgets';
import { errorMessage, fmt } from './BudgetWorkflow';
import { BudgetChart, ChartLegend } from './BudgetCharts';

export const METHOD_LABEL = {
  run_rate: 'Run rate (average of recent months)',
  budget: 'Budget remainder (keep the budget for the months ahead)',
  growth: 'Growth on the same month last year',
  seasonal: 'Seasonal (run rate spread like last year)',
};
const METHOD_SHORT = { run_rate: 'run rate', budget: 'budget remainder', growth: 'growth', seasonal: 'seasonal' };
const ROOT_LABEL = { income: 'Income', expense: 'Expenses', asset: 'Assets', liability: 'Liabilities', equity: 'Equity' };

const lastMonth = () => {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const monthLabel = (m: string) => new Date(`${m.slice(0, 7)}-01T00:00:00`).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
const clampMonth = (m: string, months: string[]) => {
  const first = months[0].slice(0, 7);
  const last = months[months.length - 1].slice(0, 7);
  return m < first ? first : m > last ? last : m;
};

/** One line under the workflow bar for forecast versions. */
export function forecastSummary(version) {
  const f = version.forecast;
  if (!f) return null;
  return `Forecast: actuals to ${f.asOfMonth ? monthLabel(f.asOfMonth) : '—'}, then ${METHOD_SHORT[f.method] ?? f.method}${
    f.method === 'growth' ? ` ${fmt(f.growthPercent ?? 0, 1)}%` : f.method === 'run_rate' || f.method === 'seasonal' ? ` over ${f.runRateMonths ?? 3} months` : ''
  }. Forecasts are not submitted; revise from one to adopt it.`;
}

/** Create a forecast (no `version`) or refresh a draft forecast version. */
export function ForecastDialog({ isOpen, budget, months, version = null, onClose, onDone }) {
  const refreshing = !!version;
  const stored = version?.forecast ?? {};
  const [method, setMethod] = useState(stored.method ?? 'run_rate');
  const [asOf, setAsOf] = useState((stored.asOfMonth ?? '').slice(0, 7) || clampMonth(lastMonth(), months));
  const [runRateMonths, setRunRateMonths] = useState(stored.runRateMonths ?? 3);
  const [growth, setGrowth] = useState(stored.growthPercent ?? 0);
  const [label, setLabel] = useState('');
  const { mutateAsync: create, isPending: creating } = useCreateBudgetForecast();
  const { mutateAsync: refresh, isPending: refreshingNow } = useRefreshBudgetForecast();

  const submit = async () => {
    const values = { method, asOfMonth: asOf, runRateMonths: Number(runRateMonths), growthPercent: Number(growth) };
    try {
      if (refreshing) {
        await refresh({ id: budget.id, versionNo: version.versionNo, lockVersion: version.lockVersion, ...values });
        AppToaster.show({ message: 'Forecast refreshed with the latest actuals.', intent: Intent.SUCCESS });
        onClose();
        onDone?.(version.versionNo);
      } else {
        const created = await create([budget.id, { ...values, label: label.trim() || undefined }]);
        AppToaster.show({ message: `Created forecast v${created.versionNo}.`, intent: Intent.SUCCESS });
        onClose();
        onDone?.(created.versionNo);
      }
    } catch (e) {
      AppToaster.show({ message: errorMessage(e, 'Could not make the forecast.'), intent: Intent.DANGER });
    }
  };

  const first = months[0].slice(0, 7);
  const minMonth = (() => {
    const d = new Date(`${first}-01T00:00:00`);
    d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  })();

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title={refreshing ? 'Refresh forecast' : 'New forecast'}>
      <div className={Classes.DIALOG_BODY}>
        <p>
          A forecast keeps the posted actuals up to the month you choose and projects the rest of the budget period.
          {refreshing ? ' Refreshing replaces this forecast’s amounts, including changes you typed.' : ' You can then adjust it in the grid.'}
        </p>
        <FormGroup label="Actuals up to (as of)">
          <InputGroup type="month" value={asOf} min={minMonth} max={months[months.length - 1].slice(0, 7)} onChange={(e) => setAsOf(e.target.value)} data-testid="forecast-as-of" />
        </FormGroup>
        <FormGroup label="Months after that">
          <HTMLSelect fill value={method} onChange={(e) => setMethod(e.target.value)} options={Object.entries(METHOD_LABEL).map(([value, text]) => ({ value, label: text }))} data-testid="forecast-method" />
        </FormGroup>
        {(method === 'run_rate' || method === 'seasonal') && (
          <FormGroup label="Average over" labelInfo="months">
            <NumericInput min={1} max={12} value={runRateMonths} onValueChange={(v) => setRunRateMonths(v)} />
          </FormGroup>
        )}
        {method === 'growth' && (
          <FormGroup label="Growth" labelInfo="% on last year">
            <NumericInput min={-100} max={1000} stepSize={1} value={growth} onValueChange={(v) => setGrowth(v)} />
          </FormGroup>
        )}
        {!refreshing && (
          <FormGroup label="Name (optional)">
            <InputGroup value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} placeholder={`Forecast ${asOf}`} />
          </FormGroup>
        )}
      </div>
      <div className={Classes.DIALOG_FOOTER}>
        <div className={Classes.DIALOG_FOOTER_ACTIONS}>
          <Button onClick={onClose}>Cancel</Button>
          <Button intent={Intent.PRIMARY} loading={creating || refreshingNow} disabled={!asOf} onClick={submit} data-testid="forecast-confirm">
            {refreshing ? 'Refresh' : 'Create forecast'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/** Budget, actual to date, remaining forecast and projected total, per line and in total. */
export function ForecastVsBudgetDrawer({ isOpen, budget, forecastVersionNo = null, onClose }) {
  const forecasts = budget.versions.filter((v) => v.kind === 'forecast' && v.status !== 'cancelled');
  const [chosen, setChosen] = useState(null);
  const versionNo = chosen ?? forecastVersionNo ?? forecasts[forecasts.length - 1]?.versionNo;
  const { data, isLoading, error } = useBudgetForecastVsBudget(budget.id, versionNo ? { forecastVersionNo: versionNo } : {}, { enabled: isOpen && !!versionNo });
  const total = data?.netIncome ?? (data?.groups.length === 1 ? data.groups[0] : null);

  return (
    <Drawer isOpen={isOpen} onClose={onClose} title="Forecast vs budget" size="75%">
      <div className={Classes.DRAWER_BODY} style={{ padding: 16 }}>
        {forecasts.length === 0 ? (
          <Callout intent={Intent.PRIMARY}>No forecast yet. Use Version › New forecast… to make one.</Callout>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
              <span>Forecast</span>
              <HTMLSelect value={versionNo} onChange={(e) => setChosen(Number(e.target.value))} options={forecasts.map((v) => ({ value: v.versionNo, label: `v${v.versionNo} ${v.label ?? ''}` }))} />
              {data && <span className={Classes.TEXT_MUTED}>compared with v{data.baseVersion.versionNo} {data.baseVersion.label ?? ''}; actuals to {data.asOfMonth ? monthLabel(data.asOfMonth) : '—'}</span>}
            </div>
            {isLoading && <Spinner />}
            {error && <Callout intent={Intent.DANGER}>{errorMessage(error, 'Could not load the forecast.')}</Callout>}
            {data && (
              <>
                {total && (
                  <>
                    <BudgetChart
                      testId="forecast-chart"
                      points={total.months.map((m) => ({ label: monthLabel(m.month), bar: m.budget, line: m.actual, dashed: m.actual === null ? m.forecast : null }))}
                    />
                    <ChartLegend dashed />
                  </>
                )}
                <HTMLTable compact striped style={{ width: '100%', marginTop: 12 }} data-testid="forecast-table">
                  <thead>
                    <tr>
                      <th>Account</th>
                      <th style={{ textAlign: 'right' }}>Budget</th>
                      <th style={{ textAlign: 'right' }}>Actual to date</th>
                      <th style={{ textAlign: 'right' }}>Forecast ahead</th>
                      <th style={{ textAlign: 'right' }}>Projected</th>
                      <th style={{ textAlign: 'right' }}>Variance</th>
                      <th style={{ textAlign: 'right' }}>%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((r, i) => (
                      <tr key={i}>
                        <td>
                          {r.account.code ? `${r.account.code} ` : ''}
                          {r.account.name}
                          {r.unbudgeted && (
                            <Tag minimal intent={Intent.WARNING} style={{ marginLeft: 6 }}>
                              unbudgeted
                            </Tag>
                          )}
                        </td>
                        <FigureCells f={r} />
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    {data.groups.map((g) => (
                      <tr key={g.rootType} style={{ fontWeight: 600 }}>
                        <td>Total {(ROOT_LABEL[g.rootType] ?? g.rootType).toLowerCase()}</td>
                        <FigureCells f={g} />
                      </tr>
                    ))}
                    {data.netIncome && (
                      <tr style={{ fontWeight: 700 }}>
                        <td>Net income</td>
                        <FigureCells f={data.netIncome} />
                      </tr>
                    )}
                  </tfoot>
                </HTMLTable>
              </>
            )}
          </>
        )}
      </div>
    </Drawer>
  );
}

function FigureCells({ f }) {
  return (
    <>
      <td style={{ textAlign: 'right' }}>{fmt(f.budget)}</td>
      <td style={{ textAlign: 'right' }}>{fmt(f.actualToDate)}</td>
      <td style={{ textAlign: 'right' }}>{fmt(f.forecastRemaining)}</td>
      <td style={{ textAlign: 'right' }}>{fmt(f.projected)}</td>
      <td style={{ textAlign: 'right', color: f.variance === 0 ? undefined : f.favorable ? '#0d8050' : '#c23030' }}>{fmt(f.variance)}</td>
      <td style={{ textAlign: 'right' }}>{f.variancePercent === null ? 'n/a' : `${fmt(f.variancePercent)}%`}</td>
    </>
  );
}

/** The next 12 months after the as-of month, from actuals; budget shown where the months fall in this budget. */
export function RollingForecastDrawer({ isOpen, budget, onClose }) {
  const [asOf, setAsOf] = useState(lastMonth());
  const [method, setMethod] = useState('run_rate');
  const { data, isLoading, error } = useBudgetRollingForecast(budget.id, { asOfMonth: asOf, method }, { enabled: isOpen && !!asOf });
  const total = data?.netIncome ?? (data?.groups.length === 1 ? data.groups[0] : null);
  return (
    <Drawer isOpen={isOpen} onClose={onClose} title="Rolling 12-month forecast" size="80%">
      <div className={Classes.DRAWER_BODY} style={{ padding: 16 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
          <span>Actuals up to</span>
          <InputGroup type="month" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
          <HTMLSelect value={method} onChange={(e) => setMethod(e.target.value)} options={['run_rate', 'growth', 'seasonal'].map((m) => ({ value: m, label: METHOD_LABEL[m] }))} />
        </div>
        {isLoading && <Spinner />}
        {error && <Callout intent={Intent.DANGER}>{errorMessage(error, 'Could not load the rolling forecast.')}</Callout>}
        {data && (
          <>
            {total && (
              <>
                <BudgetChart
                  testId="rolling-chart"
                  points={[
                    ...total.history.map((h) => ({ label: monthLabel(h.month), bar: null, line: h.actual })),
                    ...total.months.map((m) => ({ label: monthLabel(m.month), bar: m.budget, line: null, dashed: m.forecast })),
                  ]}
                />
                <ChartLegend dashed />
              </>
            )}
            <div style={{ overflowX: 'auto' }}>
              <HTMLTable compact striped style={{ width: '100%', marginTop: 12 }} data-testid="rolling-table">
                <thead>
                  <tr>
                    <th>Account</th>
                    {data.months.map((m) => (
                      <th key={m} style={{ textAlign: 'right' }}>
                        {monthLabel(m)}
                      </th>
                    ))}
                    <th style={{ textAlign: 'right' }}>12 months</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r, i) => (
                    <tr key={i}>
                      <td>
                        {r.account.code ? `${r.account.code} ` : ''}
                        {r.account.name}
                      </td>
                      {r.months.map((m) => (
                        <td key={m.month} style={{ textAlign: 'right' }} title={m.budget === null ? 'Outside this budget' : `Budget ${fmt(m.budget)}`}>
                          {fmt(m.forecast)}
                        </td>
                      ))}
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(r.forecastTotal)}</td>
                    </tr>
                  ))}
                </tbody>
                {data.netIncome && (
                  <tfoot>
                    <tr style={{ fontWeight: 700 }}>
                      <td>Net income</td>
                      {data.netIncome.months.map((m) => (
                        <td key={m.month} style={{ textAlign: 'right' }}>
                          {fmt(m.forecast)}
                        </td>
                      ))}
                      <td style={{ textAlign: 'right' }}>{fmt(data.netIncome.forecastTotal)}</td>
                    </tr>
                  </tfoot>
                )}
              </HTMLTable>
            </div>
          </>
        )}
      </div>
    </Drawer>
  );
}
