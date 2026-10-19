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
  // Phase 5: approvals and versions.
  APPROVALS: '/api/budgets/approvals',
  APPROVAL_RULES: '/api/budgets/settings/approval-rules',
  VERSION_APPROVALS: '/api/budgets/{id}/versions/{versionNo}/approvals',
  SUBMIT: '/api/budgets/{id}/versions/{versionNo}/submit',
  APPROVE: '/api/budgets/{id}/versions/{versionNo}/approve',
  REJECT: '/api/budgets/{id}/versions/{versionNo}/reject',
  DELEGATE: '/api/budgets/{id}/versions/{versionNo}/delegate',
  WITHDRAW: '/api/budgets/{id}/versions/{versionNo}/withdraw',
  CANCEL: '/api/budgets/{id}/versions/{versionNo}/cancel',
  LOCK: '/api/budgets/{id}/versions/{versionNo}/lock',
  UNLOCK: '/api/budgets/{id}/versions/{versionNo}/unlock',
  REVISIONS: '/api/budgets/{id}/revisions',
  SCENARIOS: '/api/budgets/{id}/scenarios',
  COMPARE: '/api/budgets/{id}/compare',
  AUDIT: '/api/budgets/{id}/audit',
  // Phase 5: spending control.
  POLICIES: '/api/budgets/settings/policies',
  OVERRIDES: '/api/budgets/overrides',
  OVERRIDE_DRAFTS: '/api/budgets/overrides/drafts',
  OVERRIDE_APPROVE: '/api/budgets/overrides/{id}/approve',
  OVERRIDE_REJECT: '/api/budgets/overrides/{id}/reject',
  ALERTS: '/api/budgets/alerts',
  AVAILABILITY: '/api/budgets/{id}/availability',
  // Phase 6: forecasts, dashboard, notifications.
  DASHBOARD: '/api/budgets/dashboard',
  NOTIFICATIONS: '/api/budgets/notifications',
  NOTIFICATIONS_READ: '/api/budgets/notifications/read',
  NOTIFICATION_SETTINGS: '/api/budgets/settings/notifications',
  FORECASTS: '/api/budgets/{id}/forecasts',
  FORECAST_REFRESH: '/api/budgets/{id}/versions/{versionNo}/forecast/refresh',
  FORECAST_VS_BUDGET: '/api/budgets/{id}/forecast-vs-budget',
  ROLLING_FORECAST: '/api/budgets/{id}/rolling-forecast',
} as const satisfies Record<string, keyof paths>;

export type GetBudgetsQuery = OpQueryParams<OpForPath<typeof BUDGETS_ROUTES.LIST, 'get'>>;
export type CreateBudgetBody = OpRequestBody<OpForPath<typeof BUDGETS_ROUTES.LIST, 'post'>>;
export type EditBudgetBody = OpRequestBody<OpForPath<typeof BUDGETS_ROUTES.BY_ID, 'put'>>;
export type SaveBudgetLinesBody = OpRequestBody<OpForPath<typeof BUDGETS_ROUTES.LINES, 'put'>>;
export type AllocateBudgetBody = OpRequestBody<OpForPath<typeof BUDGETS_ROUTES.ALLOCATE, 'post'>>;
export type PrefillBudgetBody = OpRequestBody<OpForPath<typeof BUDGETS_ROUTES.PREFILL, 'post'>>;
export type BudgetReportQuery = OpQueryParams<OpForPath<typeof BUDGETS_ROUTES.REPORT, 'get'>>;

// Responses (camelCased by the fetcher). Month keys are "YYYY-MM-01".
export type BudgetType = 'profit_loss' | 'revenue' | 'operating_expenses' | 'operational' | 'capex' | 'balance_sheet' | 'cash_flow';
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
  sourceVersionId?: number | null;
  submissionNo?: number;
  submittedAt?: string | null;
  submittedBy?: number | null;
  approvedAt?: string | null;
  approvedBy?: number | null;
  lockedAt?: string | null;
  lockedBy?: number | null;
  /** Forecast versions: how they were made. */
  forecast?: BudgetForecastSettings | null;
  createdAt: string;
  updatedAt: string;
  total?: number;
}

export type BudgetForecastMethod = 'budget' | 'run_rate' | 'growth' | 'seasonal';

