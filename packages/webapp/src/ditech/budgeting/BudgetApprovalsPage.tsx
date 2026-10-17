// @ts-nocheck
// 103 DiTech: approval status report, budget override requests and budget alerts (Phase 5).
import { useState } from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import { Button, Callout, Classes, Dialog, FormGroup, HTMLSelect, HTMLTable, Intent, NavbarGroup, Spinner, Tab, Tabs, Tag, TextArea } from '@blueprintjs/core';
import { AppToaster, DashboardActionsBar, DashboardPageContent, EmptyStatus } from '@/components';
import { useAbilityContext } from '@/hooks/utils';
import { AbilitySubject, BudgetAction } from '@/constants/abilityOption';
import {
  useBudgetAlerts,
  useBudgetApprovals,
  useBudgetOverrideDrafts,
  useBudgetOverrides,
  useDecideBudgetOverride,
  useRequestBudgetOverride,
} from '@/hooks/query/budgets';
import { STATUS_INTENT, statusLabel } from './BudgetsPage';
import { errorMessage, fmt, MODE_LABEL, TYPE_LABEL } from './BudgetWorkflow';
import { useBudgetingEnabled } from './hooks';

const TABS = ['mine', 'review', 'overrides', 'alerts'] as const;
const OVERRIDE_INTENT = { pending: Intent.PRIMARY, approved: Intent.SUCCESS, rejected: Intent.DANGER, cancelled: Intent.NONE };
const LEVEL_INTENT = { info: Intent.PRIMARY, warning: Intent.WARNING, exceeded: Intent.DANGER };
const docLabel = (type, id) => `${TYPE_LABEL[type]?.replace(/s$/, '') ?? type} #${id}`;

/** 103 DiTech: Financial > Budgets > Approvals. */
export function BudgetApprovalsPage() {
  const history = useHistory();
  const location = useLocation();
  const enabled = useBudgetingEnabled();
  const initial = new URLSearchParams(location.search).get('tab');
  const [tab, setTab] = useState(TABS.includes(initial) ? initial : 'mine');

  if (!enabled) return <DashboardPageContent><EmptyStatus title="Budgeting is not in your plan" description={<p>Available on the Business plan and above.</p>} /></DashboardPageContent>;

  return (
    <>
      <DashboardActionsBar>
        <NavbarGroup>
          <Button className={Classes.MINIMAL} icon="arrow-left" onClick={() => history.push('/budgets')} aria-label="Back to budgets" />
          <Button className={Classes.MINIMAL} icon="cog" text="Approval and control settings" onClick={() => history.push('/budgets/settings')} />
        </NavbarGroup>
      </DashboardActionsBar>
      <DashboardPageContent>
        <div style={{ padding: '12px 16px' }}>
          <Tabs id="budget-approvals" selectedTabId={tab} onChange={(t) => setTab(t)} renderActiveTabPanelOnly large>
            <Tab id="mine" title="Waiting for me" panel={<ApprovalsTable mine />} />
            <Tab id="review" title="Approval status" panel={<ApprovalsTable />} />
            <Tab id="overrides" title="Override requests" panel={<OverridesPanel />} />
            <Tab id="alerts" title="Alerts" panel={<AlertsPanel />} />
          </Tabs>
        </div>
      </DashboardPageContent>
    </>
  );
}

function ApprovalsTable({ mine = false }) {
  const history = useHistory();
  const [status, setStatus] = useState('in_review');
  const { data, isLoading } = useBudgetApprovals(mine ? { mine: true } : { status });
  const rows = data?.data ?? [];
  return (
    <div style={{ marginTop: 12 }}>
      {!mine && (
        <HTMLSelect
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          options={[{ value: 'in_review', label: 'In review' }, { value: 'all', label: 'Every submitted version' }]}
          style={{ marginBottom: 10 }}
        />
      )}
      {isLoading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <p className={Classes.TEXT_MUTED}>{mine ? 'Nothing is waiting for your approval.' : 'No budget versions to show.'}</p>
      ) : (
        <HTMLTable interactive striped style={{ width: '100%' }} data-testid="approvals-table">
          <thead>
            <tr>
              <th>Budget</th>
              <th>Version</th>
              <th>Status</th>
              <th style={{ textAlign: 'right' }}>Amount</th>
              <th>Submitted by</th>
              <th>Waiting for</th>
              <th style={{ textAlign: 'right' }}>Days</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.version.id} onClick={() => history.push(`/budgets/${r.budget.id}`)} style={{ cursor: 'pointer' }}>
                <td>
                  {r.budget.reference} {r.budget.name}
                </td>
                <td>
                  v{r.version.versionNo} {r.version.label ?? r.version.kind}
                </td>
                <td>
                  <Tag minimal intent={STATUS_INTENT[r.version.status]}>{statusLabel(r.version.status)}</Tag>{' '}
                  {r.stepsTotal > 0 && (
                    <span className={Classes.TEXT_MUTED}>
                      {r.stepsApproved}/{r.stepsTotal}
                    </span>
                  )}
                </td>
                <td style={{ textAlign: 'right' }}>{fmt(r.grossAmount)}</td>
                <td>{r.submittedByName ?? ''}</td>
                <td>
                  {r.waitingStep ? `${r.waitingStep.label}${r.waitingStep.assignedUserName ? ` (${r.waitingStep.assignedUserName})` : ''}` : ''}
                  {r.canDecide && (
                    <Tag minimal intent={Intent.SUCCESS} style={{ marginLeft: 6 }}>
                      you
                    </Tag>
                  )}
                </td>
                <td style={{ textAlign: 'right' }}>{r.waitingDays ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </HTMLTable>
      )}
    </div>
  );
}

