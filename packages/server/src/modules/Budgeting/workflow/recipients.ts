/**
 * Who hears about a budget event (DiTech Phase 6, design §15). Pure functions:
 * the notification service loads the users and asks these who to tell.
 */

export interface Candidate {
  /** System user id (what steps, versions and notifications store). */
  userId: number;
  roleId: number | null;
  active: boolean;
  isAdmin: boolean;
  /** The user's role has Budget Approve. */
  canApprove: boolean;
}

export interface StepTarget {
  roleId: number | null;
  assignedUserId: number | null;
}

const unique = (ids: number[]) => [...new Set(ids)];

/**
 * The people who can decide a step: its delegate when it has one; else the
 * active users of its role (admins when nobody has that role); else everyone
 * who can approve budgets. `exclude` drops the submitter when self-approval is
 * prevented, and whoever already decided an earlier step.
 */
export function stepDeciders(users: Candidate[], step: StepTarget, exclude: number[] = []): number[] {
  const active = users.filter((u) => u.active);
  let ids: number[];
  if (step.assignedUserId) {
    ids = [step.assignedUserId];
  } else if (step.roleId) {
    const inRole = active.filter((u) => u.roleId === step.roleId);
    ids = (inRole.length ? inRole : active.filter((u) => u.isAdmin)).map((u) => u.userId);
  } else {
    ids = active.filter((u) => u.canApprove || u.isAdmin).map((u) => u.userId);
  }
  return unique(ids).filter((id) => !exclude.includes(id));
}

/** Everyone who can approve budgets (override requests), except `exclude`. */
export function approvers(users: Candidate[], exclude: number[] = []): number[] {
  return unique(users.filter((u) => u.active && (u.canApprove || u.isAdmin)).map((u) => u.userId)).filter((id) => !exclude.includes(id));
}

/** The people a decision goes back to: submitter and budget owner, once each, never the one who decided. */
export function interested(ids: Array<number | null | undefined>, exclude: Array<number | null | undefined> = []): number[] {
  return unique(ids.filter((id): id is number => !!id)).filter((id) => !exclude.includes(id));
}

export type AlertLevel = 'off' | 'exceeded' | 'warning';

/** Whether a spending control level reaches the company's alert setting. */
export function alertReaches(level: string, setting: AlertLevel): boolean {
  if (setting === 'off') return false;
  if (setting === 'exceeded') return level === 'exceeded';
  return level === 'exceeded' || level === 'warning';
}

/** Minimal HTML escaping for values put into notification emails. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