export interface BudgetForecastSettings {
  method: BudgetForecastMethod;
  asOfMonth: string | null;
  runRateMonths?: number;
  growthPercent?: number;
  baseVersionNo?: number;
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
  /** Balance sheet budgets: amounts are month-end balances; quarters and totals are the last month. */
  closing?: boolean;
  quarters: Array<{ label: string; months: string[] }>;
  lines: BudgetVersionLine[];
  totals: {
    groups: Array<BudgetPeriodAmounts & { rootType: string }>;
    /** null for balance sheet, cash flow and CAPEX budgets. */
    netIncome: BudgetPeriodAmounts | null;
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
  /** Cash flow only: money in (debits) and out (credits) of the cash accounts. */
  inflows?: number;
  outflows?: number;
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

export interface BudgetCashPosition {
  opening: number;
  columns: Array<{ key: string; budget: number; actual: number; variance: number }>;
  closing: { budget: number; actual: number; variance: number };
}

export interface BudgetReport {
  report: BudgetReportName;
  /** Balance sheet: figures are month-end balances; a column shows its last month. */
  closing?: boolean;
  /** Cash flow budgets: cash at the start and at the end of each column. */
  cashPosition?: BudgetCashPosition | null;
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

// ---------------------------------------------------------------- approvals and versions (Phase 5a)

export interface BudgetApprovalStep {
  id: number;
  submissionNo: number;
  stepOrder: number;
  label: string;
  roleId: number | null;
  assignedUserId: number | null;
  assignedUserName: string | null;
  decision: 'pending' | 'approved' | 'rejected' | 'cancelled';
  comment: string | null;
  decidedBy: number | null;
  decidedByName: string | null;
  decidedAt: string | null;
}

export interface BudgetVersionApprovals {
  version: BudgetVersion & { submittedByName: string | null; approvedByName: string | null; lockedByName: string | null };
  currentStep: BudgetApprovalStep | null;
  canDecide: boolean;
  cannotDecideReason: string | null;
  preventSelfApproval: boolean | null;
  submissions: Array<{ submissionNo: number; steps: BudgetApprovalStep[] }>;
}

export interface BudgetApprovalRow {
  budget: Pick<Budget, 'id' | 'reference' | 'name' | 'type' | 'fiscalYear'>;
  version: BudgetVersion;
  grossAmount: number;
  submittedBy: number | null;
  submittedByName: string | null;
  stepsTotal: number;
  stepsApproved: number;
  waitingStep: BudgetApprovalStep | null;
  waitingDays: number | null;
  canDecide: boolean;
}

export interface BudgetApprovalRule {
  id?: number | null;
  minAmount: number;
  maxAmount: number | null;
  steps: Array<{ order: number; roleId: number | null; label: string }>;
  preventSelfApproval: boolean;
}

export interface BudgetComparison {
  budget: Budget;
  base: BudgetVersion;
  compare: BudgetVersion;
  months: string[];
  lines: Array<{
    accountId: number;
    account: { id: number; code: string | null; name: string; rootType: string };
    branchId: number | null;
    projectId: number | null;
    change: 'added' | 'removed' | 'changed' | 'unchanged';
    base: { months: Record<string, number>; total: number };
    compare: { months: Record<string, number>; total: number };
    difference: number;
    differencePercent: number | null;
  }>;
  totals: { base: number; compare: number; difference: number; differencePercent: number | null };
}

export interface BudgetAuditEntry {
  id: number;
  action: string;
  userId: number | null;
  userName: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

type VersionRef = { id: number | string; versionNo: number | string };
const ref = ({ id, versionNo }: VersionRef) => ({ id: Number(id), versionNo: Number(versionNo) });

export async function fetchBudgetApprovals(fetcher: ApiFetcher, query?: { mine?: boolean; status?: 'in_review' | 'all' }): Promise<{ data: BudgetApprovalRow[] }> {
  const get = fetcher.path(BUDGETS_ROUTES.APPROVALS).method('get').create();
  const { data } = await get((query ?? {}) as never);
  return data as unknown as { data: BudgetApprovalRow[] };
}

export async function fetchBudgetApprovalRules(fetcher: ApiFetcher): Promise<{ rules: BudgetApprovalRule[] }> {
  const get = fetcher.path(BUDGETS_ROUTES.APPROVAL_RULES).method('get').create();
  const { data } = await get({} as never);
  return data as unknown as { rules: BudgetApprovalRule[] };
}

export async function saveBudgetApprovalRules(fetcher: ApiFetcher, rules: BudgetApprovalRule[]): Promise<{ rules: BudgetApprovalRule[] }> {
  const put = fetcher.path(BUDGETS_ROUTES.APPROVAL_RULES).method('put').create();
  const { data } = await put({ rules } as never);
  return data as unknown as { rules: BudgetApprovalRule[] };
}

export async function fetchBudgetVersionApprovals(fetcher: ApiFetcher, v: VersionRef): Promise<BudgetVersionApprovals> {
  const get = fetcher.path(BUDGETS_ROUTES.VERSION_APPROVALS).method('get').create();
  const { data } = await get(ref(v) as never);
  return data as unknown as BudgetVersionApprovals;
}

export type BudgetVersionAction = 'submit' | 'approve' | 'reject' | 'delegate' | 'withdraw' | 'cancel' | 'lock' | 'unlock';

const ACTION_ROUTES = {
  submit: BUDGETS_ROUTES.SUBMIT,
  approve: BUDGETS_ROUTES.APPROVE,
  reject: BUDGETS_ROUTES.REJECT,
  delegate: BUDGETS_ROUTES.DELEGATE,
  withdraw: BUDGETS_ROUTES.WITHDRAW,
  cancel: BUDGETS_ROUTES.CANCEL,
  lock: BUDGETS_ROUTES.LOCK,
  unlock: BUDGETS_ROUTES.UNLOCK,
} as const;

/** Runs a workflow action on a version; body: { comment } (reject: required), delegate: { userId, comment }. */
export async function runBudgetVersionAction(
  fetcher: ApiFetcher,
  action: BudgetVersionAction,
  v: VersionRef,
  body: { comment?: string; userId?: number } = {},
): Promise<unknown> {
  const post = fetcher.path(ACTION_ROUTES[action]).method('post').create();
  const { data } = await post({ ...ref(v), ...body } as never);
  return data;
}

export async function createBudgetRevision(
  fetcher: ApiFetcher,
  id: number | string,
  values: { reason: string; sourceVersionNo?: number; label?: string },
): Promise<BudgetVersionDetail> {
  const post = fetcher.path(BUDGETS_ROUTES.REVISIONS).method('post').create();
  const { data } = await post({ id: Number(id), ...values } as never);
  return data as unknown as BudgetVersionDetail;
}

export async function createBudgetScenario(
  fetcher: ApiFetcher,
  id: number | string,
  values: { scenario: 'base' | 'best' | 'worst' | 'custom'; label: string; sourceVersionNo?: number },
): Promise<BudgetVersionDetail> {
  const post = fetcher.path(BUDGETS_ROUTES.SCENARIOS).method('post').create();
  const { data } = await post({ id: Number(id), ...values } as never);
  return data as unknown as BudgetVersionDetail;
}

export async function fetchBudgetComparison(
  fetcher: ApiFetcher,
  id: number | string,
  query?: { baseVersionNo?: number; versionNo?: number },
): Promise<BudgetComparison> {
  const get = fetcher.path(BUDGETS_ROUTES.COMPARE).method('get').create();
  const { data } = await get({ id: Number(id), ...(query ?? {}) } as never);
  return data as unknown as BudgetComparison;
}

export async function fetchBudgetAudit(
  fetcher: ApiFetcher,
  id: number | string,
  query?: { page?: number; pageSize?: number },
): Promise<{ data: BudgetAuditEntry[]; pagination: { page: number; pageSize: number; total: number } }> {
  const get = fetcher.path(BUDGETS_ROUTES.AUDIT).method('get').create();
  const { data } = await get({ id: Number(id), ...(query ?? {}) } as never);
  return data as never;
}

// ---------------------------------------------------------------- spending control (Phase 5b)

export type BudgetControlMode = 'off' | 'inform' | 'warn_approve' | 'block';
export type BudgetPeriodBasis = 'month' | 'ytd' | 'year';
export type BudgetControlledType = 'bill' | 'expense' | 'manual_journal';

export interface BudgetControlPolicy {
  budgetId: number | null;
  mode: BudgetControlMode;
  thresholds: number[];
  periodBasis: BudgetPeriodBasis;
  transactionTypes: BudgetControlledType[];
}

export interface BudgetOverride {
  id: number;
  budgetId: number;
  budgetReference: string | null;
  budgetName: string | null;
  versionId: number;
  lineId: number;
  accountId: number;
  referenceType: BudgetControlledType;
  referenceId: number;
  periodFrom: string;
  periodTo: string;
  amount: number;
  reason: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  requestedBy: number | null;
  decidedBy: number | null;
  decidedAt: string | null;
  comment: string | null;
  createdAt: string;
}

export interface BudgetDraftDocument {
  type: BudgetControlledType;
  id: number;
  number: string | null;
  date: string;
  amount: number;
  contact: string | null;
}

export interface BudgetAlert {
  id: number;
  budgetId: number;
  lineId: number;
  accountId: number;
  referenceType: BudgetControlledType;
  referenceId: number;
  periodFrom: string;
  periodTo: string;
  budget: number;
  usedBefore: number;
  document: number;
  percentAfter: number | null;
  level: 'info' | 'warning' | 'exceeded';
  mode: BudgetControlMode;
  outcome: 'allowed' | 'override';
  createdBy: number | null;
  createdAt: string;
}

export interface BudgetAvailability {
  budgetId: number;
  versionNo: number;
  periodBasis: BudgetPeriodBasis;
  periodFrom: string;
  periodTo: string;
  policy: { mode: BudgetControlMode; thresholds: number[]; periodBasis: BudgetPeriodBasis } | null;
  lines: Array<{
    lineId: number;
    accountId: number;
    account: { id: number; code: string | null; name: string };
    branchId: number | null;
    projectId: number | null;
    budget: number;
    actual: number;
    commitments: number;
    available: number;
    usedPercent: number | null;
  }>;
  totals: { budget: number; actual: number; commitments: number; available: number };
}

export async function fetchBudgetPolicies(fetcher: ApiFetcher): Promise<{ default: BudgetControlPolicy | null; budgets: BudgetControlPolicy[] }> {
  const get = fetcher.path(BUDGETS_ROUTES.POLICIES).method('get').create();
  const { data } = await get({} as never);
  return data as never;
}

export async function saveBudgetPolicy(fetcher: ApiFetcher, values: Partial<BudgetControlPolicy> & { mode: BudgetControlMode }): Promise<BudgetControlPolicy> {
  const put = fetcher.path(BUDGETS_ROUTES.POLICIES).method('put').create();
  const { data } = await put(values as never);
  return data as unknown as BudgetControlPolicy;
}

export async function deleteBudgetPolicy(fetcher: ApiFetcher, budgetId: number | null): Promise<void> {
  const del = fetcher.path(BUDGETS_ROUTES.POLICIES).method('delete').create();
  await del((budgetId ? { budgetId: String(budgetId) } : {}) as never);
}

export async function fetchBudgetOverrides(
  fetcher: ApiFetcher,
  query?: { status?: string; referenceType?: BudgetControlledType; referenceId?: number },
): Promise<{ data: BudgetOverride[] }> {
  const get = fetcher.path(BUDGETS_ROUTES.OVERRIDES).method('get').create();
  const { data } = await get((query ?? {}) as never);
  return data as never;
}

export async function fetchBudgetOverrideDrafts(fetcher: ApiFetcher): Promise<{ data: BudgetDraftDocument[] }> {
  const get = fetcher.path(BUDGETS_ROUTES.OVERRIDE_DRAFTS).method('get').create();
  const { data } = await get({} as never);
  return data as never;
}

export async function requestBudgetOverride(
  fetcher: ApiFetcher,
  values: { referenceType: BudgetControlledType; referenceId: number; reason: string },
): Promise<{ overrides: BudgetOverride[] }> {
  const post = fetcher.path(BUDGETS_ROUTES.OVERRIDES).method('post').create();
  const { data } = await post(values as never);
  return data as never;
}

export async function decideBudgetOverride(
  fetcher: ApiFetcher,
  id: number,
  decision: 'approve' | 'reject',
  comment?: string,
): Promise<BudgetOverride> {
  const post = fetcher.path(decision === 'approve' ? BUDGETS_ROUTES.OVERRIDE_APPROVE : BUDGETS_ROUTES.OVERRIDE_REJECT).method('post').create();
  const { data } = await post({ id, comment } as never);
  return data as unknown as BudgetOverride;
}

export async function fetchBudgetAlerts(
  fetcher: ApiFetcher,
  query?: { budgetId?: number; level?: string; page?: number; pageSize?: number },
): Promise<{ data: BudgetAlert[]; pagination: { page: number; pageSize: number; total: number } }> {
  const get = fetcher.path(BUDGETS_ROUTES.ALERTS).method('get').create();
  const { data } = await get((query ?? {}) as never);
  return data as never;
}

export async function fetchBudgetAvailability(
  fetcher: ApiFetcher,
  id: number | string,
  query?: { month?: string; basis?: BudgetPeriodBasis },
): Promise<BudgetAvailability> {
  const get = fetcher.path(BUDGETS_ROUTES.AVAILABILITY).method('get').create();
  const { data } = await get({ id: Number(id), ...(query ?? {}) } as never);
  return data as unknown as BudgetAvailability;
}

// ---------------------------------------------------------------- forecasts, dashboard, notifications (Phase 6)

export interface BudgetForecastFigures {
  budget: number;
  actualToDate: number;
  forecastRemaining: number;
  projected: number;
  variance: number;
  variancePercent: number | null;
  favorable: boolean;
}

export interface BudgetForecastMonth {
  month: string;
  budget: number;
  /** null after the as-of month. */
  actual: number | null;
  forecast: number;
}

export interface BudgetForecastVsBudget {
  budget: Budget;
  baseVersion: BudgetVersion;
  forecastVersion: BudgetVersion;
  asOfMonth: string | null;
  months: string[];
  rows: Array<
    BudgetForecastFigures & {
      account: { id: number; code: string | null; name: string; accountType: string; rootType: string; normal: string };
      branchId: number | null;
      projectId: number | null;
      unbudgeted: boolean;
      months: BudgetForecastMonth[];
    }
  >;
  groups: Array<BudgetForecastFigures & { rootType: string; months: BudgetForecastMonth[] }>;
  netIncome: (BudgetForecastFigures & { months: BudgetForecastMonth[] }) | null;
}

export interface BudgetRollingTotals {
  history: Array<{ month: string; actual: number }>;
  months: Array<{ month: string; forecast: number; budget: number | null }>;
  forecastTotal: number;
}

export interface BudgetRollingForecast {
  budget: Budget;
  version: BudgetVersion;
  asOfMonth: string;
  method: Exclude<BudgetForecastMethod, 'budget'>;
  runRateMonths: number;
  growthPercent: number;
  historyMonths: string[];
  months: string[];
  rows: Array<
    BudgetRollingTotals & {
      account: { id: number; code: string | null; name: string; accountType: string; rootType: string; normal: string };
      branchId: number | null;
      projectId: number | null;
      unbudgeted: boolean;
      direction: 'income' | 'spend';
    }
  >;
  groups: Array<BudgetRollingTotals & { rootType: string }>;
  netIncome: BudgetRollingTotals | null;
}

export interface BudgetDashboard {
  budgets: Array<{ id: number; reference: string; name: string; type: BudgetType; fiscalYear: number; hasActiveVersion: boolean }>;
  budget: Budget | null;
  version?: BudgetVersion;
  activeVersion?: boolean;
  approved?: boolean;
  currencyCode?: string;
  asOfMonth?: string | null;
  months?: string[];
  kpis?: {
    revenue: { annualBudget: number; ytdBudget: number; ytdActual: number; achievementPercent: number | null } | null;
    expenses: {
      annualBudget: number;
      ytdBudget: number;
      ytdActual: number;
      utilizationPercent: number | null;
      annualUsedPercent: number | null;
      remaining: number;
    } | null;
    netIncome: { annualBudget: number; ytdBudget: number; ytdActual: number; ytdVariance: number } | null;
    groups: Array<{ rootType: string; annualBudget: number; ytd: BudgetReportFigures | null }>;
    cashPosition: BudgetCashPosition | null;
    lines: { budgeted: number; over: number; near: number; unbudgeted: number; exceptions: number };
  };
  monthly?: Array<{
    month: string;
    label: string;
    groups: Record<string, { budget: number; actual: number | null }>;
    netIncome: { budget: number; actual: number | null } | null;
    cumulative: { budget: number; actual: number | null };
  }>;
  topExceptions?: Array<{
    account: BudgetReportRow['account'];
    branch: { id: number; name: string } | null;
    project: { id: number; name: string } | null;
    unbudgeted: boolean;
    budget: number;
    actual: number;
    variance: number;
    variancePercent: number | null;
  }>;
  projection?: {
    forecastVersionNo: number;
    asOfMonth: string | null;
    method: BudgetForecastMethod | null;
    groups: Array<{ rootType: string; budget: number; projected: number; variance: number; variancePercent: number | null; favorable: boolean }>;
    netIncome: { budget: number; projected: number; variance: number; variancePercent: number | null; favorable: boolean } | null;
  } | null;
  workflow: { waitingForMe: number; pendingOverrides: number; alertsLast30Days: number; unreadNotifications: number };
}

export interface BudgetNotificationItem {
  id: number;
  kind: string;
  budgetId: number | null;
  subject: string;
  body: string;
  link: string | null;
  emailStatus: 'pending' | 'sending' | 'sent' | 'failed' | 'skipped';
  readAt: string | null;
  createdAt: string;
}

export interface BudgetNotificationSettings {
  email: boolean;
  alertLevel: 'off' | 'exceeded' | 'warning';
}

export interface BudgetForecastInput {
  method?: BudgetForecastMethod;
  asOfMonth?: string;
  runRateMonths?: number;
  growthPercent?: number;
}

export async function createBudgetForecast(
  fetcher: ApiFetcher,
  id: number | string,
  values: BudgetForecastInput & { label?: string; baseVersionNo?: number },
): Promise<{ versionNo: number; version: BudgetVersionDetail }> {
  const post = fetcher.path(BUDGETS_ROUTES.FORECASTS).method('post').create();
  const { data } = await post({ id: Number(id), ...values } as never);
  return data as never;
}

export async function refreshBudgetForecast(
  fetcher: ApiFetcher,
  v: VersionRef,
  values: BudgetForecastInput & { lockVersion: number },
): Promise<BudgetVersionDetail> {
  const post = fetcher.path(BUDGETS_ROUTES.FORECAST_REFRESH).method('post').create();
  const { data } = await post({ ...ref(v), ...values } as never);
  return data as unknown as BudgetVersionDetail;
}

export async function fetchBudgetForecastVsBudget(
  fetcher: ApiFetcher,
  id: number | string,
  query?: { forecastVersionNo?: number; baseVersionNo?: number },
): Promise<BudgetForecastVsBudget> {
  const get = fetcher.path(BUDGETS_ROUTES.FORECAST_VS_BUDGET).method('get').create();
  const { data } = await get({ id: Number(id), ...(query ?? {}) } as never);
  return data as unknown as BudgetForecastVsBudget;
}

export async function fetchBudgetRollingForecast(
  fetcher: ApiFetcher,
  id: number | string,
  query?: { asOfMonth?: string; method?: 'run_rate' | 'growth' | 'seasonal'; months?: number; runRateMonths?: number; growthPercent?: number },
): Promise<BudgetRollingForecast> {
  const get = fetcher.path(BUDGETS_ROUTES.ROLLING_FORECAST).method('get').create();
  const { data } = await get({ id: Number(id), ...(query ?? {}) } as never);
  return data as unknown as BudgetRollingForecast;
}

export async function fetchBudgetDashboard(fetcher: ApiFetcher, query?: { budgetId?: number; asOfMonth?: string }): Promise<BudgetDashboard> {
  const get = fetcher.path(BUDGETS_ROUTES.DASHBOARD).method('get').create();
  const { data } = await get((query ?? {}) as never);
  return data as unknown as BudgetDashboard;
}

export async function fetchBudgetNotifications(
  fetcher: ApiFetcher,
  query?: { unread?: boolean; page?: number; pageSize?: number },
): Promise<{ data: BudgetNotificationItem[]; unread: number; pagination: { page: number; pageSize: number; total: number } }> {
  const get = fetcher.path(BUDGETS_ROUTES.NOTIFICATIONS).method('get').create();
  const { data } = await get((query ?? {}) as never);
  return data as never;
}

export async function markBudgetNotificationsRead(fetcher: ApiFetcher, ids?: number[]): Promise<{ updated: number }> {
  const post = fetcher.path(BUDGETS_ROUTES.NOTIFICATIONS_READ).method('post').create();
  const { data } = await post((ids ? { ids } : {}) as never);
  return data as never;
}

export async function fetchBudgetNotificationSettings(fetcher: ApiFetcher): Promise<BudgetNotificationSettings> {
  const get = fetcher.path(BUDGETS_ROUTES.NOTIFICATION_SETTINGS).method('get').create();
  const { data } = await get({} as never);
  return data as unknown as BudgetNotificationSettings;
}

export async function saveBudgetNotificationSettings(fetcher: ApiFetcher, values: BudgetNotificationSettings): Promise<BudgetNotificationSettings> {
  const put = fetcher.path(BUDGETS_ROUTES.NOTIFICATION_SETTINGS).method('put').create();
  const { data } = await put(values as never);
  return data as unknown as BudgetNotificationSettings;
}
