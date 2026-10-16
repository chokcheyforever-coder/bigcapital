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
