// @ts-nocheck
// 103 DiTech: budget approval workflow, revisions, scenarios, comparison,
// history, spending policy and availability (Phase 5, design §12–13).
import { useState } from 'react';
import {
  Button,
  Callout,
  Classes,
  Dialog,
  Drawer,
  FormGroup,
  HTMLSelect,
  HTMLTable,
  InputGroup,
  Intent,
  Menu,
  MenuItem,
  Popover,
  Position,
  Spinner,
  Switch,
  Tag,
  TextArea,
} from '@blueprintjs/core';
import { AppToaster } from '@/components';
import { useAbilityContext } from '@/hooks/utils';
import { AbilitySubject, BudgetAction } from '@/constants/abilityOption';
import { useUsers } from '@/hooks/query/users/queries';
import {
  useBudgetAudit,
  useBudgetAvailability,
  useBudgetComparison,
  useBudgetPolicies,
  useBudgetVersionApprovals,
  useBudgetVersionAction,
  useCreateBudgetRevision,
  useCreateBudgetScenario,
  useDeleteBudgetPolicy,
  useSaveBudgetPolicy,
} from '@/hooks/query/budgets';

import { ForecastDialog, ForecastVsBudgetDrawer, RollingForecastDrawer, forecastSummary } from './BudgetForecast';
import { CONTROLLABLE_TYPES, FORECASTABLE_TYPES } from './BudgetDialogs';

export const errorMessage = (e, fallback) => e?.data?.errors?.[0]?.message ?? fallback;
export const fmt = (n: number | null | undefined, decimals = 2) =>
  n === null || n === undefined ? '' : Number(n).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
const day = (d) => (d ? new Date(d).toLocaleDateString() : '');
const when = (d) => (d ? new Date(d).toLocaleString() : '');

const DECISION_INTENT = { pending: Intent.PRIMARY, approved: Intent.SUCCESS, rejected: Intent.DANGER, cancelled: Intent.NONE };
const REASON_TEXT = {
  BUDGET_SELF_APPROVAL: 'You submitted this version, so someone else approves it.',
  BUDGET_SAME_APPROVER: 'You approved an earlier step; another approver decides this one.',
  BUDGET_NOT_YOUR_STEP: 'This step is for another role or person.',
};
export const MODE_LABEL = { off: 'Off', inform: 'Warn only', warn_approve: 'Warn and require approval', block: 'Block' };
export const BASIS_LABEL = { month: 'Each month', ytd: 'Year to date', year: 'Whole budget' };
export const TYPE_LABEL = { bill: 'Bills', expense: 'Expenses', manual_journal: 'Manual journals' };

