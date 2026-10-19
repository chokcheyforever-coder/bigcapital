// @ts-nocheck
import React, { useMemo, useState } from 'react';
import {
  Button,
  Callout,
  Checkbox,
  Classes,
  Dialog,
  FileInput,
  FormGroup,
  HTMLSelect,
  HTMLTable,
  InputGroup,
  Intent,
  NumericInput,
  Radio,
  RadioGroup,
  Switch,
  Tag,
  TextArea,
} from '@blueprintjs/core';
import { AppToaster } from '@/components';
import { useAccounts, useBranches } from '@/hooks/query';
import { useProjects } from '@/hooks/query/projects';
import { useBudgets, useCreateBudget, usePrefillBudget } from '@/hooks/query/budgets';
import { useProjectsEnabled } from '@/ditech/projects/hooks';
import { formatAmount, Milli, parseAmount, toMilli } from './money';
import { useBudgetFiles } from './files';

export const BUDGET_TYPES = [
  { value: 'profit_loss', label: 'Profit & Loss', hint: 'Income and expenses' },
  { value: 'revenue', label: 'Revenue', hint: 'Income accounts only' },
  { value: 'operating_expenses', label: 'Operating expenses', hint: 'Expense accounts only' },
  { value: 'operational', label: 'Operational', hint: 'Income and expenses, by branch or project' },
  { value: 'capex', label: 'Capital expenditure (CAPEX)', hint: 'Fixed-asset accounts' },
  { value: 'balance_sheet', label: 'Balance sheet', hint: 'Month-end balances of asset, liability and equity accounts' },
  { value: 'cash_flow', label: 'Cash flow', hint: 'Net money in and out of cash and bank accounts each month' },
];
export const BUDGET_TYPE_LABEL = Object.fromEntries(BUDGET_TYPES.map((t) => [t.value, t.label]));

/** Mirrors BUDGET_TYPE_ACCOUNT_TYPES on the server (the server checks it again). */
export const ALLOWED_ACCOUNT_TYPES = {
  profit_loss: ['income', 'other-income', 'cost-of-goods-sold', 'expense', 'other-expense'],
  operational: ['income', 'other-income', 'cost-of-goods-sold', 'expense', 'other-expense'],
  revenue: ['income', 'other-income'],
  operating_expenses: ['expense', 'other-expense'],
  capex: ['fixed-asset', 'non-current-asset'],
  balance_sheet: [
    'cash', 'bank', 'accounts-receivable', 'inventory', 'other-current-asset', 'fixed-asset', 'non-current-asset',
    'accounts-payable', 'credit-card', 'tax-payable', 'other-current-liability', 'long-term-liability', 'non-current-liability', 'equity',
  ],
  cash_flow: ['cash', 'bank'],
};

/** Budget types under spending control and with forecasts (server: CONTROLLABLE / FORECASTABLE_BUDGET_TYPES). */
export const CONTROLLABLE_TYPES = ['profit_loss', 'revenue', 'operating_expenses', 'operational', 'capex'];
export const FORECASTABLE_TYPES = [...CONTROLLABLE_TYPES, 'cash_flow'];
export const PL_TYPES = ['profit_loss', 'revenue', 'operating_expenses', 'operational'];

const ROOT_OF = {
  income: ['income', 'other-income'],
  expense: ['cost-of-goods-sold', 'expense', 'other-expense'],
  asset: ['cash', 'bank', 'accounts-receivable', 'inventory', 'other-current-asset', 'fixed-asset', 'non-current-asset'],
  liability: ['accounts-payable', 'credit-card', 'tax-payable', 'other-current-liability', 'long-term-liability', 'non-current-liability'],
  equity: ['equity'],
};
/** Root type (income, expense, asset, liability, equity) of an account type. */
export const rootTypeOf = (accountType: string) => Object.keys(ROOT_OF).find((root) => ROOT_OF[root].includes(accountType)) ?? 'expense';

const errorMessage = (error) => error?.data?.errors?.[0]?.message ?? error?.message ?? 'Something went wrong.';

// ---------------------------------------------------------------- create

