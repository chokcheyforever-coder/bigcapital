// 103 DiTech: spending control refusals (BUDGET_EXCEEDED, BUDGET_APPROVAL_REQUIRED)
// come from bills, expenses and manual journals. They are shown here once for
// every form, with a link to the budget's availability or to override requests.
import { Intent } from '@blueprintjs/core';
import { AppToaster } from '@/components';

export const BUDGET_CONTROL_ERRORS = ['BUDGET_EXCEEDED', 'BUDGET_APPROVAL_REQUIRED'];

type ControlError = { type?: string; message?: string; payload?: { checks?: Array<{ budgetId?: number; budget_id?: number }> } };

/** Shows a budget control refusal; returns true when the errors held one. */
export function showBudgetControlError(errors: ControlError[] | undefined): boolean {
  const error = errors?.find((e) => e.type && BUDGET_CONTROL_ERRORS.includes(e.type));
  if (!error) return false;
  const check = error.payload?.checks?.[0];
  const budgetId = check?.budgetId ?? check?.budget_id;
  const approval = error.type === 'BUDGET_APPROVAL_REQUIRED';
  AppToaster.show({
    intent: approval ? Intent.WARNING : Intent.DANGER,
    timeout: 12000,
    message: error.message ?? (approval ? 'This needs a budget override.' : 'This goes over budget.'),
    action: approval
      ? { text: 'Request override', onClick: () => (window.location.href = '/budgets/approvals?tab=overrides') }
      : budgetId
        ? { text: 'See budget', onClick: () => (window.location.href = `/budgets/${budgetId}/reports`) }
        : undefined,
  });
  return true;
}