/** Actions on the selected version and a short approval status line, under the editor header. */
export function VersionWorkflowBar({ budget, detail, isDirty, onVersionCreated }) {
  const ability = useAbilityContext();
  const version = detail.version;
  const status = version.status;
  const { data: approvals } = useBudgetVersionApprovals(budget.id, version.versionNo);
  const { mutateAsync: run, isPending } = useBudgetVersionAction();
  const [dialog, setDialog] = useState(null);
  const can = (a) => ability.can(a, AbilitySubject.Budget);
  const inReview = ['submitted', 'under_review'].includes(status);
  const isScenario = version.kind === 'scenario';
  const isForecast = version.kind === 'forecast';
  const controllable = CONTROLLABLE_TYPES.includes(budget.type);
  const forecastable = FORECASTABLE_TYPES.includes(budget.type);
  const hasForecast = budget.versions.some((v) => v.kind === 'forecast' && v.status !== 'cancelled');
  const hasApproved = budget.versions.some((v) => ['approved', 'locked'].includes(v.status));

  const act = async (action, body = {}) => {
    try {
      await run({ action, id: budget.id, versionNo: version.versionNo, ...body });
      AppToaster.show({ message: ACTION_DONE[action], intent: Intent.SUCCESS });
      setDialog(null);
    } catch (e) {
      AppToaster.show({ message: errorMessage(e, 'That did not work.'), intent: Intent.DANGER });
    }
  };

  const current = approvals?.currentStep;
  const steps = approvals?.submissions?.[0]?.submissionNo === version.submissionNo ? approvals.submissions[0].steps : [];

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }} data-testid="workflow-bar">
      {inReview && steps.length > 0 && (
        <span>
          Approval:{' '}
          {steps.map((s) => (
            <Tag key={s.id} minimal intent={DECISION_INTENT[s.decision]} style={{ marginRight: 4 }}>
              {s.stepOrder}. {s.label}
              {s.assignedUserName ? ` → ${s.assignedUserName}` : ''}
            </Tag>
          ))}
          {current && !approvals.canDecide && approvals.cannotDecideReason && (
            <span className={Classes.TEXT_MUTED}> {REASON_TEXT[approvals.cannotDecideReason] ?? ''}</span>
          )}
        </span>
      )}
      {status === 'rejected' && approvals?.submissions?.[0] && (
        <Callout intent={Intent.DANGER} icon="cross" style={{ padding: '4px 10px', width: 'auto' }}>
          Rejected: {approvals.submissions[0].steps.find((s) => s.decision === 'rejected')?.comment ?? ''}
        </Callout>
      )}
      {['approved', 'locked'].includes(status) && (
        <span className={Classes.TEXT_MUTED}>
          Approved {day(version.approvedAt)}
          {approvals?.version?.approvedByName ? ` by ${approvals.version.approvedByName}` : ''}
          {budget.activeVersionId === version.id ? ' · active version' : ''}
        </span>
      )}

      {isForecast && (
        <span className={Classes.TEXT_MUTED} data-testid="forecast-summary">
          {forecastSummary(version)}
        </span>
      )}

      <span style={{ flex: 1 }} />

      {isForecast && (
        <Button icon="timeline-line-chart" text="Forecast vs budget" onClick={() => setDialog('forecast-vs-budget')} data-testid="open-forecast-vs-budget" />
      )}
      {['draft', 'rejected'].includes(status) && !isScenario && !isForecast && can(BudgetAction.Submit) && (
        <Button
          intent={Intent.PRIMARY}
          icon="send-message"
          text="Submit for approval"
          disabled={isDirty || detail.lines.length === 0}
          title={isDirty ? 'Save your changes first.' : detail.lines.length === 0 ? 'Add lines first.' : ''}
          onClick={() => setDialog('submit')}
          data-testid="submit-version"
        />
      )}
      {inReview && approvals?.canDecide && can(BudgetAction.Approve) && (
        <>
          <Button intent={Intent.SUCCESS} icon="tick" text={`Approve${current ? `: ${current.label}` : ''}`} onClick={() => setDialog('approve')} data-testid="approve-version" />
          <Button intent={Intent.DANGER} icon="cross" text="Reject" onClick={() => setDialog('reject')} />
        </>
      )}
      <Popover
        position={Position.BOTTOM_RIGHT}
        minimal
        content={
          <Menu>
            {inReview && can(BudgetAction.Approve) && approvals?.canDecide && <MenuItem icon="exchange" text="Delegate this step…" onClick={() => setDialog('delegate')} />}
            {inReview && can(BudgetAction.Submit) && <MenuItem icon="undo" text="Withdraw to draft" onClick={() => setDialog('withdraw')} />}
            {status === 'approved' && can(BudgetAction.Lock) && <MenuItem icon="lock" text="Lock version" onClick={() => setDialog('lock')} />}
            {status === 'locked' && can(BudgetAction.Lock) && <MenuItem icon="unlock" text="Unlock version" onClick={() => setDialog('unlock')} />}
            {can(BudgetAction.Revise) && (
              <>
                <MenuItem icon="git-branch" text="New revision…" disabled={!hasApproved} title={hasApproved ? '' : 'Get a version approved first.'} onClick={() => setDialog('revision')} />
                <MenuItem icon="git-new-branch" text="New scenario…" onClick={() => setDialog('scenario')} />
                {forecastable && <MenuItem icon="timeline-line-chart" text="New forecast…" onClick={() => setDialog('forecast')} data-testid="new-forecast" />}
                {version.kind !== 'original' && ['draft', 'rejected'].includes(status) && (
                  <MenuItem icon="disable" intent={Intent.DANGER} text="Cancel this version" onClick={() => setDialog('cancel')} />
                )}
              </>
            )}
            {isForecast && status === 'draft' && can(BudgetAction.EditDraft) && (
              <MenuItem icon="refresh" text="Refresh forecast…" onClick={() => setDialog('refresh-forecast')} />
            )}
            <MenuItem icon="comparison" text="Compare versions" disabled={budget.versions.length < 2} onClick={() => setDialog('compare')} />
            {forecastable && (
              <>
                <MenuItem icon="timeline-line-chart" text="Forecast vs budget" disabled={!hasForecast} onClick={() => setDialog('forecast-vs-budget')} />
                <MenuItem icon="timeline-events" text="Rolling 12-month forecast" onClick={() => setDialog('rolling')} />
              </>
            )}
            {controllable && <MenuItem icon="dashboard" text="Available to spend" disabled={!budget.activeVersionId} onClick={() => setDialog('availability')} />}
            {controllable && can(BudgetAction.ConfigurePolicy) && <MenuItem icon="shield" text="Spending control…" onClick={() => setDialog('policy')} />}
            <MenuItem icon="history" text="Approval history" onClick={() => setDialog('approvals')} />
            {can(BudgetAction.ViewAudit) && <MenuItem icon="list-detail-view" text="Audit history" onClick={() => setDialog('audit')} />}
          </Menu>
        }
      >
        <Button rightIcon="caret-down" text="Version" loading={isPending} data-testid="version-menu" />
      </Popover>

      <CommentDialog
        isOpen={['submit', 'approve', 'reject', 'withdraw', 'lock', 'unlock', 'cancel'].includes(dialog)}
        action={dialog}
        version={version}
        onClose={() => setDialog(null)}
        onConfirm={(comment) => act(dialog, { comment })}
        loading={isPending}
      />
      <DelegateDialog isOpen={dialog === 'delegate'} onClose={() => setDialog(null)} onConfirm={(userId, comment) => act('delegate', { userId, comment })} loading={isPending} />
      <NewVersionDialog kind={dialog === 'revision' || dialog === 'scenario' ? dialog : null} budget={budget} version={version} onClose={() => setDialog(null)} onCreated={onVersionCreated} />
      <CompareDrawer isOpen={dialog === 'compare'} budget={budget} versionNo={version.versionNo} onClose={() => setDialog(null)} />
      <AvailabilityDrawer isOpen={dialog === 'availability'} budget={budget} onClose={() => setDialog(null)} />
      <PolicyDialog isOpen={dialog === 'policy'} budget={budget} onClose={() => setDialog(null)} />
      <ApprovalsDrawer isOpen={dialog === 'approvals'} approvals={approvals} onClose={() => setDialog(null)} />
      <AuditDrawer isOpen={dialog === 'audit'} budget={budget} onClose={() => setDialog(null)} />
      {forecastable && (
        <>
          <ForecastDialog
            key={dialog === 'refresh-forecast' ? `refresh-${version.versionNo}-${version.lockVersion}` : 'new'}
            isOpen={dialog === 'forecast' || dialog === 'refresh-forecast'}
            budget={budget}
            months={detail.months}
            version={dialog === 'refresh-forecast' ? version : null}
            onClose={() => setDialog(null)}
            onDone={(no) => no !== version.versionNo && onVersionCreated?.(no)}
          />
          <ForecastVsBudgetDrawer isOpen={dialog === 'forecast-vs-budget'} budget={budget} forecastVersionNo={isForecast ? version.versionNo : null} onClose={() => setDialog(null)} />
          <RollingForecastDrawer isOpen={dialog === 'rolling'} budget={budget} onClose={() => setDialog(null)} />
        </>
      )}
    </div>
  );
}

