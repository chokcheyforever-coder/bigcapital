/**
 * Budget approval workflow rules (design §12). Pure functions, no database:
 * the service loads the rows, asks these what is allowed, and writes the result.
 */
import { BudgetVersionKind, BudgetVersionStatus } from '../Budgeting.types';

export type Milli = number;

export interface ApprovalRuleStep {
  order: number;
  /** Role that decides this step; null = anyone with the Budget Approve permission. */
  roleId: number | null;
  label: string;
}

export interface ApprovalRule {
  id: number | null;
  /** Inclusive lower bound of the version's gross amount, in milli-units. */
  minAmount: Milli;
  /** Exclusive upper bound; null = no limit. */
  maxAmount: Milli | null;
  steps: ApprovalRuleStep[];
  preventSelfApproval: boolean;
}

export type StepDecision = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface ApprovalStepState {
  stepOrder: number;
  roleId: number | null;
  assignedUserId: number | null;
  decision: StepDecision | string;
  decidedBy: number | null;
}

export interface Actor {
  /** System user id (what `created_by`, `submitted_by` and `decided_by` store). */
  userId: number;
  roleId: number | null;
  /** The predefined admin role may act on any step (it holds every permission). */
  isAdmin: boolean;
}

export class ApprovalError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 409,
  ) {
    super(message);
  }
}

export const APPROVAL_ERRORS = {
  INVALID_STATUS: 'BUDGET_INVALID_STATUS',
  NOT_SUBMITTABLE: 'BUDGET_VERSION_NOT_SUBMITTABLE',
  EMPTY_VERSION: 'BUDGET_VERSION_EMPTY',
  NOT_YOUR_STEP: 'BUDGET_NOT_YOUR_STEP',
  SELF_APPROVAL: 'BUDGET_SELF_APPROVAL',
  SAME_APPROVER: 'BUDGET_SAME_APPROVER',
  NO_PENDING_STEP: 'BUDGET_NO_PENDING_STEP',
  OPEN_REVISION_EXISTS: 'BUDGET_OPEN_REVISION_EXISTS',
  INVALID_SOURCE: 'BUDGET_INVALID_REVISION_SOURCE',
  INVALID_RULES: 'BUDGET_INVALID_APPROVAL_RULES',
  CANNOT_CANCEL_ORIGINAL: 'BUDGET_CANNOT_CANCEL_ORIGINAL',
};

/** Used when no rule covers the amount: one step, anyone with Approve, never the submitter. */
export const DEFAULT_RULE: ApprovalRule = {
  id: null,
  minAmount: 0,
  maxAmount: null,
  steps: [{ order: 1, roleId: null, label: 'Approval' }],
  preventSelfApproval: true,
};

const OPEN_STATUSES: string[] = [
  BudgetVersionStatus.Draft,
  BudgetVersionStatus.Submitted,
  BudgetVersionStatus.UnderReview,
  BudgetVersionStatus.Rejected,
];

/** Statuses a version may be submitted from. */
export const SUBMITTABLE_STATUSES: string[] = [BudgetVersionStatus.Draft, BudgetVersionStatus.Rejected];
/** Statuses in which approvers are deciding. */
export const IN_REVIEW_STATUSES: string[] = [BudgetVersionStatus.Submitted, BudgetVersionStatus.UnderReview];
/** Statuses that can control spending and be revised. */
export const APPROVED_STATUSES: string[] = [BudgetVersionStatus.Approved, BudgetVersionStatus.Locked];

const invalidStatus = (action: string, status: string) =>
  new ApprovalError(APPROVAL_ERRORS.INVALID_STATUS, `A ${status} version cannot be ${action}.`);

/** Gross amount a rule is matched on: the sum of every monthly amount, sign ignored. */
export const grossAmount = (amounts: Milli[]): Milli => amounts.reduce((sum, a) => sum + Math.abs(a), 0);

/**
 * Rules must have 1–5 steps with distinct orders and must not overlap, so one
 * amount always picks one rule.
 */
export function validateRules(rules: ApprovalRule[]): void {
  const fail = (message: string) => new ApprovalError(APPROVAL_ERRORS.INVALID_RULES, message, 400);
  for (const [i, rule] of rules.entries()) {
    if (rule.minAmount < 0) throw fail(`Rule ${i + 1}: the minimum cannot be negative.`);
    if (rule.maxAmount !== null && rule.maxAmount <= rule.minAmount) throw fail(`Rule ${i + 1}: the maximum must be above the minimum.`);
    if (rule.steps.length < 1 || rule.steps.length > 5) throw fail(`Rule ${i + 1}: a rule has 1 to 5 steps.`);
    if (new Set(rule.steps.map((s) => s.order)).size !== rule.steps.length) throw fail(`Rule ${i + 1}: two steps have the same order.`);
  }
  const sorted = [...rules].sort((a, b) => a.minAmount - b.minAmount);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    if (prev.maxAmount === null || prev.maxAmount > sorted[i].minAmount) {
      throw fail('Two rules cover the same amount; their ranges must not overlap.');
    }
  }
}

