// @ts-nocheck
import { useEffect, useMemo, useState } from 'react';
import { useHistory, useParams } from 'react-router-dom';
import {
  Alert,
  Button,
  ButtonGroup,
  Callout,
  Classes,
  HTMLSelect,
  InputGroup,
  Intent,
  Menu,
  MenuItem,
  NavbarDivider,
  NavbarGroup,
  Popover,
  Position,
  Spinner,
  Tag,
} from '@blueprintjs/core';
import { AppToaster, DashboardActionsBar, DashboardPageContent, EmptyStatus, Icon } from '@/components';
import { useAbilityContext } from '@/hooks/utils';
import { AbilitySubject, BudgetAction } from '@/constants/abilityOption';
import { useBranches } from '@/hooks/query';
import { useProjects } from '@/hooks/query/projects';
import { useAllocateBudget, useBudget, useBudgetVersion, useDeleteBudget, useSaveBudgetLines } from '@/hooks/query/budgets';
import { useProjectsEnabled } from '@/ditech/projects/hooks';
import { BudgetGrid, GridView } from './BudgetGrid';
import { AddLinesDialog, AllocateDialog, BUDGET_TYPE_LABEL, ImportDialog, LineNoteDialog, PL_TYPES, PrefillDialog, rootTypeOf } from './BudgetDialogs';
import { currencyDecimals, toMilli } from './money';
import { lineKey, useBudgetGrid } from './gridState';
import { STATUS_INTENT, statusLabel } from './BudgetsPage';
import { useBudgetFiles } from './files';
import { useBudgetingEnabled } from './hooks';
import { VersionWorkflowBar } from './BudgetWorkflow';

const EDITABLE = ['draft', 'rejected'];
const errorOf = (e) => e?.data?.errors?.[0] ?? null;

/**
 * 103 DiTech: budget editor. Spreadsheet-style grid of lines × months with
 * quarters and year views, paste from Excel, allocation, prefill, import and
 * export. Edits stay in the browser until Save, which sends only the changed
 * months with the version's lock_version.
 */
