/**
 * Budget arithmetic (DiTech). Pure functions, no database.
 *
 * Amounts are handled as integer thousandths ("milli"), the ledger's precision
 * (decimal(13,3)), so sums are exact. Allocations round each month to the
 * currency's precision and put the remainder on the last month, so the months
 * always add up to the amount being allocated.
 */

export type Milli = number;

const MAX_ABS_MILLI = 9_999_999_999_999; // decimal(13,3): 10 integer digits

export class BudgetCalcError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Parses "1234.5", 1234.5 or "-0.125" into thousandths; refuses more decimals than allowed. */
export function toMilli(value: number | string, maxDecimals = 3): Milli {
  const text = typeof value === 'number' ? numberToPlain(value) : String(value).trim();
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) throw new BudgetCalcError('INVALID_AMOUNT', `Not a number: ${value}`);
  const [, sign, whole, frac = ''] = m;
  const trimmed = frac.replace(/0+$/, '');
  if (trimmed.length > maxDecimals) {
    throw new BudgetCalcError('TOO_MANY_DECIMALS', `At most ${maxDecimals} decimals: ${value}`);
  }
  const milli = Number(whole) * 1000 + Number(trimmed.padEnd(3, '0') || '0');
  if (milli > MAX_ABS_MILLI) throw new BudgetCalcError('AMOUNT_TOO_LARGE', `Amount too large: ${value}`);
  return sign && milli !== 0 ? -milli : milli;
}

export function fromMilli(milli: Milli): number {
  return milli / 1000;
}

function numberToPlain(n: number): string {
  if (!Number.isFinite(n)) throw new BudgetCalcError('INVALID_AMOUNT', `Not a number: ${n}`);
  // Up to 3 decimals survive exactly; more would be refused by the caller anyway.
  return Number.isInteger(n) ? String(n) : n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

/** Smallest step for a currency with `decimals` digits, in thousandths (2 -> 10). */
export const unitFor = (decimals: number): Milli => 10 ** (3 - Math.min(Math.max(decimals, 0), 3));

/** Rounds half away from zero to a multiple of `unit`. */
export function roundTo(milli: number, unit: Milli): Milli {
  const sign = milli < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(milli) / unit) * unit || 0;
}

// ---------------------------------------------------------------- periods

/** First day of each month from `start` to `end` (inclusive), as YYYY-MM-01. */
export function periodMonths(start: string, end: string): string[] {
  const [sy, sm] = start.split('-').map(Number);
  const [ey, em] = end.split('-').map(Number);
  const months: string[] = [];
  for (let y = sy, m = sm; y < ey || (y === ey && m <= em); m === 12 ? ((m = 1), y++) : m++) {
    months.push(`${y}-${String(m).padStart(2, '0')}-01`);
  }
  return months;
}

/** Budget period of a fiscal year: 12 months from the fiscal start month. */
export function fiscalYearPeriod(fiscalYear: number, startMonth: number): { startDate: string; endDate: string } {
  const startDate = `${fiscalYear}-${String(startMonth).padStart(2, '0')}-01`;
  const endYear = startMonth === 1 ? fiscalYear : fiscalYear + 1;
  const endMonth = startMonth === 1 ? 12 : startMonth - 1;
  const lastDay = new Date(Date.UTC(endYear, endMonth, 0)).getUTCDate();
  return { startDate, endDate: `${endYear}-${String(endMonth).padStart(2, '0')}-${lastDay}` };
}

export const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

export interface PeriodTotals {
  months: Record<string, Milli>;
  /** Fiscal quarters: Q1 = the budget's first three months. */
  quarters: Milli[];
  total: Milli;
}

/**
 * Monthly, quarterly and total figures; months without an amount count as 0.
 * With `closing` (balance sheet budgets, design §15) amounts are month-end
 * balances, so a quarter and the total are their last month, not a sum.
 */
export function periodTotals(amounts: Record<string, Milli>, months: string[], closing = false): PeriodTotals {
  const byMonth: Record<string, Milli> = {};
  const quarters: Milli[] = [];
  let total = 0;
  months.forEach((month, i) => {
    const v = amounts[month] ?? 0;
    const q = Math.floor(i / 3);
    byMonth[month] = v;
    quarters[q] = closing ? v : (quarters[q] ?? 0) + v;
    total = closing ? v : total + v;
  });
  return { months: byMonth, quarters, total };
}

/** Adds several PeriodTotals (for group and grand totals). */
export function sumTotals(list: PeriodTotals[], months: string[], closing = false): PeriodTotals {
  const amounts: Record<string, Milli> = {};
  for (const t of list) for (const m of months) amounts[m] = (amounts[m] ?? 0) + (t.months[m] ?? 0);
  return periodTotals(amounts, months, closing);
}

// ---------------------------------------------------------------- allocation

/**
 * Splits `amount` by `weights` (any non-negative numbers, not all zero).
 * Every month but the last is rounded to `unit`; the last takes the remainder.
 */
export function allocateByWeights(amount: Milli, weights: number[], unit: Milli): Milli[] {
  if (weights.length === 0) throw new BudgetCalcError('NO_PERIODS', 'Nothing to allocate to.');
  if (weights.some((w) => !Number.isFinite(w) || w < 0)) {
    throw new BudgetCalcError('INVALID_WEIGHTS', 'Weights must be zero or more.');
  }
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) throw new BudgetCalcError('INVALID_WEIGHTS', 'At least one weight must be above zero.');

  // The remainder goes to the last month that has a weight, so zero-weight months stay zero.
  const lastWeighted = weights.reduce((last, w, i) => (w > 0 ? i : last), -1);
  const out = weights.map((w) => roundTo((amount * w) / sum, unit));
  const others = out.reduce((a, v, i) => (i === lastWeighted ? a : a + v), 0);
  out[lastWeighted] = amount - others;
  return out;
}

export const allocateEqual = (amount: Milli, months: number, unit: Milli): Milli[] =>
  allocateByWeights(amount, Array(months).fill(1), unit);

/** Percentages must add up to 100 (to 4 decimals). */
export function allocateByPercentages(amount: Milli, percentages: number[], unit: Milli): Milli[] {
  const sum = percentages.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 100) > 0.0001) {
    throw new BudgetCalcError('PERCENTAGES_NOT_100', `Percentages add up to ${Number(sum.toFixed(4))}, not 100.`);
  }
  return allocateByWeights(amount, percentages, unit);
}

/** Each month = base month × (1 + growth%), rounded to `unit`. */
export function applyGrowth(base: Milli[], growthPercent: number, unit: Milli): Milli[] {
  if (!Number.isFinite(growthPercent) || growthPercent < -100) {
    throw new BudgetCalcError('INVALID_GROWTH', 'Growth must be -100% or more.');
  }
  return base.map((v) => roundTo(v * (1 + growthPercent / 100), unit));
}