const ACTION_DONE = {
  submit: 'Submitted for approval.',
  approve: 'Approved.',
  reject: 'Rejected.',
  delegate: 'Step delegated.',
  withdraw: 'Withdrawn to draft.',
  cancel: 'Version cancelled.',
  lock: 'Version locked.',
  unlock: 'Version unlocked.',
};

const ACTION_COPY = {
  submit: { title: 'Submit for approval', text: 'Approvers are chosen by the approval rules for this amount. The version cannot be changed while it is in review.', button: 'Submit', intent: Intent.PRIMARY },
  approve: { title: 'Approve', text: 'Approve this step. After the last step the version becomes the active budget.', button: 'Approve', intent: Intent.SUCCESS },
  reject: { title: 'Reject', text: 'Say what has to change. The version goes back to its author, who can edit and resubmit it.', button: 'Reject', intent: Intent.DANGER, required: true },
  withdraw: { title: 'Withdraw to draft', text: 'Take the version out of review so it can be edited again.', button: 'Withdraw', intent: Intent.WARNING },
  lock: { title: 'Lock version', text: 'Locking marks the approved budget as final.', button: 'Lock', intent: Intent.PRIMARY },
  unlock: { title: 'Unlock version', text: 'The version goes back to approved. It stays read-only: changes need a revision.', button: 'Unlock', intent: Intent.WARNING },
  cancel: { title: 'Cancel version', text: 'This revision or scenario will be kept for the record but can no longer be used.', button: 'Cancel version', intent: Intent.DANGER },
};

