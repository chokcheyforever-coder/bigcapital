// @ts-nocheck
// 103 DiTech: budget approval rules and the company's default spending policy (Phase 5).
import { useEffect, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { Button, Callout, Card, Classes, H4, HTMLSelect, HTMLTable, InputGroup, Intent, NavbarGroup, Spinner, Switch } from '@blueprintjs/core';
import { AppToaster, DashboardActionsBar, DashboardPageContent, EmptyStatus } from '@/components';
import { useAbilityContext } from '@/hooks/utils';
import { AbilitySubject, BudgetAction } from '@/constants/abilityOption';
import { useRoles } from '@/hooks/query/roles/queries';
import {
  useBudgetApprovalRules,
  useBudgetNotificationSettings,
  useBudgetPolicies,
  useDeleteBudgetPolicy,
  useSaveBudgetApprovalRules,
  useSaveBudgetNotificationSettings,
  useSaveBudgetPolicy,
} from '@/hooks/query/budgets';
import { errorMessage, fmt, PolicyForm } from './BudgetWorkflow';
import { useBudgetingEnabled } from './hooks';

const emptyRule = (minAmount = 0) => ({ minAmount, maxAmount: null, preventSelfApproval: true, steps: [{ order: 1, roleId: null, label: 'Approval' }] });

/** 103 DiTech: Financial > Budgets > Settings. */
export function BudgetSettingsPage() {
  const history = useHistory();
  const enabled = useBudgetingEnabled();
  const ability = useAbilityContext();
  const canConfigure = ability.can(BudgetAction.ConfigurePolicy, AbilitySubject.Budget);

  if (!enabled) return <DashboardPageContent><EmptyStatus title="Budgeting is not in your plan" description={<p>Available on the Business plan and above.</p>} /></DashboardPageContent>;

  return (
    <>
      <DashboardActionsBar>
        <NavbarGroup>
          <Button className={Classes.MINIMAL} icon="arrow-left" onClick={() => history.push('/budgets/approvals')} aria-label="Back to approvals" />
        </NavbarGroup>
      </DashboardActionsBar>
      <DashboardPageContent>
        <div style={{ padding: '12px 16px', maxWidth: 980 }}>
          {!canConfigure && (
            <Callout intent={Intent.PRIMARY} icon="lock" style={{ marginBottom: 12 }}>
              You can see these settings; changing them needs the “Configure budget policies” permission.
            </Callout>
          )}
          <ApprovalRulesCard readOnly={!canConfigure} />
          <DefaultPolicyCard readOnly={!canConfigure} />
          <NotificationsCard readOnly={!canConfigure} />
        </div>
      </DashboardPageContent>
    </>
  );
}

function ApprovalRulesCard({ readOnly }) {
  const { data, isLoading } = useBudgetApprovalRules();
  const { data: rolesData } = useRoles();
  const roles = Array.isArray(rolesData) ? rolesData : rolesData?.roles ?? rolesData?.data ?? [];
  const { mutateAsync: save, isPending } = useSaveBudgetApprovalRules();
  const [rules, setRules] = useState(null);
  useEffect(() => {
    if (data && rules === null) setRules(data.rules.map((r) => ({ ...r, steps: [...r.steps].sort((a, b) => a.order - b.order) })));
  }, [data, rules]);

  const update = (i, patch) => setRules(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const updateStep = (i, k, patch) => update(i, { steps: rules[i].steps.map((s, j) => (j === k ? { ...s, ...patch } : s)) });

  const submit = () =>
    save(
      rules.map((r) => ({
        minAmount: Number(r.minAmount) || 0,
        maxAmount: r.maxAmount === null || r.maxAmount === '' ? null : Number(r.maxAmount),
        preventSelfApproval: !!r.preventSelfApproval,
        steps: r.steps.map((s, k) => ({ order: k + 1, roleId: s.roleId ? Number(s.roleId) : null, label: s.label.trim() || `Step ${k + 1}` })),
      })),
    )
      .then((res) => {
        setRules(res.rules);
        AppToaster.show({ message: 'Approval rules saved. They apply to the next submissions.', intent: Intent.SUCCESS });
      })
      .catch((e) => AppToaster.show({ message: errorMessage(e, 'Could not save the rules.'), intent: Intent.DANGER }));

  return (
    <Card style={{ marginBottom: 16 }}>
      <H4>Approval rules</H4>
      <p className={Classes.TEXT_MUTED}>
        A submitted budget version goes through the steps of the rule that covers its amount (the sum of all its monthly amounts). Steps are decided in order; each names a
        role, or anyone allowed to approve budgets. With no matching rule, one person allowed to approve budgets — not the submitter — approves it.
      </p>
      {isLoading || rules === null ? (
        <Spinner />
      ) : (
        <>
          {rules.length === 0 && <p>No rules: the default single approval applies.</p>}
          {rules.map((rule, i) => (
            <Card key={i} style={{ marginBottom: 10, padding: 12 }} data-testid="approval-rule">
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
                <span>Amount from</span>
                <InputGroup style={{ width: 130 }} disabled={readOnly} value={rule.minAmount ?? ''} onChange={(e) => update(i, { minAmount: e.target.value })} />
                <span>up to (not including)</span>
                <InputGroup style={{ width: 130 }} disabled={readOnly} placeholder="no limit" value={rule.maxAmount ?? ''} onChange={(e) => update(i, { maxAmount: e.target.value === '' ? null : e.target.value })} />
                <Switch
                  disabled={readOnly}
                  style={{ margin: '0 0 0 12px' }}
                  checked={!!rule.preventSelfApproval}
                  label="Submitter cannot approve; one person per step"
                  onChange={(e) => update(i, { preventSelfApproval: e.target.checked })}
                />
                <span style={{ flex: 1 }} />
                {!readOnly && <Button minimal small icon="trash" intent={Intent.DANGER} onClick={() => setRules(rules.filter((_, j) => j !== i))} aria-label="Remove rule" />}
              </div>
              <HTMLTable compact style={{ width: '100%' }}>
                <tbody>
                  {rule.steps.map((step, k) => (
                    <tr key={k}>
                      <td style={{ width: 30 }}>{k + 1}.</td>
                      <td>
                        <InputGroup disabled={readOnly} value={step.label} onChange={(e) => updateStep(i, k, { label: e.target.value })} placeholder="Step name" />
                      </td>
                      <td>
                        <HTMLSelect
                          disabled={readOnly}
                          value={step.roleId ?? ''}
                          onChange={(e) => updateStep(i, k, { roleId: e.target.value ? Number(e.target.value) : null })}
                          options={[{ value: '', label: 'Anyone who can approve budgets' }, ...roles.map((r) => ({ value: r.id, label: r.name }))]}
                        />
                      </td>
                      <td style={{ width: 40 }}>
                        {!readOnly && rule.steps.length > 1 && (
                          <Button minimal small icon="cross" onClick={() => update(i, { steps: rule.steps.filter((_, j) => j !== k) })} aria-label="Remove step" />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </HTMLTable>
              {!readOnly && rule.steps.length < 5 && (
                <Button minimal small icon="add" text="Add step" onClick={() => update(i, { steps: [...rule.steps, { order: rule.steps.length + 1, roleId: null, label: '' }] })} />
              )}
            </Card>
          ))}
          {!readOnly && (
            <div style={{ display: 'flex', gap: 8 }}>
              <Button
                icon="add"
                text="Add rule"
                onClick={() => {
                  const last = rules[rules.length - 1];
                  setRules([...rules, emptyRule(last?.maxAmount ? Number(last.maxAmount) : rules.length ? '' : 0)]);
                }}
              />
              <Button intent={Intent.PRIMARY} text="Save rules" loading={isPending} onClick={submit} data-testid="save-rules" />
            </div>
          )}
          {rules.some((r) => r.maxAmount === null) && rules.length > 1 && (
            <p className={Classes.TEXT_MUTED} style={{ marginTop: 8 }}>
              Ranges must not overlap: only the highest rule can have no limit. Example: 0 – {fmt(10000)}, {fmt(10000)} – no limit.
            </p>
          )}
        </>
      )}
    </Card>
  );
}

function DefaultPolicyCard({ readOnly }) {
  const { data, isLoading } = useBudgetPolicies();
  const { mutateAsync: save, isPending } = useSaveBudgetPolicy();
  const { mutateAsync: remove } = useDeleteBudgetPolicy();
  const fail = (e) => AppToaster.show({ message: errorMessage(e, 'Could not save the policy.'), intent: Intent.DANGER });
  return (
    <Card>
      <H4>Spending control: company default</H4>
      <p className={Classes.TEXT_MUTED}>
        Applies to every budget without its own policy (set one from the budget's Version menu). Only approved budget versions control spending, on posted bills, expenses
        and manual journals; drafts count as commitments.
      </p>
      {isLoading || !data ? (
        <Spinner />
      ) : readOnly ? (
        <p>{data.default ? `${data.default.mode} · ${data.default.periodBasis} · alerts at ${data.default.thresholds.join(', ')}%` : 'Off'}</p>
      ) : (
        <>
          <PolicyForm
            key={data.default ? 'default' : 'none'}
            policy={data.default}
            saving={isPending}
            onSave={(values) => save({ ...values, budgetId: null }).then(() => AppToaster.show({ message: 'Default policy saved.', intent: Intent.SUCCESS })).catch(fail)}
            onRemove={data.default ? () => remove(null).then(() => AppToaster.show({ message: 'Default policy removed.', intent: Intent.SUCCESS })).catch(fail) : null}
            removeText="Remove default"
          />
          {data.budgets.length > 0 && (
            <p className={Classes.TEXT_MUTED} style={{ marginTop: 10 }}>
              {data.budgets.length} budget{data.budgets.length === 1 ? ' has its' : 's have their'} own policy.
            </p>
          )}
        </>
      )}
    </Card>
  );
}

const ALERT_LEVEL_LABEL = {
  off: 'No spending alerts',
  exceeded: 'When a line goes over its budget',
  warning: 'From the warning threshold (and when over)',
};

/** Budget emails on/off and when the budget owner hears about spending (design §15). */
function NotificationsCard({ readOnly }) {
  const { data, isLoading } = useBudgetNotificationSettings();
  const { mutateAsync: save, isPending } = useSaveBudgetNotificationSettings();
  const update = (patch) =>
    save({ ...data, ...patch })
      .then(() => AppToaster.show({ message: 'Notification settings saved.', intent: Intent.SUCCESS }))
      .catch((e) => AppToaster.show({ message: errorMessage(e, 'Could not save the settings.'), intent: Intent.DANGER }));
  return (
    <Card style={{ marginTop: 16 }} data-testid="notification-settings">
      <H4>Notifications</H4>
      <p className={Classes.TEXT_MUTED}>
        Approvers hear when a version waits for them, submitters when it is approved or rejected, approvers when someone asks to post over budget, and the budget owner
        when spending reaches the alert level (once per line, level and period). Notifications always show in Budgets › Approvals › Notifications.
      </p>
      {isLoading || !data ? (
        <Spinner />
      ) : (
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <Switch disabled={readOnly || isPending} checked={data.email} label="Also send them by email" onChange={(e) => update({ email: e.target.checked })} style={{ margin: 0 }} />
          <span>Spending alerts:</span>
          <HTMLSelect
            disabled={readOnly || isPending}
            value={data.alertLevel}
            onChange={(e) => update({ alertLevel: e.target.value })}
            options={Object.entries(ALERT_LEVEL_LABEL).map(([value, label]) => ({ value, label }))}
          />
        </div>
      )}
    </Card>
  );
}

export default BudgetSettingsPage;
