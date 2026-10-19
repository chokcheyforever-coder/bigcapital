export const BUDGETS = 'BUDGETS';
export const BUDGET = 'BUDGET';
export const BUDGET_VERSION = 'BUDGET_VERSION';
export const BUDGET_REPORT = 'BUDGET_REPORT';

export const budgetsKeys = {
  all: () => [BUDGETS] as const,
  list: (query?: Record<string, unknown>) => [BUDGETS, query] as const,
  detail: (id: number | string | null | undefined) => [BUDGET, id] as const,
  version: (id: number | string | null | undefined, versionNo: number | string | null | undefined) =>
    [BUDGET_VERSION, id, versionNo] as const,
  report: (report: string, query?: Record<string, unknown>) => [BUDGET_REPORT, report, query] as const,
};

// Phase 5: approvals and spending control. Every budget mutation invalidates the BUDGET_WORKFLOW prefix.
export const BUDGET_WORKFLOW = 'BUDGET_WORKFLOW';
export const budgetWorkflowKeys = {
  all: () => [BUDGET_WORKFLOW] as const,
  approvals: (query?: Record<string, unknown>) => [BUDGET_WORKFLOW, 'approvals', query] as const,
  rules: () => [BUDGET_WORKFLOW, 'rules'] as const,
  versionApprovals: (id: number | string, versionNo: number | string) => [BUDGET_WORKFLOW, 'version', id, versionNo] as const,
  compare: (id: number | string, query?: Record<string, unknown>) => [BUDGET_WORKFLOW, 'compare', id, query] as const,
  audit: (id: number | string, query?: Record<string, unknown>) => [BUDGET_WORKFLOW, 'audit', id, query] as const,
  policies: () => [BUDGET_WORKFLOW, 'policies'] as const,
  overrides: (query?: Record<string, unknown>) => [BUDGET_WORKFLOW, 'overrides', query] as const,
  drafts: () => [BUDGET_WORKFLOW, 'drafts'] as const,
  alerts: (query?: Record<string, unknown>) => [BUDGET_WORKFLOW, 'alerts', query] as const,
  availability: (id: number | string, query?: Record<string, unknown>) => [BUDGET_WORKFLOW, 'availability', id, query] as const,
  // Phase 6: forecasts, dashboard and notifications (same prefix, so budget changes refresh them).
  forecastVsBudget: (id: number | string, query?: Record<string, unknown>) => [BUDGET_WORKFLOW, 'forecast-vs-budget', id, query] as const,
  rolling: (id: number | string, query?: Record<string, unknown>) => [BUDGET_WORKFLOW, 'rolling', id, query] as const,
  dashboard: (query?: Record<string, unknown>) => [BUDGET_WORKFLOW, 'dashboard', query] as const,
  notifications: (query?: Record<string, unknown>) => [BUDGET_WORKFLOW, 'notifications', query] as const,
  notificationSettings: () => [BUDGET_WORKFLOW, 'notification-settings'] as const,
};