/** The rule whose range holds the amount, else the default rule. */
export function pickRule(rules: ApprovalRule[], amount: Milli): ApprovalRule {
  return rules.find((r) => amount >= r.minAmount && (r.maxAmount === null || amount < r.maxAmount)) ?? DEFAULT_RULE;
}

/** Steps to create on submission, ordered. */
export function stepsFor(rule: ApprovalRule): ApprovalRuleStep[] {
  return [...rule.steps].sort((a, b) => a.order - b.order);
}

export function ensureSubmittable(version: { status: string; kind: string }, lineCount: number) {
  if (version.kind === BudgetVersionKind.Scenario) {
    throw new ApprovalError(APPROVAL_ERRORS.NOT_SUBMITTABLE, 'A scenario is a what-if copy; create a revision from it to submit it.');
  }
  if (!SUBMITTABLE_STATUSES.includes(version.status)) throw invalidStatus('submitted', version.status);
  if (lineCount === 0) throw new ApprovalError(APPROVAL_ERRORS.EMPTY_VERSION, 'Add at least one line before submitting.');
}

/** The step waiting for a decision: the lowest pending order. */
export function currentStep<T extends ApprovalStepState>(steps: T[]): T | null {
  return [...steps].sort((a, b) => a.stepOrder - b.stepOrder).find((s) => s.decision === 'pending') ?? null;
}

/** Whether the actor may approve or reject the current step; throws the reason when not. */
export function ensureCanDecide(
  steps: ApprovalStepState[],
  actor: Actor,
  submittedBy: number | null,
  preventSelfApproval: boolean,
): ApprovalStepState {
  const step = currentStep(steps);
  if (!step) throw new ApprovalError(APPROVAL_ERRORS.NO_PENDING_STEP, 'No approval step is waiting.');

  if (step.assignedUserId !== null) {
    if (step.assignedUserId !== actor.userId && !actor.isAdmin) {
      throw new ApprovalError(APPROVAL_ERRORS.NOT_YOUR_STEP, 'This step was delegated to another user.', 403);
    }
  } else if (step.roleId !== null && step.roleId !== actor.roleId && !actor.isAdmin) {
    throw new ApprovalError(APPROVAL_ERRORS.NOT_YOUR_STEP, 'This step is for another role.', 403);
  }
  if (preventSelfApproval) {
    if (submittedBy !== null && submittedBy === actor.userId) {
      throw new ApprovalError(APPROVAL_ERRORS.SELF_APPROVAL, 'You submitted this version, so someone else must approve it.', 403);
    }
    if (steps.some((s) => s.decision === 'approved' && s.decidedBy === actor.userId)) {
      throw new ApprovalError(APPROVAL_ERRORS.SAME_APPROVER, 'You already approved an earlier step; another approver must decide this one.', 403);
    }
  }
  return step;
}

/** Status after the current step is approved. */
export function statusAfterApproval(steps: ApprovalStepState[]): BudgetVersionStatus {
  const pending = steps.filter((s) => s.decision === 'pending');
  // The step being approved is still pending in `steps`.
  return pending.length <= 1 ? BudgetVersionStatus.Approved : BudgetVersionStatus.UnderReview;
}

export function ensureInReview(version: { status: string }, action: string) {
  if (!IN_REVIEW_STATUSES.includes(version.status)) throw invalidStatus(action, version.status);
}

export function ensureLockable(version: { status: string }) {
  if (version.status !== BudgetVersionStatus.Approved) throw invalidStatus('locked', version.status);
}

export function ensureUnlockable(version: { status: string }) {
  if (version.status !== BudgetVersionStatus.Locked) throw invalidStatus('unlocked', version.status);
}

export function ensureCancellable(version: { status: string; kind: string }) {
  if (version.kind === BudgetVersionKind.Original) {
    throw new ApprovalError(APPROVAL_ERRORS.CANNOT_CANCEL_ORIGINAL, 'The original version cannot be cancelled; delete the budget instead.');
  }
  if (!SUBMITTABLE_STATUSES.includes(version.status)) throw invalidStatus('cancelled', version.status);
}

/**
 * A revision starts from an approved or locked version (or from a scenario),
 * and a budget has at most one revision in progress.
 */
export function ensureCanRevise(source: { status: string; kind: string }, versions: Array<{ kind: string; status: string }>) {
  const fromScenario = source.kind === BudgetVersionKind.Scenario;
  if (!fromScenario && !APPROVED_STATUSES.includes(source.status)) {
    throw new ApprovalError(APPROVAL_ERRORS.INVALID_SOURCE, 'A revision starts from an approved or locked version, or from a scenario.');
  }
  if (!versions.some((v) => APPROVED_STATUSES.includes(v.status))) {
    throw new ApprovalError(APPROVAL_ERRORS.INVALID_SOURCE, 'Get the original version approved before revising it.');
  }
  if (versions.some((v) => v.kind === BudgetVersionKind.Revision && OPEN_STATUSES.includes(v.status))) {
    throw new ApprovalError(APPROVAL_ERRORS.OPEN_REVISION_EXISTS, 'A revision is already in progress; finish or cancel it first.');
  }
}