function CommentDialog({ isOpen, action, version, onClose, onConfirm, loading }) {
  const [comment, setComment] = useState('');
  const copy = ACTION_COPY[action] ?? ACTION_COPY.submit;
  const withComment = ['submit', 'approve', 'reject'].includes(action);
  return (
    <Dialog isOpen={isOpen} onClose={onClose} title={`${copy.title}: v${version.versionNo} ${version.label ?? ''}`} onClosed={() => setComment('')}>
      <div className={Classes.DIALOG_BODY}>
        <p>{copy.text}</p>
        {withComment && (
          <FormGroup label={copy.required ? 'Reason (required)' : 'Comment (optional)'}>
            <TextArea fill growVertically value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} data-testid="workflow-comment" />
          </FormGroup>
        )}
      </div>
      <div className={Classes.DIALOG_FOOTER}>
        <div className={Classes.DIALOG_FOOTER_ACTIONS}>
          <Button onClick={onClose}>Close</Button>
          <Button intent={copy.intent} loading={loading} disabled={copy.required && !comment.trim()} onClick={() => onConfirm(comment.trim() || undefined)} data-testid="workflow-confirm">
            {copy.button}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function DelegateDialog({ isOpen, onClose, onConfirm, loading }) {
  const { data } = useUsers({ enabled: isOpen });
  const users = (Array.isArray(data) ? data : data?.users ?? data?.data ?? []).filter((u) => u.active !== false && u.inviteAcceptedAt !== null);
  const [userId, setUserId] = useState('');
  const [comment, setComment] = useState('');
  return (
    <Dialog isOpen={isOpen} onClose={onClose} title="Delegate this step">
      <div className={Classes.DIALOG_BODY}>
        <p>Only the person you choose (or an administrator) will decide this step. They need permission to approve budgets.</p>
        <FormGroup label="Delegate to">
          <HTMLSelect fill value={userId} onChange={(e) => setUserId(e.target.value)} options={[{ value: '', label: 'Choose a user' }, ...users.map((u) => ({ value: u.id, label: u.fullName || `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email }))]} />
        </FormGroup>
        <FormGroup label="Comment (optional)">
          <TextArea fill value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} />
        </FormGroup>
      </div>
      <div className={Classes.DIALOG_FOOTER}>
        <div className={Classes.DIALOG_FOOTER_ACTIONS}>
          <Button onClick={onClose}>Close</Button>
          <Button intent={Intent.PRIMARY} disabled={!userId} loading={loading} onClick={() => onConfirm(Number(userId), comment.trim() || undefined)}>
            Delegate
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function NewVersionDialog({ kind, budget, version, onClose, onCreated }) {
  const { mutateAsync: revise, isPending: revising } = useCreateBudgetRevision();
  const { mutateAsync: scenario, isPending: scenarioing } = useCreateBudgetScenario();
  const sources = budget.versions.filter((v) =>
    kind === 'revision' ? ['approved', 'locked'].includes(v.status) || ((v.kind === 'scenario' || v.kind === 'forecast') && v.status !== 'cancelled') : v.status !== 'cancelled',
  );
  const defaultSource = budget.versions.find((v) => v.id === budget.activeVersionId)?.versionNo ?? version.versionNo;
  const [source, setSource] = useState('');
  const [reason, setReason] = useState('');
  const [label, setLabel] = useState('');
  const [which, setWhich] = useState('worst');
  const reset = () => {
    setSource('');
    setReason('');
    setLabel('');
    setWhich('worst');
  };
  const submit = async () => {
    const sourceVersionNo = Number(source || defaultSource);
    try {
      const created =
        kind === 'revision'
          ? await revise([budget.id, { reason: reason.trim(), sourceVersionNo, label: label.trim() || undefined }])
          : await scenario([budget.id, { scenario: which, label: label.trim(), sourceVersionNo }]);
      AppToaster.show({ message: `Created v${created.version.versionNo}.`, intent: Intent.SUCCESS });
      onClose();
      onCreated?.(created.version.versionNo);
    } catch (e) {
      AppToaster.show({ message: errorMessage(e, 'Could not create the version.'), intent: Intent.DANGER });
    }
  };
  return (
    <Dialog isOpen={!!kind} onClose={onClose} onClosed={reset} title={kind === 'revision' ? 'New revision' : 'New scenario'}>
      <div className={Classes.DIALOG_BODY}>
        <p>
          {kind === 'revision'
            ? 'A revision copies an approved version into a new draft. Once approved, it replaces the active budget; the original stays for comparison.'
            : 'A scenario is a what-if copy you can change freely. It is never submitted; to adopt it, create a revision from it.'}
        </p>
        <FormGroup label="Copy from">
          <HTMLSelect
            fill
            value={source || defaultSource}
            onChange={(e) => setSource(e.target.value)}
            options={sources.map((v) => ({ value: v.versionNo, label: `v${v.versionNo} ${v.label ?? v.kind} (${v.status})` }))}
          />
        </FormGroup>
        {kind === 'scenario' && (
          <FormGroup label="Scenario">
            <HTMLSelect value={which} onChange={(e) => setWhich(e.target.value)} options={[{ value: 'base', label: 'Base' }, { value: 'best', label: 'Best case' }, { value: 'worst', label: 'Worst case' }, { value: 'custom', label: 'Custom' }]} />
          </FormGroup>
        )}
        <FormGroup label={kind === 'scenario' ? 'Name' : 'Name (optional)'}>
          <InputGroup value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} placeholder={kind === 'scenario' ? 'Worst case: sales −15%' : 'Mid-year revision'} />
        </FormGroup>
        {kind === 'revision' && (
          <FormGroup label="Reason (required)">
            <TextArea fill value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
          </FormGroup>
        )}
      </div>
      <div className={Classes.DIALOG_FOOTER}>
        <div className={Classes.DIALOG_FOOTER_ACTIONS}>
          <Button onClick={onClose}>Close</Button>
          <Button
            intent={Intent.PRIMARY}
            loading={revising || scenarioing}
            disabled={sources.length === 0 || (kind === 'revision' ? !reason.trim() : !label.trim())}
            onClick={submit}
          >
            Create
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

const CHANGE_INTENT = { added: Intent.SUCCESS, removed: Intent.DANGER, changed: Intent.WARNING, unchanged: Intent.NONE };

function CompareDrawer({ isOpen, budget, versionNo, onClose }) {
  const active = budget.versions.find((v) => v.id === budget.activeVersionId)?.versionNo;
  const [base, setBase] = useState(1);
  const [compare, setCompare] = useState(null);
  const compareNo = compare ?? (versionNo !== 1 ? versionNo : active ?? budget.versions[budget.versions.length - 1].versionNo);
  const { data, isLoading, error } = useBudgetComparison(budget.id, { baseVersionNo: base, versionNo: compareNo }, { enabled: isOpen });
  const options = budget.versions.map((v) => ({ value: v.versionNo, label: `v${v.versionNo} ${v.label ?? v.kind}` }));
  return (
    <Drawer isOpen={isOpen} onClose={onClose} title="Compare versions" size="70%">
      <div className={Classes.DRAWER_BODY} style={{ padding: 16 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
          <HTMLSelect value={base} onChange={(e) => setBase(Number(e.target.value))} options={options} />
          <span>→</span>
          <HTMLSelect value={compareNo} onChange={(e) => setCompare(Number(e.target.value))} options={options} />
        </div>
        {isLoading && <Spinner />}
        {error && <Callout intent={Intent.DANGER}>{errorMessage(error, 'Could not compare.')}</Callout>}
        {data && (
          <HTMLTable compact striped style={{ width: '100%' }} data-testid="compare-table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Change</th>
                <th style={{ textAlign: 'right' }}>v{data.base.versionNo}</th>
                <th style={{ textAlign: 'right' }}>v{data.compare.versionNo}</th>
                <th style={{ textAlign: 'right' }}>Difference</th>
                <th style={{ textAlign: 'right' }}>%</th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map((l, i) => (
                <tr key={i}>
                  <td>
                    {l.account.code ? `${l.account.code} ` : ''}
                    {l.account.name}
                  </td>
                  <td>
                    <Tag minimal intent={CHANGE_INTENT[l.change]}>{l.change}</Tag>
                  </td>
                  <td style={{ textAlign: 'right' }}>{fmt(l.base.total)}</td>
                  <td style={{ textAlign: 'right' }}>{fmt(l.compare.total)}</td>
                  <td style={{ textAlign: 'right' }}>{fmt(l.difference)}</td>
                  <td style={{ textAlign: 'right' }}>{l.differencePercent === null ? 'n/a' : `${fmt(l.differencePercent)}%`}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 600 }}>
                <td colSpan={2}>Total</td>
                <td style={{ textAlign: 'right' }}>{fmt(data.totals.base)}</td>
                <td style={{ textAlign: 'right' }}>{fmt(data.totals.compare)}</td>
                <td style={{ textAlign: 'right' }}>{fmt(data.totals.difference)}</td>
                <td style={{ textAlign: 'right' }}>{data.totals.differencePercent === null ? 'n/a' : `${fmt(data.totals.differencePercent)}%`}</td>
              </tr>
            </tfoot>
          </HTMLTable>
        )}
      </div>
    </Drawer>
  );
}

export function AvailabilityDrawer({ isOpen, budget, onClose }) {
  const [month, setMonth] = useState('');
  const [basis, setBasis] = useState('');
  const query = { ...(month ? { month } : {}), ...(basis ? { basis } : {}) };
  const { data, isLoading, error } = useBudgetAvailability(budget.id, query, { enabled: isOpen });
  return (
    <Drawer isOpen={isOpen} onClose={onClose} title="Available to spend" size="60%">
      <div className={Classes.DRAWER_BODY} style={{ padding: 16 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
          <HTMLSelect value={month} onChange={(e) => setMonth(e.target.value)} options={[{ value: '', label: 'This month' }, ...(budget.months ?? []).map((m) => ({ value: m.slice(0, 7), label: m.slice(0, 7) }))]} />
          <HTMLSelect value={basis} onChange={(e) => setBasis(e.target.value)} options={[{ value: '', label: 'Policy period' }, ...Object.entries(BASIS_LABEL).map(([value, label]) => ({ value, label }))]} />
          {data && (
            <span className={Classes.TEXT_MUTED}>
              {data.periodFrom} – {data.periodTo} · control: {data.policy ? MODE_LABEL[data.policy.mode] : 'off'}
            </span>
          )}
        </div>
        <p className={Classes.TEXT_MUTED}>Available = budget − posted actual − open commitments (draft bills and draft expenses).</p>
        {isLoading && <Spinner />}
        {error && <Callout intent={Intent.WARNING}>{errorMessage(error, 'Not available.')}</Callout>}
        {data && (
          <HTMLTable compact striped style={{ width: '100%' }} data-testid="availability-table">
            <thead>
              <tr>
                <th>Account</th>
                <th style={{ textAlign: 'right' }}>Budget</th>
                <th style={{ textAlign: 'right' }}>Actual</th>
                <th style={{ textAlign: 'right' }}>Commitments</th>
                <th style={{ textAlign: 'right' }}>Available</th>
                <th style={{ textAlign: 'right' }}>Used</th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map((l) => (
                <tr key={l.lineId}>
                  <td>
                    {l.account.code ? `${l.account.code} ` : ''}
                    {l.account.name}
                  </td>
                  <td style={{ textAlign: 'right' }}>{fmt(l.budget)}</td>
                  <td style={{ textAlign: 'right' }}>{fmt(l.actual)}</td>
                  <td style={{ textAlign: 'right' }}>{fmt(l.commitments)}</td>
                  <td style={{ textAlign: 'right', color: l.available < 0 ? 'var(--bp4-intent-danger, #c23030)' : undefined }}>{fmt(l.available)}</td>
                  <td style={{ textAlign: 'right' }}>{l.usedPercent === null ? 'n/a' : `${fmt(l.usedPercent)}%`}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 600 }}>
                <td>Total</td>
                <td style={{ textAlign: 'right' }}>{fmt(data.totals.budget)}</td>
                <td style={{ textAlign: 'right' }}>{fmt(data.totals.actual)}</td>
                <td style={{ textAlign: 'right' }}>{fmt(data.totals.commitments)}</td>
                <td style={{ textAlign: 'right' }}>{fmt(data.totals.available)}</td>
                <td />
              </tr>
            </tfoot>
          </HTMLTable>
        )}
      </div>
    </Drawer>
  );
}

/** Spending policy form; `budget` null = the company default. */
export function PolicyForm({ policy, onSave, onRemove, saving, removeText }) {
  const [mode, setMode] = useState(policy?.mode ?? 'off');
  const [basis, setBasis] = useState(policy?.periodBasis ?? 'month');
  const [thresholds, setThresholds] = useState((policy?.thresholds ?? [75, 90]).join(', '));
  const [types, setTypes] = useState(policy?.transactionTypes ?? ['bill', 'expense', 'manual_journal']);
  const parsed = thresholds
    .split(',')
    .map((t) => Number(t.trim()))
    .filter((t) => t > 0);
  return (
    <div>
      <FormGroup label="When spending would go over the budget" helperText={MODE_HELP[mode]}>
        <HTMLSelect value={mode} onChange={(e) => setMode(e.target.value)} options={Object.entries(MODE_LABEL).map(([value, label]) => ({ value, label }))} data-testid="policy-mode" />
      </FormGroup>
      <FormGroup label="Compare against">
        <HTMLSelect value={basis} onChange={(e) => setBasis(e.target.value)} options={Object.entries(BASIS_LABEL).map(([value, label]) => ({ value, label }))} />
      </FormGroup>
      <FormGroup label="Alert at (% of budget used)" helperText="Up to 5 percentages, e.g. 75, 90.">
        <InputGroup value={thresholds} onChange={(e) => setThresholds(e.target.value)} />
      </FormGroup>
      <FormGroup label="Documents checked">
        {Object.entries(TYPE_LABEL).map(([value, label]) => (
          <Switch key={value} inline label={label} checked={types.includes(value)} onChange={(e) => setTypes(e.target.checked ? [...types, value] : types.filter((t) => t !== value))} />
        ))}
      </FormGroup>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button intent={Intent.PRIMARY} loading={saving} disabled={parsed.length === 0 || parsed.length > 5} onClick={() => onSave({ mode, periodBasis: basis, thresholds: parsed, transactionTypes: types })} data-testid="policy-save">
          Save
        </Button>
        {onRemove && <Button minimal intent={Intent.DANGER} text={removeText} onClick={onRemove} />}
      </div>
    </div>
  );
}

const MODE_HELP = {
  off: 'Nothing is checked.',
  inform: 'Documents are posted; going over is recorded in the budget alerts.',
  warn_approve: 'Going over needs an approved override: save the document as a draft and request one.',
  block: 'Documents that would go over the budget cannot be posted.',
};

function PolicyDialog({ isOpen, budget, onClose }) {
  const { data, isLoading } = useBudgetPolicies({ enabled: isOpen });
  const { mutateAsync: save, isPending } = useSaveBudgetPolicy();
  const { mutateAsync: remove } = useDeleteBudgetPolicy();
  const own = data?.budgets?.find((p) => p.budgetId === budget.id) ?? null;
  const done = (message) => {
    AppToaster.show({ message, intent: Intent.SUCCESS });
    onClose();
  };
  const fail = (e) => AppToaster.show({ message: errorMessage(e, 'Could not save the policy.'), intent: Intent.DANGER });
  return (
    <Dialog isOpen={isOpen} onClose={onClose} title={`Spending control: ${budget.reference}`}>
      <div className={Classes.DIALOG_BODY}>
        {isLoading || !data ? (
          <Spinner />
        ) : (
          <>
            <Callout style={{ marginBottom: 12 }}>
              {own
                ? 'This budget has its own policy.'
                : data.default
                  ? `This budget follows the company default: ${MODE_LABEL[data.default.mode]}, ${BASIS_LABEL[data.default.periodBasis].toLowerCase()}.`
                  : 'No company default is set, so this budget is not controlled.'}{' '}
              Only the approved active version controls spending.
            </Callout>
            <PolicyForm
              key={own ? 'own' : 'new'}
              policy={own ?? data.default}
              saving={isPending}
              onSave={(values) => save({ ...values, budgetId: budget.id }).then(() => done('Policy saved.')).catch(fail)}
              onRemove={own ? () => remove(budget.id).then(() => done('This budget follows the company default again.')).catch(fail) : null}
              removeText="Use the company default"
            />
          </>
        )}
      </div>
    </Dialog>
  );
}

function ApprovalsDrawer({ isOpen, approvals, onClose }) {
  return (
    <Drawer isOpen={isOpen} onClose={onClose} title="Approval history" size="45%">
      <div className={Classes.DRAWER_BODY} style={{ padding: 16 }}>
        {!approvals?.submissions?.length && <p className={Classes.TEXT_MUTED}>This version has not been submitted.</p>}
        {approvals?.submissions?.map((s) => (
          <div key={s.submissionNo} style={{ marginBottom: 16 }}>
            <h4 style={{ margin: '0 0 6px' }}>Submission {s.submissionNo}</h4>
            <HTMLTable compact style={{ width: '100%' }}>
              <tbody>
                {s.steps.map((step) => (
                  <tr key={step.id}>
                    <td style={{ width: 30 }}>{step.stepOrder}.</td>
                    <td>
                      {step.label}
                      {step.assignedUserName ? ` → ${step.assignedUserName}` : ''}
                    </td>
                    <td>
                      <Tag minimal intent={DECISION_INTENT[step.decision]}>{step.decision}</Tag>
                    </td>
                    <td>{step.decidedByName ?? ''}</td>
                    <td>{when(step.decidedAt)}</td>
                    <td>{step.comment ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </HTMLTable>
          </div>
        ))}
      </div>
    </Drawer>
  );
}

const AUDIT_LABEL = {
  created: 'Created',
  edited: 'Header edited',
  deleted: 'Deleted',
  lines_saved: 'Lines saved',
  submitted: 'Submitted',
  step_approved: 'Step approved',
  approved: 'Approved',
  rejected: 'Rejected',
  step_delegated: 'Step delegated',
  withdrawn: 'Withdrawn',
  cancelled: 'Version cancelled',
  locked: 'Locked',
  unlocked: 'Unlocked',
  revision_created: 'Revision created',
  scenario_created: 'Scenario created',
  control_policy_saved: 'Spending policy saved',
  control_policy_removed: 'Spending policy removed',
  override_requested: 'Override requested',
  override_approved: 'Override approved',
  override_rejected: 'Override rejected',
};

const auditSummary = (r) => {
  const m = r.metadata ?? {};
  const parts = [];
  if (m.versionNo) parts.push(`v${m.versionNo}`);
  if (m.comment) parts.push(`“${m.comment}”`);
  if (m.reason) parts.push(`“${m.reason}”`);
  if (r.action === 'lines_saved') parts.push(`${m.added ?? 0} added, ${m.updated ?? 0} updated, ${m.removed ?? 0} removed`);
  if (m.amount !== undefined) parts.push(fmt(m.amount));
  return parts.join(' · ');
};

function AuditDrawer({ isOpen, budget, onClose }) {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useBudgetAudit(budget.id, { page, pageSize: 50 }, { enabled: isOpen });
  const pages = data ? Math.max(1, Math.ceil(data.pagination.total / data.pagination.pageSize)) : 1;
  return (
    <Drawer isOpen={isOpen} onClose={onClose} title={`Audit history: ${budget.reference}`} size="55%">
      <div className={Classes.DRAWER_BODY} style={{ padding: 16 }}>
        {isLoading && <Spinner />}
        {data && (
          <>
            <HTMLTable compact striped style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>What</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((r) => (
                  <tr key={r.id}>
                    <td>{when(r.createdAt)}</td>
                    <td>{r.userName ?? ''}</td>
                    <td>{AUDIT_LABEL[r.action] ?? r.action}</td>
                    <td>{auditSummary(r)}</td>
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
    </Drawer>
  );
}
