/**
 * Budget vs actual arithmetic (DiTech Phase 4, design §5). Pure functions.
 * Amounts are integer thousandths (see budget-calc.ts); percentages are
 * rounded to 2 decimals and are null when they have no meaning (budget 0).
 */
import { Milli } from './budget-calc';

/** Which way a variance is good: income above budget, spending below it. */
export type Direction = 'income' | 'spend';

export interface VarianceFigures {
  budget: Milli;
  actual: Milli;
  /** actual − budget */
  variance: Milli;
  /** (actual − budget) / |budget| × 100; null when the budget is 0. */
  variancePercent: number | null;
  /** actual / budget × 100 (achievement for income, utilization for spend); null when the budget is 0. */
  usedPercent: number | null;
  favorable: boolean;
  /** Actual activity with no budget at all. */
  unbudgeted: boolean;
}

const pct = (n: number) => Math.round(n * 100) / 100 || 0;

export function variance(budget: Milli, actual: Milli, direction: Direction): VarianceFigures {
  const diff = actual - budget;
  return {
    budget,
    actual,
    variance: diff,
    variancePercent: budget === 0 ? null : pct((diff / Math.abs(budget)) * 100),
    usedPercent: budget === 0 ? null : pct((actual / budget) * 100),
    // Exactly on budget is favorable both ways.
    favorable: direction === 'income' ? diff >= 0 : diff <= 0,
    unbudgeted: budget === 0 && actual !== 0,
  };
}

export type UtilizationStatus = 'unbudgeted' | 'over' | 'near' | 'on_track' | 'no_activity';

/** Spending status: over 100 %, near from `nearPercent` (default 90 %), otherwise on track. */
export function utilizationStatus(f: VarianceFigures, nearPercent = 90): UtilizationStatus {
  if (f.unbudgeted) return 'unbudgeted';
  if (f.budget === 0 && f.actual === 0) return 'no_activity';
  if (f.usedPercent === null) return 'on_track';
  if (f.budget > 0 && f.actual > f.budget) return 'over';
  if (f.usedPercent >= nearPercent) return 'near';
  return 'on_track';
}

/**
 * An exception: actual spend with no budget, or an unfavorable variance of at
 * least `thresholdPercent` of the budget.
 */
export function isException(f: VarianceFigures, thresholdPercent: number): boolean {
  if (f.unbudgeted) return true;
  if (f.favorable || f.variancePercent === null) return false;
  return Math.abs(f.variancePercent) >= thresholdPercent;
}

// ---------------------------------------------------------------- matching

export interface LineKey {
  id: number;
  accountId: number;
  branchId: number | null;
  projectId: number | null;
}

/**
 * Finds the budget line a ledger amount belongs to: the most specific line of
 * the account whose branch and project match (an empty branch or project on the
 * line matches any). Branch and project together beat branch only, which beats
 * project only, which beats neither. Returns null when no line matches, so the
 * amount is reported as unbudgeted and never counted twice.
 */
export function matchLine<T extends LineKey>(
  lines: T[],
  accountId: number,
  branchId: number | null,
  projectId: number | null,
): T | null {
  let best: T | null = null;
  let bestScore = -1;
  for (const line of lines) {
    if (line.accountId !== accountId) continue;
    if (line.branchId !== null && line.branchId !== branchId) continue;
    if (line.projectId !== null && line.projectId !== projectId) continue;
    const score = (line.branchId !== null ? 2 : 0) + (line.projectId !== null ? 1 : 0);
    if (score > bestScore) {
      best = line;
      bestScore = score;
    }
  }
  return best;
}