function OverridesPanel() {
  const ability = useAbilityContext();
  const canApprove = ability.can(BudgetAction.Approve, AbilitySubject.Budget);
  const [status, setStatus] = useState('pending');
  const [requesting, setRequesting] = useState(false);
  const [deciding, setDeciding] = useState(null);
  const { data, isLoading } = useBudgetOverrides(status ? { status } : {});
  const rows = data?.data ?? [];
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <HTMLSelect
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          options={[{ value: 'pending', label: 'Pending' }, { value: 'approved', label: 'Approved' }, { value: 'rejected', label: 'Rejected' }, { value: '', label: 'All' }]}
        />
        <Button intent={Intent.PRIMARY} icon="add" text="Request override" onClick={() => setRequesting(true)} data-testid="request-override" />
      </div>
      <Callout style={{ marginBottom: 10 }}>
        When a budget is set to “warn and require approval”, a bill, expense or journal that goes over it cannot be posted. Save it as a draft, request an override here,
        and post it once the override is approved.
      </Callout>
      {isLoading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <p className={Classes.TEXT_MUTED}>No override requests.</p>
      ) : (
        <HTMLTable striped style={{ width: '100%' }} data-testid="overrides-table">
          <thead>
            <tr>
              <th>Document</th>
              <th>Budget</th>
              <th>Period</th>
              <th style={{ textAlign: 'right' }}>Over by</th>
              <th>Reason</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.id}>
                <td>{docLabel(o.referenceType, o.referenceId)}</td>
                <td>
                  {o.budgetReference} {o.budgetName}
                </td>
                <td>
                  {o.periodFrom} – {o.periodTo}
                </td>
                <td style={{ textAlign: 'right' }}>{fmt(o.amount)}</td>
                <td>{o.reason}</td>
                <td>
                  <Tag minimal intent={OVERRIDE_INTENT[o.status]}>{o.status}</Tag>
                  {o.comment ? <span className={Classes.TEXT_MUTED}> {o.comment}</span> : null}
                </td>
                <td>
                  {o.status === 'pending' && canApprove && (
                    <>
                      <Button small intent={Intent.SUCCESS} text="Approve" onClick={() => setDeciding({ override: o, decision: 'approve' })} />{' '}
                      <Button small intent={Intent.DANGER} minimal text="Reject" onClick={() => setDeciding({ override: o, decision: 'reject' })} />
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </HTMLTable>
      )}
      <RequestOverrideDialog isOpen={requesting} onClose={() => setRequesting(false)} />
      <DecideOverrideDialog value={deciding} onClose={() => setDeciding(null)} />
    </div>
  );
}

