/**
 * Spending control figures (design §6, §13). Pure functions on milli-units.
 */
import { Milli } from './budget-calc';

export type PeriodBasis = 'month' | 'ytd' | 'year';
export type ControlMode = 'off' | 'inform' | 'warn_approve' | 'block';
export type ControlLevel = 'none' | 'info' | 'warning' | 'exceeded';
export type ControlledType = 'bill' | 'expense' | 'manual_journal';

export const PERIOD_BASES: PeriodBasis[] = ['month', 'ytd', 'year'];
export const CONTROL_MODES: ControlMode[] = ['off', 'inform', 'warn_approve', 'block'];
export const CONTROLLED_TYPES: ControlledType[] = ['bill', 'expense', 'manual_journal'];
export const DEFAULT_THRESHOLDS = [75, 90];

/** Ledger `reference_type` of each controlled document. */
export const LEDGER_REFERENCE: Record<ControlledType, string> = {
  bill: 'Bill',
  expense: 'Expense',
  manual_journal: 'Journal',
};

/** Months the check covers for a document dated in `month` ("YYYY-MM-01"). */
export function controlMonths(basis: PeriodBasis, month: string, budgetMonths: string[]): string[] {
  const index = budgetMonths.indexOf(month);
  if (index < 0) return [];
  if (basis === 'month') return [month];
  if (basis === 'ytd') return budgetMonths.slice(0, index + 1);
  return [...budgetMonths];
}

export interface ControlFigures {
  budget: Milli;
  /** Actuals plus open commitments, without this document. */
  usedBefore: Milli;
  /** This document's amount on the line in the period. */
  document: Milli;
}

export interface ControlResult extends ControlFigures {
  usedAfter: Milli;
  /** Budget − used before this document (may be negative). */
  available: Milli;
  /** Used after as a % of budget, 2 decimals; null when the budget is 0. */
  percentAfter: number | null;
  level: ControlLevel;
  /** How much the document goes over the budget (0 when within). */
  excess: Milli;
}

/**
 * Level after the document: `exceeded` above the budget (any spend on a zero
 * budget exceeds it), `warning` at or above the highest threshold, `info` at or
 * above any lower threshold, else `none`.
 */
export function evaluate(f: ControlFigures, thresholds: number[] = DEFAULT_THRESHOLDS): ControlResult {
  const usedAfter = f.usedBefore + f.document;
  const excess = Math.max(0, usedAfter - Math.max(f.budget, 0));
  const percentAfter = f.budget > 0 ? Math.round((usedAfter / f.budget) * 10_000) / 100 : null;
  const sorted = [...thresholds].sort((a, b) => a - b);
  let level: ControlLevel = 'none';
  if (f.document <= 0) level = 'none';
  else if (excess > 0) level = 'exceeded';
  else if (percentAfter !== null && sorted.length && percentAfter >= sorted[sorted.length - 1]) level = 'warning';
  else if (percentAfter !== null && sorted.some((t) => percentAfter >= t)) level = 'info';
  return { ...f, usedAfter, available: f.budget - f.usedBefore, percentAfter, level, excess: f.document > 0 ? Math.min(excess, f.document) : 0 };
}

/** 1–5 distinct thresholds between 1 and 100, ascending. */
export function normalizeThresholds(values: number[] | undefined): number[] {
  const list = [...new Set((values ?? DEFAULT_THRESHOLDS).map((v) => Math.round(v * 100) / 100))].sort((a, b) => a - b);
  if (list.length > 5 || list.some((v) => !(v >= 1 && v <= 100))) {
    throw new RangeError('Thresholds are 1 to 5 percentages between 1 and 100.');
  }
  return list;
}

export interface LedgerLeg {
  accountId: number;
  branchId: number | null;
  projectId: number | null;
  /** "YYYY-MM-01" */
  month: string;
  debit: Milli;
  credit: Milli;
}

/** Spend on the account's natural side; CAPEX counts additions (debits) only. */
export const spendOf = (leg: Pick<LedgerLeg, 'debit' | 'credit'>, accountNormal: string, capex: boolean): Milli =>
  capex ? leg.debit : accountNormal === 'credit' ? leg.credit - leg.debit : leg.debit - leg.credit;