export function CreateBudgetDialog({ isOpen, onClose, onCreated }) {
  const year = new Date().getFullYear() + 1;
  const [form, setForm] = useState({ name: '', type: 'profit_loss', fiscalYear: year, custom: false, startDate: '', endDate: '', branchId: '', projectId: '', description: '' });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const projectsEnabled = useProjectsEnabled();
  const { data: branches = [] } = useBranches(undefined, { enabled: isOpen });
  const { data: projects = [] } = useProjects({ status: 'active' }, { enabled: isOpen && projectsEnabled });
  const { mutateAsync, isPending } = useCreateBudget();

  const submit = () => {
    mutateAsync({
      name: form.name.trim(),
      type: form.type,
      fiscalYear: Number(form.fiscalYear),
      ...(form.custom ? { startDate: form.startDate, endDate: form.endDate } : {}),
      ...(form.branchId ? { branchId: Number(form.branchId) } : {}),
      ...(form.projectId ? { projectId: Number(form.projectId) } : {}),
      ...(form.description.trim() ? { description: form.description.trim() } : {}),
    })
      .then((budget) => {
        AppToaster.show({ message: `Budget ${budget.reference} created.`, intent: Intent.SUCCESS });
        onCreated(budget);
      })
      .catch((e) => AppToaster.show({ message: errorMessage(e), intent: Intent.DANGER }));
  };

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title="New budget" style={{ width: 480 }}>
      <div className={Classes.DIALOG_BODY}>
        <FormGroup label="Name" labelInfo="*">
          <InputGroup value={form.name} onChange={(e) => set('name', e.target.value)} autoFocus placeholder="e.g. Operating budget 2027" />
        </FormGroup>
        <FormGroup label="Type" helperText={BUDGET_TYPES.find((t) => t.value === form.type)?.hint}>
          <HTMLSelect fill value={form.type} onChange={(e) => set('type', e.target.value)} options={BUDGET_TYPES.map(({ value, label }) => ({ value, label }))} />
        </FormGroup>
        <FormGroup label="Fiscal year" helperText="12 months from your fiscal year start (Preferences > Organization).">
          <NumericInput value={form.fiscalYear} min={2000} max={2100} onValueChange={(v) => set('fiscalYear', v)} fill />
        </FormGroup>
        <Switch checked={form.custom} label="Use a different period (whole months, up to 24)" onChange={(e) => set('custom', e.target.checked)} />
        {form.custom && (
          <div style={{ display: 'flex', gap: 10 }}>
            <FormGroup label="First day" style={{ flex: 1 }}>
              <InputGroup type="date" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} />
            </FormGroup>
            <FormGroup label="Last day" style={{ flex: 1 }}>
              <InputGroup type="date" value={form.endDate} onChange={(e) => set('endDate', e.target.value)} />
            </FormGroup>
          </div>
        )}
        {branches.length > 0 && (
          <FormGroup label="Branch" helperText="Optional: a budget for one branch only.">
            <HTMLSelect fill value={form.branchId} onChange={(e) => set('branchId', e.target.value)} options={[{ value: '', label: 'All branches' }, ...branches.map((b) => ({ value: b.id, label: b.name }))]} />
          </FormGroup>
        )}
        {projectsEnabled && projects.length > 0 && (
          <FormGroup label="Project" helperText="Optional: a budget for one project only.">
            <HTMLSelect fill value={form.projectId} onChange={(e) => set('projectId', e.target.value)} options={[{ value: '', label: 'No project' }, ...projects.map((p) => ({ value: p.id, label: p.name }))]} />
          </FormGroup>
        )}
        <FormGroup label="Description">
          <TextArea fill value={form.description} onChange={(e) => set('description', e.target.value)} />
        </FormGroup>
      </div>
      <div className={Classes.DIALOG_FOOTER}>
        <div className={Classes.DIALOG_FOOTER_ACTIONS}>
          <Button onClick={onClose}>Cancel</Button>
          <Button intent={Intent.PRIMARY} loading={isPending} disabled={!form.name.trim() || (form.custom && (!form.startDate || !form.endDate))} onClick={submit}>
            Create budget
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- add lines

