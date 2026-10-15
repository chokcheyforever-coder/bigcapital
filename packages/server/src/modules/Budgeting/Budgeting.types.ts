import { ACCOUNT_TYPE } from '@/constants/accounts';

/** Permissions on the `Budget` subject (design §7; Delete added for draft budgets). */
export enum BudgetAction {
  View = 'View',
  Create = 'Create',
  EditDraft = 'EditDraft',
  Delete = 'Delete',
  Submit = 'Submit',
  Approve = 'Approve',
  Revise = 'Revise',
  Lock = 'Lock',
  ImportExport = 'ImportExport',
  ViewAudit = 'ViewAudit',
  ConfigurePolicy = 'ConfigurePolicy',
}

/**
 * Release 1 types: period movements on accounts, which the ledger gives
 * exactly (design §2). Balance Sheet and Cash Flow come in Phase 6.
 */
export enum BudgetType {
  ProfitLoss = 'profit_loss',
  Revenue = 'revenue',
  OperatingExpenses = 'operating_expenses',
  Operational = 'operational',
  Capex = 'capex',
}

const PL_TYPES = [
  ACCOUNT_TYPE.INCOME,
  ACCOUNT_TYPE.OTHER_INCOME,
  ACCOUNT_TYPE.COST_OF_GOODS_SOLD,
  ACCOUNT_TYPE.EXPENSE,
  ACCOUNT_TYPE.OTHER_EXPENSE,
];

/** Account types a budget type may plan. */
export const BUDGET_TYPE_ACCOUNT_TYPES: Record<BudgetType, string[]> = {
  [BudgetType.ProfitLoss]: PL_TYPES,
  [BudgetType.Operational]: PL_TYPES,
  [BudgetType.Revenue]: [ACCOUNT_TYPE.INCOME, ACCOUNT_TYPE.OTHER_INCOME],
  [BudgetType.OperatingExpenses]: [ACCOUNT_TYPE.EXPENSE, ACCOUNT_TYPE.OTHER_EXPENSE],
  [BudgetType.Capex]: [ACCOUNT_TYPE.FIXED_ASSET, ACCOUNT_TYPE.NON_CURRENT_ASSET],
};

export enum BudgetVersionKind {
  Original = 'original',
  Revision = 'revision',
  Forecast = 'forecast',
  Scenario = 'scenario',
}

export enum BudgetVersionStatus {
  Draft = 'draft',
  Submitted = 'submitted',
  UnderReview = 'under_review',
  Approved = 'approved',
  Locked = 'locked',
  Rejected = 'rejected',
  Cancelled = 'cancelled',
}

/** Only these can be edited; approved and locked versions are immutable (design §7). */
export const EDITABLE_STATUSES: string[] = [BudgetVersionStatus.Draft, BudgetVersionStatus.Rejected];

/** A budget can be deleted while none of its versions got past review. */
export const DELETABLE_STATUSES: string[] = [
  BudgetVersionStatus.Draft,
  BudgetVersionStatus.Rejected,
  BudgetVersionStatus.Cancelled,
];

export const MAX_BUDGET_MONTHS = 24;

export const ERRORS = {
  BUDGET_NOT_FOUND: 'BUDGET_NOT_FOUND',
  VERSION_NOT_FOUND: 'BUDGET_VERSION_NOT_FOUND',
  REFERENCE_EXISTS: 'BUDGET_REFERENCE_EXISTS',
  INVALID_PERIOD: 'BUDGET_INVALID_PERIOD',
  VERSION_NOT_EDITABLE: 'BUDGET_VERSION_NOT_EDITABLE',
  VERSION_CHANGED: 'BUDGET_VERSION_CHANGED',
  BUDGET_NOT_DELETABLE: 'BUDGET_NOT_DELETABLE',
  DUPLICATE_LINE: 'BUDGET_DUPLICATE_LINE',
  LINE_NOT_FOUND: 'BUDGET_LINE_NOT_FOUND',
  ACCOUNT_NOT_FOUND: 'BUDGET_ACCOUNT_NOT_FOUND',
  ACCOUNT_NOT_ALLOWED: 'BUDGET_ACCOUNT_NOT_ALLOWED',
  BRANCH_NOT_FOUND: 'BUDGET_BRANCH_NOT_FOUND',
  PROJECT_NOT_FOUND: 'BUDGET_PROJECT_NOT_FOUND',
  MONTH_OUTSIDE_PERIOD: 'BUDGET_MONTH_OUTSIDE_PERIOD',
  INVALID_AMOUNT: 'BUDGET_INVALID_AMOUNT',
  INVALID_ALLOCATION: 'BUDGET_INVALID_ALLOCATION',
};
