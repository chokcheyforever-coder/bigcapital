import type { ApiFetcher } from './fetch-utils';
import { paths } from './schema';
import { OpForPath, OpQueryParams, OpRequestBody } from './utils';

/** 103 DiTech budgeting (docs/ditech/budgeting). File import/export go through plain fetch (multipart/binary). */
export const BUDGETS_ROUTES = {
  LIST: '/api/budgets',
  BY_ID: '/api/budgets/{id}',
  VERSION: '/api/budgets/{id}/versions/{versionNo}',
  LINES: '/api/budgets/{id}/versions/{versionNo}/lines',
  ALLOCATE: '/api/budgets/{id}/allocate',
  PREFILL: '/api/budgets/{id}/prefill',
  REPORT: '/api/budgets/reports/{report}',
} as const satisfies Record<string, keyof paths>;

export type GetBudgetsQuery = OpQueryParams<OpForPath<typeof BUDGETS_ROUTES.LIST, 'get'>>;
export type CreateBudgetBody = OpRequestBody<OpForPath<typeof BUDGETS_ROUTES.LIST, 'post'>>;
export type EditBudgetBody = OpRequestBody<OpForPath<typeof BUDGETS_ROUTES.BY_ID, 'put'>>;
export type SaveBudgetLinesBody = OpRequestBody<OpForPath<typeof BUDGETS_ROUTES.LINES, 'put'>>;
export type AllocateBudgetBody = OpRequestBody<OpForPath<typeof BUDGETS_ROUTES.ALLOCATE, 'post'>>;
export type PrefillBudgetBody = OpRequestBody<OpForPath<typeof BUDGETS_ROUTES.PREFILL, 'post'>>;
export type BudgetReportQuery = OpQueryParams<OpForPath<typeof BUDGETS_ROUTES.REPORT, 'get'>>;

// Responses (camelCased by the fetcher). Month keys are "YYYY-MM-01".
export type BudgetType = 'profit_loss' | 'revenue' | 'operating_expenses' | 'operational' | 'capex';
export type BudgetVersionStatus = 'draft' | 'submitted' | 'under_review' | 'approved' | 'locked' | 'rejected' | 'cancelled';