export function AddLinesDialog({ isOpen, onClose, budgetType, existingKeys, onAdd }) {
  const projectsEnabled = useProjectsEnabled();
  const { data: accounts = [] } = useAccounts({}, { enabled: isOpen });
  const { data: branches = [] } = useBranches(undefined, { enabled: isOpen });
  const { data: projects = [] } = useProjects({ status: 'active' }, { enabled: isOpen && projectsEnabled });
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [branchId, setBranchId] = useState('');
  const [projectId, setProjectId] = useState('');
  const allowed = ALLOWED_ACCOUNT_TYPES[budgetType] ?? [];

  const list = useMemo(
    () =>
      (accounts ?? [])
        .filter((a) => allowed.includes(a.accountType) && a.active !== false)
        .filter((a) => !search.trim() || `${a.code ?? ''} ${a.name}`.toLowerCase().includes(search.trim().toLowerCase()))
        .sort((a, b) => String(a.code ?? '').localeCompare(String(b.code ?? ''))),
    [accounts, allowed, search],
  );
  const keyFor = (a) => `${a.id}:${branchId || 0}:${projectId || 0}`;

  const add = () => {
    const chosen = (accounts ?? []).filter((a) => picked.has(a.id));
    onAdd(
      chosen.map((a) => ({
        account: { id: a.id, code: a.code, name: a.name, accountType: a.accountType, rootType: a.accountRootType },
        branchId: branchId ? Number(branchId) : null,
        projectId: projectId ? Number(projectId) : null,
        note: null,
        assumption: null,
      })),
    );
    setPicked(new Set());
    onClose();
  };

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title="Add lines" style={{ width: 560 }}>
      <div className={Classes.DIALOG_BODY}>
        <InputGroup leftIcon="search" placeholder="Search accounts" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
        <div style={{ maxHeight: 320, overflow: 'auto', margin: '10px 0', border: '1px solid rgba(0,0,0,.1)', padding: 6 }}>
          {list.map((a) => {
            const exists = existingKeys.has(keyFor(a));
            return (
              <Checkbox
                key={a.id}
                disabled={exists}
                checked={picked.has(a.id) || exists}
                labelElement={
                  <span>
                    <span style={{ color: '#888', marginRight: 6 }}>{a.code}</span>
                    {a.name} {exists && <Tag minimal>already in the budget</Tag>}
                  </span>
                }
                onChange={() =>
                  setPicked((prev) => {
                    const next = new Set(prev);
                    next.has(a.id) ? next.delete(a.id) : next.add(a.id);
                    return next;
                  })
                }
              />
            );
          })}
          {list.length === 0 && <p className={Classes.TEXT_MUTED}>No matching accounts for this type of budget.</p>}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {branches.length > 0 && (
            <FormGroup label="Branch" style={{ flex: 1 }}>
              <HTMLSelect fill value={branchId} onChange={(e) => setBranchId(e.target.value)} options={[{ value: '', label: 'No branch' }, ...branches.map((b) => ({ value: b.id, label: b.name }))]} />
            </FormGroup>
          )}
          {projectsEnabled && projects.length > 0 && (
            <FormGroup label="Project" style={{ flex: 1 }}>
              <HTMLSelect fill value={projectId} onChange={(e) => setProjectId(e.target.value)} options={[{ value: '', label: 'No project' }, ...projects.map((p) => ({ value: p.id, label: p.name }))]} />
            </FormGroup>
          )}
        </div>
      </div>
      <div className={Classes.DIALOG_FOOTER}>
        <div className={Classes.DIALOG_FOOTER_ACTIONS}>
          <Button onClick={onClose}>Cancel</Button>
          <Button intent={Intent.PRIMARY} disabled={picked.size === 0} onClick={add}>
            Add {picked.size || ''} line{picked.size === 1 ? '' : 's'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- note

export function LineNoteDialog({ line, readOnly, onClose, onSave }) {
  const [note, setNote] = useState(line?.note ?? '');
  const [assumption, setAssumption] = useState(line?.assumption ?? '');
  React.useEffect(() => {
    setNote(line?.note ?? '');
    setAssumption(line?.assumption ?? '');
  }, [line]);
  return (
    <Dialog isOpen={!!line} onClose={onClose} title={line ? `${line.account.code ?? ''} ${line.account.name}` : ''} style={{ width: 460 }}>
      <div className={Classes.DIALOG_BODY}>
        <FormGroup label="Note">
          <TextArea fill growVertically value={note} readOnly={readOnly} onChange={(e) => setNote(e.target.value)} />
        </FormGroup>
        <FormGroup label="Assumption" helperText="How the amounts were worked out, e.g. 3 staff × $800 + 5% raise from July.">
          <TextArea fill growVertically value={assumption} readOnly={readOnly} onChange={(e) => setAssumption(e.target.value)} />
        </FormGroup>
      </div>
      <div className={Classes.DIALOG_FOOTER}>
        <div className={Classes.DIALOG_FOOTER_ACTIONS}>
          <Button onClick={onClose}>{readOnly ? 'Close' : 'Cancel'}</Button>
          {!readOnly && (
            <Button intent={Intent.PRIMARY} onClick={() => onSave({ note: note.trim() || null, assumption: assumption.trim() || null })}>
              Apply
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- allocate

/**
 * Spreads amounts over the months of the selected lines. Uses the server's
 * allocation (one implementation for every client), then fills the grid; the
 * change is saved with the next Save.
 */
export function AllocateDialog({ isOpen, onClose, months, decimals, lines, allocate, onApply }) {
  const [method, setMethod] = useState('equal');
  const [source, setSource] = useState('current');
  const [amountText, setAmountText] = useState('');
  const [valuesText, setValuesText] = useState('');
  const [growth, setGrowth] = useState(5);
  const [busy, setBusy] = useState(false);

  const values = valuesText.split(/[\s,;]+/).filter(Boolean).map(Number);
  const parsedAmount = parseAmount(amountText, decimals);
  const valuesOk = method === 'equal' || method === 'growth' || (values.length === months.length && values.every((v) => Number.isFinite(v) && v >= 0));
  const amountOk = method === 'growth' || source === 'current' || (parsedAmount.ok && parsedAmount.value !== null);

  const run = async () => {
    setBusy(true);
    try {
      const updates = [];
      for (const line of lines) {
        const current = months.reduce((a, m) => a + (line.values[m] ?? 0), 0);
        const body =
          method === 'growth'
            ? { method, growthPercent: Number(growth), baseAmounts: months.map((m) => ({ month: m, amount: (line.values[m] ?? 0) / 1000 })) }
            : { method, amount: source === 'current' ? current / 1000 : (parsedAmount as any).value / 1000, ...(method !== 'equal' ? { values } : {}) };
        const result = await allocate(body);
        for (const m of months) updates.push({ key: line.key, month: m, value: toMilli(result.amounts[m] ?? 0) });
      }
      onApply(updates);
      onClose();
    } catch (e) {
      AppToaster.show({ message: errorMessage(e), intent: Intent.DANGER });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title={`Allocate ${lines.length} line${lines.length === 1 ? '' : 's'}`} style={{ width: 520 }}>
      <div className={Classes.DIALOG_BODY}>
        <RadioGroup label="Method" selectedValue={method} onChange={(e) => setMethod(e.currentTarget.value)}>
          <Radio value="equal" label="Equal months" />
          <Radio value="percentage" label="Percentage per month (adds up to 100)" />
          <Radio value="seasonal" label="Seasonal weights (any numbers, e.g. 1 1 2 3 …)" />
          <Radio value="growth" label="Grow the current months by a percentage" />
        </RadioGroup>
        {method !== 'growth' && (
          <RadioGroup label="Amount to spread" selectedValue={source} onChange={(e) => setSource(e.currentTarget.value)} inline>
            <Radio value="current" label="Each line's current total" />
            <Radio value="typed" label="This amount for each line" />
          </RadioGroup>
        )}
        {method !== 'growth' && source === 'typed' && (
          <FormGroup label="Amount" intent={amountText && !parsedAmount.ok ? Intent.DANGER : Intent.NONE} helperText={amountText && !parsedAmount.ok ? parsedAmount.error : undefined}>
            <InputGroup value={amountText} onChange={(e) => setAmountText(e.target.value)} placeholder="12,000" />
          </FormGroup>
        )}
        {(method === 'percentage' || method === 'seasonal') && (
          <FormGroup
            label={`${months.length} values, one per month`}
            helperText={values.length !== months.length ? `${values.length} of ${months.length} given` : method === 'percentage' ? `Adds up to ${values.reduce((a, b) => a + b, 0)}` : undefined}
          >
            <TextArea fill value={valuesText} onChange={(e) => setValuesText(e.target.value)} placeholder={method === 'percentage' ? '8 8 8 8 8 8 9 9 9 9 8 8' : '1 1 1 1 1 1 2 2 2 2 3 3'} />
          </FormGroup>
        )}
        {method === 'growth' && (
          <FormGroup label="Growth %" helperText="Negative for a reduction.">
            <NumericInput value={growth} onValueChange={(v) => setGrowth(v)} min={-100} max={1000} stepSize={1} minorStepSize={0.1} />
          </FormGroup>
        )}
        <Callout intent={Intent.PRIMARY} icon="info-sign">
          Every line's months add up to its amount exactly; any rounding goes to the last month. Nothing is saved until you click Save.
        </Callout>
      </div>
      <div className={Classes.DIALOG_FOOTER}>
        <div className={Classes.DIALOG_FOOTER_ACTIONS}>
          <Button onClick={onClose}>Cancel</Button>
          <Button intent={Intent.PRIMARY} loading={busy} disabled={!valuesOk || !amountOk || lines.length === 0} onClick={run}>
            Allocate
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- prefill

export function PrefillDialog({ isOpen, onClose, budget, decimals, onApply }) {
  const projectsEnabled = useProjectsEnabled();
  const [source, setSource] = useState('actuals');
  const [yearsBack, setYearsBack] = useState(1);
  const [growth, setGrowth] = useState(0);
  const [splitBy, setSplitBy] = useState('none');
  const [sourceBudgetId, setSourceBudgetId] = useState('');
  const [preview, setPreview] = useState(null);
  const { data: budgets } = useBudgets({ pageSize: 200 }, { enabled: isOpen && source === 'budget' });
  const { mutateAsync, isPending } = usePrefillBudget();

  const body = () =>
    source === 'actuals'
      ? { source, yearsBack: Number(yearsBack), growthPercent: Number(growth), splitBy }
      : { source, sourceBudgetId: Number(sourceBudgetId), growthPercent: Number(growth) };

  const run = () =>
    mutateAsync([budget.id, body()])
      .then(setPreview)
      .catch((e) => AppToaster.show({ message: errorMessage(e), intent: Intent.DANGER }));

  const close = () => {
    setPreview(null);
    onClose();
  };

  return (
    <Dialog isOpen={isOpen} onClose={close} title="Prefill from history" style={{ width: 620 }}>
      <div className={Classes.DIALOG_BODY}>
        <RadioGroup selectedValue={source} onChange={(e) => { setSource(e.currentTarget.value); setPreview(null); }} inline>
          <Radio value="actuals" label="Posted actuals" />
          <Radio value="budget" label="Another budget" />
        </RadioGroup>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {source === 'actuals' ? (
            <>
              <FormGroup label="Years back" helperText="1 = the same months last year">
                <NumericInput value={yearsBack} min={1} max={10} onValueChange={(v) => { setYearsBack(v); setPreview(null); }} />
              </FormGroup>
              <FormGroup label="Lines">
                <HTMLSelect value={splitBy} onChange={(e) => { setSplitBy(e.target.value); setPreview(null); }} options={[{ value: 'none', label: 'One per account' }, { value: 'branch', label: 'Per account and branch' }, ...(projectsEnabled ? [{ value: 'project', label: 'Per account and project' }] : [])]} />
              </FormGroup>
            </>
          ) : (
            <FormGroup label="Budget" style={{ minWidth: 300 }}>
              <HTMLSelect
                fill
                value={sourceBudgetId}
                onChange={(e) => { setSourceBudgetId(e.target.value); setPreview(null); }}
                options={[{ value: '', label: 'Choose a budget' }, ...(budgets?.data ?? []).filter((b) => b.id !== budget.id).map((b) => ({ value: b.id, label: `${b.reference} — ${b.name} (${b.fiscalYear})` }))]}
              />
            </FormGroup>
          )}
          <FormGroup label="Growth %" helperText="Negative for a reduction">
            <NumericInput value={growth} min={-100} max={1000} onValueChange={(v) => { setGrowth(v); setPreview(null); }} />
          </FormGroup>
        </div>
        {preview && (
          <Callout intent={preview.lines.length ? Intent.SUCCESS : Intent.WARNING} title={`${preview.lines.length} line${preview.lines.length === 1 ? '' : 's'}, total ${formatAmount(toMilli(preview.total), decimals)}`}>
            {preview.source.type === 'actuals'
              ? `Posted transactions ${preview.source.fromDate} to ${preview.source.toDate}${growth ? `, ${growth > 0 ? '+' : ''}${growth}%` : ''}.`
              : `From ${preview.source.reference} version ${preview.source.versionNo}${growth ? `, ${growth > 0 ? '+' : ''}${growth}%` : ''}.`}{' '}
            Applying replaces these lines' months in the grid; other lines stay as they are. Nothing is saved until you click Save.
            {preview.lines.length > 0 && (
              <HTMLTable compact style={{ width: '100%', marginTop: 8 }}>
                <tbody>
                  {preview.lines.slice(0, 8).map((l) => (
                    <tr key={`${l.accountId}:${l.branchId}:${l.projectId}`}>
                      <td>{l.account.code} {l.account.name}</td>
                      <td style={{ textAlign: 'right' }}>{formatAmount(toMilli(l.total), decimals)}</td>
                    </tr>
                  ))}
                  {preview.lines.length > 8 && (
                    <tr>
                      <td colSpan={2} className={Classes.TEXT_MUTED}>… and {preview.lines.length - 8} more</td>
                    </tr>
                  )}
                </tbody>
              </HTMLTable>
            )}
          </Callout>
        )}
      </div>
      <div className={Classes.DIALOG_FOOTER}>
        <div className={Classes.DIALOG_FOOTER_ACTIONS}>
          <Button onClick={close}>Cancel</Button>
          {!preview ? (
            <Button intent={Intent.PRIMARY} loading={isPending} disabled={source === 'budget' && !sourceBudgetId} onClick={run}>
              Preview
            </Button>
          ) : (
            <Button intent={Intent.PRIMARY} disabled={preview.lines.length === 0} onClick={() => { onApply(preview); close(); }}>
              Apply to the grid
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- import

export function ImportDialog({ isOpen, onClose, budget, versionNo, lockVersion, isDirty, onImported }) {
  const { download, upload } = useBudgetFiles();
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const base = `/api/budgets/${budget.id}`;

  const check = async () => {
    setBusy(true);
    const res = await upload(`${base}/versions/${versionNo}/import/preview`, file).finally(() => setBusy(false));
    if (!res.ok) return AppToaster.show({ message: res.body?.errors?.[0]?.message ?? res.body?.message ?? 'The file could not be checked.', intent: Intent.DANGER });
    setReport(res.body);
  };

  const commit = async () => {
    setBusy(true);
    const res = await upload(`${base}/versions/${versionNo}/import`, file, { lock_version: String(lockVersion) }).finally(() => setBusy(false));
    if (res.status === 409) return AppToaster.show({ message: 'Someone else saved this budget meanwhile. Reload, then import again.', intent: Intent.WARNING });
    if (!res.ok) return AppToaster.show({ message: res.body?.errors?.[0]?.message ?? 'The import failed.', intent: Intent.DANGER });
    if (!res.body.committed) return setReport(res.body);
    AppToaster.show({ message: `Imported ${res.body.summary.valid} rows (${res.body.summary.cells} amounts).`, intent: Intent.SUCCESS });
    setFile(null);
    setReport(null);
    onImported();
    onClose();
  };

  const s = report?.summary;
  const blocked = !report || report.file_errors.length > 0 || s.invalid > 0 || s.rows === 0;
  return (
    <Dialog isOpen={isOpen} onClose={onClose} title="Import from Excel or CSV" style={{ width: 720 }}>
      <div className={Classes.DIALOG_BODY}>
        <p>
          One row per account (code or name), optional Branch and Project, and one column per month (2027-01 or Jan 2027). Empty cells leave a month as it is; 0 sets it
          to zero. Download a template:{' '}
          <Button small minimal icon="download" text="Excel" onClick={() => download(`${base}/import-template?format=xlsx`, 'template.xlsx')} />
          <Button small minimal icon="download" text="CSV" onClick={() => download(`${base}/import-template?format=csv`, 'template.csv')} />
        </p>
        {isDirty && (
          <Callout intent={Intent.WARNING} style={{ marginBottom: 10 }}>
            You have unsaved changes in the grid. Save or discard them first: the import works on the saved version.
          </Callout>
        )}
        <FileInput
          fill
          text={file ? file.name : 'Choose a .xlsx or .csv file…'}
          inputProps={{ accept: '.xlsx,.xls,.csv' }}
          onInputChange={(e) => {
            setFile((e.target as HTMLInputElement).files?.[0] ?? null);
            setReport(null);
          }}
        />
        {report && (
          <div style={{ marginTop: 12 }}>
            {report.file_errors.map((e) => (
              <Callout key={e} intent={Intent.DANGER} style={{ marginBottom: 6 }}>{e}</Callout>
            ))}
            {report.ignored_columns.length > 0 && <p className={Classes.TEXT_MUTED}>Ignored columns: {report.ignored_columns.join(', ')}</p>}
            {s && s.rows > 0 && (
              <>
                <Callout intent={s.invalid ? Intent.DANGER : Intent.SUCCESS}>
                  {s.rows} rows: {s.valid} ready, {s.invalid} with errors. {s.months.length} months, {s.cells} amounts.
                  {s.invalid > 0 && ' Fix the rows below and check the file again: nothing is imported until every row is valid.'}
                </Callout>
                <div style={{ maxHeight: 280, overflow: 'auto', marginTop: 8 }}>
                  <HTMLTable compact striped style={{ width: '100%' }}>
                    <thead>
                      <tr>
                        <th>Row</th>
                        <th>Account</th>
                        <th>Branch / project</th>
                        <th>Amounts</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...report.rows].sort((a, b) => (a.status === b.status ? a.row - b.row : a.status === 'error' ? -1 : 1)).map((r) => (
                        <tr key={r.row}>
                          <td>{r.row}</td>
                          <td>{r.account_code ?? r.account_name}</td>
                          <td>{[r.branch, r.project].filter(Boolean).join(' / ')}</td>
                          <td>{r.months}</td>
                          <td>
                            {r.status === 'ok' ? (
                              <Tag intent={Intent.SUCCESS} minimal>OK</Tag>
                            ) : (
                              r.errors.map((e, i) => (
                                <div key={i} style={{ color: '#c23030' }}>
                                  {e.column ? <b>{e.column}: </b> : null}
                                  {e.message}
                                </div>
                              ))
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </HTMLTable>
                </div>
              </>
            )}
          </div>
        )}
      </div>
      <div className={Classes.DIALOG_FOOTER}>
        <div className={Classes.DIALOG_FOOTER_ACTIONS}>
          <Button onClick={onClose}>Cancel</Button>
          <Button disabled={!file} loading={busy && !report} onClick={check}>
            Check file
          </Button>
          <Button intent={Intent.PRIMARY} disabled={blocked || isDirty} loading={busy && !!report} onClick={commit}>
            Import {s?.valid ? `${s.valid} rows` : ''}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