export function BudgetEditorPage() {
  const { id } = useParams<{ id: string }>();
  const budgetId = Number(id);
  const history = useHistory();
  const ability = useAbilityContext();
  const enabled = useBudgetingEnabled();
  const projectsEnabled = useProjectsEnabled();
  const { data: budget, isLoading: budgetLoading, error: budgetError } = useBudget(budgetId, { enabled });
  const [versionNo, setVersionNo] = useState<number | null>(null);
  useEffect(() => {
    if (budget && versionNo === null) setVersionNo(budget.versions[budget.versions.length - 1]?.versionNo ?? 1);
  }, [budget, versionNo]);
  const { data: detail, isLoading: versionLoading, refetch } = useBudgetVersion(budgetId, versionNo, { enabled: enabled && !!versionNo });

  const grid = useBudgetGrid(budgetId, versionNo ?? 0, detail);
  const { mutateAsync: saveLines, isPending: saving } = useSaveBudgetLines();
  const { mutateAsync: allocateOne } = useAllocateBudget();
  const { mutateAsync: deleteBudget } = useDeleteBudget();
  const { download } = useBudgetFiles();
  const { data: branches = [] } = useBranches(undefined, { enabled });
  const { data: projects = [] } = useProjects({ status: 'all' }, { enabled: enabled && projectsEnabled });

  const [view, setView] = useState<GridView>('months');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<null | 'add' | 'allocate' | 'prefill' | 'import' | 'delete'>(null);
  const [noteLine, setNoteLine] = useState(null);
  const [conflict, setConflict] = useState(false);
  const [saveErrors, setSaveErrors] = useState<string | null>(null);

  const decimals = currencyDecimals(budget?.currencyCode ?? 'USD');
  const canEdit = ability.can(BudgetAction.EditDraft, AbilitySubject.Budget);
  const canImportExport = ability.can(BudgetAction.ImportExport, AbilitySubject.Budget);
  const editable = !!detail && EDITABLE.includes(detail.version.status) && canEdit;
  const months = detail?.months ?? [];

  const names = useMemo(
    () => ({
      branch: new Map(branches.map((b) => [b.id, b.name])),
      project: new Map(projects.map((p) => [p.id, p.name])),
    }),
    [branches, projects],
  );
  const dimensionLabel = (l) => [l.branchId && names.branch.get(l.branchId), l.projectId && names.project.get(l.projectId)].filter(Boolean).join(' · ');

  const visibleLines = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? grid.lines.filter((l) => `${l.account.code ?? ''} ${l.account.name} ${dimensionLabel(l)}`.toLowerCase().includes(q)) : grid.lines;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid.lines, search, names]);
  const selectedLines = grid.lines.filter((l) => selected.has(l.key));

  // Warn before leaving with unsaved edits (the browser copy keeps them anyway).
  useEffect(() => {
    const handler = (e) => {
      if (!grid.isDirty) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [grid.isDirty]);

  const save = async () => {
    if (grid.invalidCount > 0) return AppToaster.show({ message: `Fix the ${grid.invalidCount} cells marked in red first.`, intent: Intent.WARNING });
    setSaveErrors(null);
    try {
      await saveLines([budgetId, versionNo, grid.buildSave(detail.version.lockVersion)]);
      grid.clearDraft();
      AppToaster.show({ message: 'Budget saved.', intent: Intent.SUCCESS });
    } catch (e) {
      const err = errorOf(e);
      if (e?.status === 409 || err?.type === 'BUDGET_VERSION_CHANGED') setConflict(true);
      else setSaveErrors(err?.message ?? 'The budget could not be saved. Your changes are kept in this browser.');
    }
  };

  const reloadAfterConflict = async () => {
    setConflict(false);
    await refetch();
    AppToaster.show({ message: 'Reloaded the latest version. Your unsaved changes are kept: use “Restore” to apply them again.', intent: Intent.PRIMARY });
  };

  const applyPrefill = (preview) => {
    const add = preview.lines
      .filter((l) => !grid.lines.some((g) => g.key === lineKey(l.accountId, l.branchId, l.projectId)))
      .map((l) => ({
        account: { id: l.account.id, code: l.account.code, name: l.account.name, accountType: l.account.accountType, rootType: rootTypeOf(l.account.accountType) },
        branchId: l.branchId,
        projectId: l.projectId,
        note: null,
        assumption: null,
      }));
    // Both are queued state updates and apply in order: the lines exist before their values are set.
    grid.addLines(add, months);
    grid.setMany(preview.lines.flatMap((l) => l.amounts.map((a) => ({ key: lineKey(l.accountId, l.branchId, l.projectId), month: a.month, value: toMilli(a.amount) }))));
    AppToaster.show({ message: `Filled ${preview.lines.length} lines. Review, then Save.`, intent: Intent.SUCCESS });
  };

  if (!enabled) return <DashboardPageContent><EmptyStatus title="Budgeting is not in your plan" description={<p>Available on the Business plan and above.</p>} /></DashboardPageContent>;
  if (budgetError) return <DashboardPageContent><EmptyStatus title="Budget not found" description={<p>It may have been deleted.</p>} action={<Button onClick={() => history.push('/budgets')}>Back to budgets</Button>} /></DashboardPageContent>;
  if (budgetLoading || versionLoading || !budget || !detail) return <DashboardPageContent><div style={{ padding: 40 }}><Spinner /></div></DashboardPageContent>;

  const showNetIncome = PL_TYPES.includes(budget.type);
  const closing = budget.type === 'balance_sheet';
  const status = detail.version.status;

  return (
    <>
      <DashboardActionsBar>
        <NavbarGroup>
          <Button className={Classes.MINIMAL} icon="arrow-left" onClick={() => history.push('/budgets')} aria-label="Back to budgets" />
          {editable && (
            <>
              <Button className={Classes.MINIMAL} icon={<Icon icon="plus" />} text="Add lines" onClick={() => setDialog('add')} data-testid="add-lines" />
              <Button className={Classes.MINIMAL} icon="history" text="Prefill" onClick={() => setDialog('prefill')} />
              <Button className={Classes.MINIMAL} icon="th-derived" text="Allocate" disabled={selectedLines.length === 0} onClick={() => setDialog('allocate')} />
              <Popover
                position={Position.BOTTOM_LEFT}
                minimal
                disabled={selectedLines.length === 0}
                content={
                  <Menu>
                    <MenuItem icon="eraser" text={`Clear months of ${selectedLines.length} lines`} onClick={() => grid.setMany(selectedLines.flatMap((l) => months.map((m) => ({ key: l.key, month: m, value: 0 }))))} />
                    <MenuItem icon="trash" intent={Intent.DANGER} text={`Remove ${selectedLines.length} lines`} onClick={() => { grid.removeLines(selectedLines.map((l) => l.key)); setSelected(new Set()); }} />
                  </Menu>
                }
              >
                <Button className={Classes.MINIMAL} rightIcon="caret-down" text={`Selected (${selectedLines.length})`} disabled={selectedLines.length === 0} />
              </Popover>
              <NavbarDivider />
            </>
          )}
          {canImportExport && (
            <>
              {editable && <Button className={Classes.MINIMAL} icon={<Icon icon="file-import-16" iconSize={16} />} text="Import" onClick={() => setDialog('import')} />}
              <Popover
                position={Position.BOTTOM_LEFT}
                minimal
                content={
                  <Menu>
                    <MenuItem text="Excel (.xlsx)" onClick={() => download(`/api/budgets/${budgetId}/versions/${versionNo}/export?format=xlsx`, `${budget.reference}.xlsx`)} />
                    <MenuItem text="CSV" onClick={() => download(`/api/budgets/${budgetId}/versions/${versionNo}/export?format=csv`, `${budget.reference}.csv`)} />
                  </Menu>
                }
              >
                <Button className={Classes.MINIMAL} icon={<Icon icon="file-export-16" iconSize={16} />} text="Export" />
              </Popover>
              <NavbarDivider />
            </>
          )}
          <Button className={Classes.MINIMAL} icon="comparison" text="Budget vs actual" onClick={() => history.push(`/budgets/${budgetId}/reports`)} data-testid="open-reports" />
          <NavbarDivider />
          <ButtonGroup minimal>
            {(['months', 'quarters', 'year'] as GridView[]).map((v) => (
              <Button key={v} active={view === v} text={v === 'months' ? 'Months' : v === 'quarters' ? 'Quarters' : 'Year'} onClick={() => setView(v)} />
            ))}
          </ButtonGroup>
          <InputGroup leftIcon="search" placeholder="Search lines" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 180, marginLeft: 8 }} />
        </NavbarGroup>
        <NavbarGroup align="right">
          {editable && (
            <>
              {grid.isDirty && (
                <span className={Classes.TEXT_MUTED} style={{ marginRight: 8 }} data-testid="unsaved-count">
                  {grid.changedCells} changed cell{grid.changedCells === 1 ? '' : 's'}
                  {grid.removedCount ? `, ${grid.removedCount} removed` : ''}
                </span>
              )}
              <Button className={Classes.MINIMAL} text="Discard" disabled={!grid.isDirty || saving} onClick={grid.discard} />
              <Button intent={Intent.PRIMARY} icon="floppy-disk" text="Save" loading={saving} disabled={!grid.isDirty} onClick={save} data-testid="save-budget" />
            </>
          )}
          {ability.can(BudgetAction.Delete, AbilitySubject.Budget) && budget.versions.every((v) => ['draft', 'rejected', 'cancelled'].includes(v.status)) && (
            <Button className={Classes.MINIMAL} icon="trash" intent={Intent.DANGER} onClick={() => setDialog('delete')} aria-label="Delete budget" />
          )}
        </NavbarGroup>
      </DashboardActionsBar>

      <DashboardPageContent>
        <div style={{ padding: '12px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
            <h2 style={{ margin: 0 }}>{budget.name}</h2>
            <Tag minimal>{budget.reference}</Tag>
            <Tag minimal>{BUDGET_TYPE_LABEL[budget.type]}</Tag>
            <span className={Classes.TEXT_MUTED}>
              {budget.startDate} – {budget.endDate} · {budget.currencyCode}
              {budget.branchId ? ` · ${names.branch.get(budget.branchId) ?? ''}` : ''}
              {budget.projectId ? ` · ${names.project.get(budget.projectId) ?? ''}` : ''}
            </span>
            <HTMLSelect
              value={versionNo}
              onChange={(e) => {
                // Unsaved edits of this version stay in the browser and are offered again when you come back.
                setVersionNo(Number(e.target.value));
                setSelected(new Set());
              }}
              options={budget.versions.map((v) => ({ value: v.versionNo, label: `v${v.versionNo} ${v.label ?? v.kind} — ${statusLabel(v.status)}` }))}
            />
            <Tag intent={STATUS_INTENT[status]}>{statusLabel(status)}</Tag>
          </div>

          <VersionWorkflowBar
            budget={budget}
            detail={detail}
            isDirty={grid.isDirty}
            onVersionCreated={(n) => {
              setVersionNo(n);
              setSelected(new Set());
            }}
          />

          {!editable && (
            <Callout intent={Intent.PRIMARY} icon="lock" style={{ marginBottom: 10 }}>
              {!canEdit
                ? 'You can view this budget but not change it.'
                : ['submitted', 'under_review'].includes(status)
                  ? 'This version is in review and cannot be changed. Withdraw it to edit it again.'
                  : `This version is ${statusLabel(status).toLowerCase()} and cannot be changed. Create a revision to change it.`}
            </Callout>
          )}
          {grid.draft && editable && (
            <Callout intent={Intent.WARNING} icon="history" style={{ marginBottom: 10 }} title="Unsaved changes from earlier">
              {grid.draft.lines.length} lines were edited on {new Date(grid.draft.savedAt).toLocaleString()} but not saved.
              {grid.draft.lockVersion !== detail.version.lockVersion && ' The budget was saved by someone since; check the amounts before saving.'}{' '}
              <Button small intent={Intent.WARNING} text="Restore" onClick={grid.restoreDraft} /> <Button small minimal text="Throw away" onClick={grid.clearDraft} />
            </Callout>
          )}
          {saveErrors && (
            <Callout intent={Intent.DANGER} style={{ marginBottom: 10 }} onClick={() => setSaveErrors(null)}>
              {saveErrors}
            </Callout>
          )}
          {grid.invalidCount > 0 && (
            <Callout intent={Intent.DANGER} icon="error" style={{ marginBottom: 10 }}>
              {grid.invalidCount} cell{grid.invalidCount === 1 ? ' is' : 's are'} not a valid amount (marked in red). Use numbers with at most {decimals} decimals.
            </Callout>
          )}

          {grid.lines.length === 0 ? (
            <EmptyStatus
              title="No lines yet"
              description={<p>Add accounts, prefill from last year's actuals, or import an Excel file. You can also paste a block of cells from Excel into the grid.</p>}
              action={editable ? <Button intent={Intent.PRIMARY} onClick={() => setDialog('add')}>Add lines</Button> : undefined}
            />
          ) : (
            <BudgetGrid
              months={months}
              quarters={detail.quarters}
              view={view}
              lines={visibleLines}
              decimals={decimals}
              readOnly={!editable}
              showNetIncome={showNetIncome}
              closing={closing}
              selected={selected}
              onToggleSelect={(key) => setSelected((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; })}
              onToggleSelectAll={(keys, on) => setSelected(on ? new Set(keys) : new Set())}
              onCell={(key, month, r) => grid.setCell(key, month, r.value ?? null, r.invalidText)}
              onPasteBlock={(updates) => {
                grid.setMany(updates);
                const bad = updates.filter((u) => u.invalidText !== undefined).length;
                AppToaster.show({ message: `Pasted ${updates.length} cells${bad ? `, ${bad} not valid (marked in red)` : ''}.`, intent: bad ? Intent.WARNING : Intent.SUCCESS });
              }}
              onSpreadTotal={async (key, amount) => {
                try {
                  const result = await allocateOne([budgetId, { method: 'equal', amount: amount / 1000 }]);
                  grid.setMany(months.map((m) => ({ key, month: m, value: toMilli(result.amounts[m] ?? 0) })));
                } catch (e) {
                  AppToaster.show({ message: errorOf(e)?.message ?? 'Could not spread the amount.', intent: Intent.DANGER });
                }
              }}
              onEditMeta={setNoteLine}
              dimensionLabel={dimensionLabel}
            />
          )}
          {grid.lines.length > 0 && (
            <p className={Classes.TEXT_MUTED} style={{ marginTop: 8 }}>
              Tip: copy a block of cells in Excel and paste it on the first month cell. Arrow keys and Enter move between cells. In the Year view, type a yearly
              amount to spread it equally over the months.
            </p>
          )}
        </div>
      </DashboardPageContent>

      <AddLinesDialog isOpen={dialog === 'add'} onClose={() => setDialog(null)} budgetType={budget.type} existingKeys={new Set(grid.lines.map((l) => l.key))} onAdd={(lines) => grid.addLines(lines, months)} />
      <AllocateDialog
        isOpen={dialog === 'allocate'}
        onClose={() => setDialog(null)}
        months={months}
        decimals={decimals}
        lines={selectedLines}
        allocate={(body) => allocateOne([budgetId, body])}
        onApply={(updates) => grid.setMany(updates)}
      />
      <PrefillDialog isOpen={dialog === 'prefill'} onClose={() => setDialog(null)} budget={budget} decimals={decimals} onApply={applyPrefill} />
      <ImportDialog
        isOpen={dialog === 'import'}
        onClose={() => setDialog(null)}
        budget={budget}
        versionNo={versionNo}
        lockVersion={detail.version.lockVersion}
        isDirty={grid.isDirty}
        onImported={() => refetch()}
      />
      <LineNoteDialog line={noteLine} readOnly={!editable} onClose={() => setNoteLine(null)} onSave={(meta) => { grid.setMeta(noteLine.key, meta); setNoteLine(null); }} />
      <Alert
        isOpen={conflict}
        intent={Intent.WARNING}
        icon="warning-sign"
        confirmButtonText="Reload"
        onConfirm={reloadAfterConflict}
        cancelButtonText="Keep editing"
        onCancel={() => setConflict(false)}
      >
        <p>Someone else saved this budget since you opened it, so your changes were not saved. Reload to see their version; your changes stay in this browser and can be restored.</p>
      </Alert>
      <Alert
        isOpen={dialog === 'delete'}
        intent={Intent.DANGER}
        icon="trash"
        confirmButtonText="Delete budget"
        cancelButtonText="Cancel"
        onCancel={() => setDialog(null)}
        onConfirm={() =>
          deleteBudget(budgetId)
            .then(() => {
              AppToaster.show({ message: `Budget ${budget.reference} deleted.`, intent: Intent.SUCCESS });
              history.push('/budgets');
            })
            .catch((e) => AppToaster.show({ message: errorOf(e)?.message ?? 'Could not delete the budget.', intent: Intent.DANGER }))
        }
      >
        <p>Delete {budget.reference} {budget.name}? Only budgets without submitted or approved versions can be deleted.</p>
      </Alert>
    </>
  );
}

export default BudgetEditorPage;