function RequestOverrideDialog({ isOpen, onClose }) {
  const { data, isLoading } = useBudgetOverrideDrafts({ enabled: isOpen });
  const { mutateAsync: request, isPending } = useRequestBudgetOverride();
  const [doc, setDoc] = useState('');
  const [reason, setReason] = useState('');
  const drafts = data?.data ?? [];
  const submit = async () => {
    const [referenceType, referenceId] = doc.split(':');
    try {
      const res = await request({ referenceType, referenceId: Number(referenceId), reason: reason.trim() });
      AppToaster.show({ message: `Requested ${res.overrides.length} override${res.overrides.length === 1 ? '' : 's'}.`, intent: Intent.SUCCESS });
      onClose();
    } catch (e) {
      AppToaster.show({ message: errorMessage(e, 'Could not request the override.'), intent: Intent.DANGER });
    }
  };
  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      onClosed={() => {
        setDoc('');
        setReason('');
      }}
      title="Request a budget override"
    >
      <div className={Classes.DIALOG_BODY}>
        {isLoading ? (
          <Spinner />
        ) : drafts.length === 0 ? (
          <Callout intent={Intent.WARNING}>There are no draft bills, expenses or journals. Save the document as a draft first.</Callout>
        ) : (
          <>
            <FormGroup label="Draft document">
              <HTMLSelect
                fill
                value={doc}
                onChange={(e) => setDoc(e.target.value)}
                options={[
                  { value: '', label: 'Choose a draft' },
                  ...drafts.map((d) => ({
                    value: `${d.type}:${d.id}`,
                    label: `${docLabel(d.type, d.id)} · ${d.number ?? ''} · ${d.date} · ${fmt(d.amount)}${d.contact ? ` · ${d.contact}` : ''}`,
                  })),
                ]}
              />
            </FormGroup>
            <FormGroup label="Why it has to go over budget">
              <TextArea fill value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
            </FormGroup>
          </>
        )}
      </div>
      <div className={Classes.DIALOG_FOOTER}>
        <div className={Classes.DIALOG_FOOTER_ACTIONS}>
          <Button onClick={onClose}>Close</Button>
          <Button intent={Intent.PRIMARY} disabled={!doc || !reason.trim()} loading={isPending} onClick={submit}>
            Request
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function DecideOverrideDialog({ value, onClose }) {
  const { mutateAsync: decide, isPending } = useDecideBudgetOverride();
  const [comment, setComment] = useState('');
  const approve = value?.decision === 'approve';
  return (
    <Dialog isOpen={!!value} onClose={onClose} onClosed={() => setComment('')} title={approve ? 'Approve override' : 'Reject override'}>
      <div className={Classes.DIALOG_BODY}>
        {value && (
          <p>
            {docLabel(value.override.referenceType, value.override.referenceId)} goes over {value.override.budgetReference} by {fmt(value.override.amount)}.{' '}
            {approve ? 'Once approved, it can be posted up to that amount over.' : ''}
          </p>
        )}
        <FormGroup label="Comment (optional)">
          <TextArea fill value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} />
        </FormGroup>
      </div>
      <div className={Classes.DIALOG_FOOTER}>
        <div className={Classes.DIALOG_FOOTER_ACTIONS}>
          <Button onClick={onClose}>Close</Button>
          <Button
            intent={approve ? Intent.SUCCESS : Intent.DANGER}
            loading={isPending}
            onClick={() =>
              decide({ id: value.override.id, decision: value.decision, comment: comment.trim() || undefined })
                .then(() => {
                  AppToaster.show({ message: approve ? 'Override approved.' : 'Override rejected.', intent: Intent.SUCCESS });
                  onClose();
                })
                .catch((e) => AppToaster.show({ message: errorMessage(e, 'That did not work.'), intent: Intent.DANGER }))
            }
          >
            {approve ? 'Approve' : 'Reject'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function AlertsPanel() {
  const history = useHistory();
  const [level, setLevel] = useState('');
  const [page, setPage] = useState(1);
  const { data, isLoading } = useBudgetAlerts({ ...(level ? { level } : {}), page, pageSize: 50 });
  const rows = data?.data ?? [];
  const pages = data ? Math.max(1, Math.ceil(data.pagination.total / data.pagination.pageSize)) : 1;
  return (
    <div style={{ marginTop: 12 }}>
      <HTMLSelect
        value={level}
        onChange={(e) => {
          setLevel(e.target.value);
          setPage(1);
        }}
        options={[{ value: '', label: 'All levels' }, { value: 'exceeded', label: 'Over budget' }, { value: 'warning', label: 'Warning' }, { value: 'info', label: 'Info' }]}
        style={{ marginBottom: 10 }}
      />
      {isLoading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <p className={Classes.TEXT_MUTED}>No alerts. Alerts appear when a posted document reaches a threshold of a controlled budget.</p>
      ) : (
        <>
          <HTMLTable interactive striped style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>When</th>
                <th>Document</th>
                <th>Period</th>
                <th>Level</th>
                <th style={{ textAlign: 'right' }}>Budget</th>
                <th style={{ textAlign: 'right' }}>Used before</th>
                <th style={{ textAlign: 'right' }}>Document</th>
                <th style={{ textAlign: 'right' }}>Used after</th>
                <th>Mode</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} onClick={() => history.push(`/budgets/${a.budgetId}/reports`)} style={{ cursor: 'pointer' }}>
                  <td>{new Date(a.createdAt).toLocaleString()}</td>
                  <td>{docLabel(a.referenceType, a.referenceId)}</td>
                  <td>
                    {a.periodFrom} – {a.periodTo}
                  </td>
                  <td>
                    <Tag minimal intent={LEVEL_INTENT[a.level]}>{a.level === 'exceeded' ? 'over budget' : a.level}</Tag>
                    {a.outcome === 'override' && <span className={Classes.TEXT_MUTED}> (override)</span>}
                  </td>
                  <td style={{ textAlign: 'right' }}>{fmt(a.budget)}</td>
                  <td style={{ textAlign: 'right' }}>{fmt(a.usedBefore)}</td>
                  <td style={{ textAlign: 'right' }}>{fmt(a.document)}</td>
                  <td style={{ textAlign: 'right' }}>{a.percentAfter === null ? 'n/a' : `${fmt(a.percentAfter)}%`}</td>
                  <td>{MODE_LABEL[a.mode]}</td>
                </tr>
              ))}
            </tbody>
          </HTMLTable>
          {pages > 1 && (
            <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
              <Button small disabled={page <= 1} onClick={() => setPage(page - 1)} text="Newer" />
              <span>
                {page} / {pages}
              </span>
              <Button small disabled={page >= pages} onClick={() => setPage(page + 1)} text="Older" />
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default BudgetApprovalsPage;