export interface Budget {
  id: number;
  reference: string;
  name: string;
  type: BudgetType;
  fiscalYear: number;
  startDate: string;
  endDate: string;
  currencyCode: string;
  branchId: number | null;
  projectId: number | null;
  ownerUserId: number | null;
  description: string | null;
  notes: string | null;
  activeVersionId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface BudgetVersion {
  id: number;
  versionNo: number;
  kind: 'original' | 'revision' | 'forecast' | 'scenario';
  scenario: string | null;
  label: string | null;
  status: BudgetVersionStatus;
  lockVersion: number;
  revisionReason: string | null;
  createdAt: string;
  updatedAt: string;
  total?: number;
}

export interface BudgetsListResponse {
  data: Array<Budget & { versionsCount: number; latestVersion: BudgetVersion | null }>;
  pagination: { page: number; pageSize: number; total: number };
}

export interface BudgetDetail extends Budget {
  months: string[];
  versions: BudgetVersion[];
}

export interface BudgetPeriodAmounts {
  months: Record<string, number>;
  quarters: number[];
  total: number;
}

export interface BudgetVersionLine extends BudgetPeriodAmounts {
  id: number;
  accountId: number;
  account: { id: number; code: string | null; name: string; accountType: string; rootType: string; normal: string };
  branchId: number | null;
  projectId: number | null;
  note: string | null;
  assumption: string | null;
}

export interface BudgetVersionDetail {
  budget: Budget;
  version: BudgetVersion;
  months: string[];
  quarters: Array<{ label: string; months: string[] }>;
  lines: BudgetVersionLine[];
  totals: {
    groups: Array<BudgetPeriodAmounts & { rootType: string }>;
    netIncome: BudgetPeriodAmounts;
    grand: BudgetPeriodAmounts;
  };
}

export interface BudgetAllocationResult {
  method: string;
  months: string[];
  amounts: Record<string, number>;
  total: number;
}

export interface BudgetPrefillResult {
  source: Record<string, unknown>;
  months: string[];
  lines: Array<{
    accountId: number;
    account: { id: number; code: string | null; name: string; accountType: string };
    branchId: number | null;
    projectId: number | null;
    amounts: Array<{ month: string; amount: number }>;
    total: number;
  }>;
  total: number;
}

export async function fetchBudgets(fetcher: ApiFetcher, query?: GetBudgetsQuery): Promise<BudgetsListResponse> {
  const get = fetcher.path(BUDGETS_ROUTES.LIST).method('get').create();
  const { data } = await get((query ?? {}) as never);
  return data as unknown as BudgetsListResponse;
}

export async function fetchBudget(fetcher: ApiFetcher, id: number | string): Promise<BudgetDetail> {
  const get = fetcher.path(BUDGETS_ROUTES.BY_ID).method('get').create();
  const { data } = await get({ id: Number(id) } as never);
  return data as unknown as BudgetDetail;
}

export async function createBudget(fetcher: ApiFetcher, values: CreateBudgetBody): Promise<BudgetDetail> {
  const post = fetcher.path(BUDGETS_ROUTES.LIST).method('post').create();
  const { data } = await post(values as never);
  return data as unknown as BudgetDetail;
}

export async function editBudget(fetcher: ApiFetcher, id: number | string, values: EditBudgetBody): Promise<BudgetDetail> {
  const put = fetcher.path(BUDGETS_ROUTES.BY_ID).method('put').create();
  const { data } = await put({ id: Number(id), ...values } as never);
  return data as unknown as BudgetDetail;
}

export async function deleteBudget(fetcher: ApiFetcher, id: number | string): Promise<void> {
  const del = fetcher.path(BUDGETS_ROUTES.BY_ID).method('delete').create();
  await del({ id: Number(id) } as never);
}

export async function fetchBudgetVersion(fetcher: ApiFetcher, id: number | string, versionNo: number | string): Promise<BudgetVersionDetail> {
  const get = fetcher.path(BUDGETS_ROUTES.VERSION).method('get').create();
  const { data } = await get({ id: Number(id), versionNo: Number(versionNo) } as never);
  return data as unknown as BudgetVersionDetail;
}

export async function saveBudgetLines(
  fetcher: ApiFetcher,
  id: number | string,
  versionNo: number | string,
  values: SaveBudgetLinesBody
): Promise<BudgetVersionDetail> {
  const put = fetcher.path(BUDGETS_ROUTES.LINES).method('put').create();
  const { data } = await put({ id: Number(id), versionNo: Number(versionNo), ...values } as never);
  return data as unknown as BudgetVersionDetail;
}

export async function allocateBudget(fetcher: ApiFetcher, id: number | string, values: AllocateBudgetBody): Promise<BudgetAllocationResult> {
  const post = fetcher.path(BUDGETS_ROUTES.ALLOCATE).method('post').create();
  const { data } = await post({ id: Number(id), ...values } as never);
  return data as unknown as BudgetAllocationResult;
}

export async function prefillBudget(fetcher: ApiFetcher, id: number | string, values: PrefillBudgetBody): Promise<BudgetPrefillResult> {
  const post = fetcher.path(BUDGETS_ROUTES.PREFILL).method('post').create();
  const { data } = await post({ id: Number(id), ...values } as never);
  return data as unknown as BudgetPrefillResult;
}

// ---------------------------------------------------------------- budget vs actual (Phase 4)

export type BudgetReportName =
  | 'budget-vs-actual'
  | 'monthly-variance'
  | 'branch'
  | 'project'
  | 'revenue-achievement'
  | 'expense-utilization'
  | 'capex'
  | 'exceptions';

export interface BudgetReportFigures {
  budget: number;
  actual: number;
  variance: number;
  /** null when the budget is 0 (n/a). */
  variancePercent: number | null;
  /** Achievement (income) or utilization (spend); null when the budget is 0. */
  usedPercent: number | null;
  favorable: boolean;
  unbudgeted: boolean;
  /** CAPEX only. */
  disposals?: number;
}

export interface BudgetReportTotals {
  columns: Array<BudgetReportFigures & { key: string }>;
  total: BudgetReportFigures;
}

export interface BudgetReportRow extends BudgetReportTotals {
  key: string;
  lineId: number | null;
  account: { id: number; code: string | null; name: string; accountType: string; rootType: string; normal: string };
  branch: { id: number; name: string } | null;
  project: { id: number; name: string } | null;
  note: string | null;
  unbudgeted: boolean;
  direction: 'income' | 'spend';
  status: 'unbudgeted' | 'over' | 'near' | 'on_track' | 'no_activity' | null;
  exception: boolean;
  drilldown: { fromDate: string; toDate: string; accountsIds: number[]; branchesIds: number[]; projectsIds: number[]; exact: boolean };
}

export interface BudgetReport {
  report: BudgetReportName;
  budget: Budget;
  version: BudgetVersion;
  currencyCode: string;
  period: { fromMonth: string; toMonth: string; fromDate: string; toDate: string; months: string[] };
  filter: {
    branchesIds: number[];
    projectsIds: number[];
    columns: 'total' | 'quarter' | 'month';
    thresholdPercent: number;
    nearPercent: number;
    includeUnbudgeted: boolean;
  };
  columns: Array<{ key: string; label: string; months: string[] }>;
  rows: BudgetReportRow[];
  groups: Array<BudgetReportTotals & { key: string; rootType: string }>;
  /** Branch and project reports: totals per branch or project. */
  dimensions?: Array<{
    key: string;
    branch?: { id: number; name: string } | null;
    project?: { id: number; name: string } | null;
    groups: Array<BudgetReportTotals & { rootType: string }>;
    netIncome: BudgetReportTotals | null;
  }>;
  netIncome: BudgetReportTotals | null;
}

export async function fetchBudgetReport(fetcher: ApiFetcher, report: BudgetReportName, query: BudgetReportQuery): Promise<BudgetReport> {
  const get = fetcher.path(BUDGETS_ROUTES.REPORT).method('get').create();
  const { data } = await get({ report, ...query } as never);
  return data as unknown as BudgetReport;
}
