/**
 * Forecast arithmetic (DiTech Phase 6, design §15). Pure functions, no database.
 *
 * A forecast line keeps the posted actuals up to the "as of" month and fills
 * the months after it with one method. Amounts are integer thousandths
 * (budget-calc.ts); `unit` is the currency's smallest step.
 */
import { allocateByWeights, BudgetCalcError, Milli, roundTo } from './budget-calc';

export type ForecastMethod = 'budget' | 'run_rate' | 'growth' | 'seasonal';

export const FORECAST_METHODS: ForecastMethod[] = ['budget', 'run_rate', 'growth', 'seasonal'];

export const DEFAULT_RUN_RATE_MONTHS = 3;

export interface ForecastInput {
  /** Months to forecast, in order (YYYY-MM-01). */
  months: string[];
  /** Last month with actuals; months up to it keep their actuals. null = no actuals yet. */
  asOf: string | null;
  /** Posted actuals by month (YYYY-MM-01), including earlier months used as history. */
  actuals: Record<string, Milli>;
  /** Budget by month, for the `budget` method. */
  budget: Record<string, Milli>;
  method: ForecastMethod;
  /** Months averaged by `run_rate` and `seasonal` (1–12, default 3). */
  runRateMonths?: number;
  /** `growth`: change on the same month of the year before, in percent. */
  growthPercent?: number;
  unit: Milli;
}

/** "2027-01-01" plus `n` months (n may be negative). */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const index = y * 12 + (m - 1) + n;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}-01`;
}

/** The `count` months after `asOf`: a rolling forecast window. */
export function rollingMonths(asOf: string, count = 12): string[] {
  return Array.from({ length: count }, (_, i) => addMonths(asOf, i + 1));
}

/**
 * Average monthly actual over the `n` months ending at `asOf` (months without
 * activity count as 0), rounded to `unit`. 0 when there is no as-of month.
 */
export function runRate(actuals: Record<string, Milli>, asOf: string | null, n: number, unit: Milli): Milli {
  if (!asOf) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += actuals[addMonths(asOf, -i)] ?? 0;
  return roundTo(sum / n, unit);
}

/** Months of `months` that come after `asOf` (all of them when there are no actuals yet). */
export const remainingMonths = (months: string[], asOf: string | null) => months.filter((m) => !asOf || m > asOf);

/**
 * Monthly amounts of one forecast line: actuals up to `asOf`, then
 * - `budget`: the budget of each remaining month;
 * - `run_rate`: the average of the last `runRateMonths` actual months, every month;
 * - `growth`: the same month a year earlier × (1 + growth %);
 * - `seasonal`: the run rate × the number of remaining months, spread like the
 *   same months a year earlier (evenly when those are all zero or mix signs).
 */
export function forecastLine(input: ForecastInput): Milli[] {
  const { months, asOf, actuals, budget, method, unit } = input;
  const n = input.runRateMonths ?? DEFAULT_RUN_RATE_MONTHS;
  if (!Number.isInteger(n) || n < 1 || n > 12) throw new BudgetCalcError('INVALID_RUN_RATE_MONTHS', 'The run rate averages 1 to 12 months.');
  const growth = input.growthPercent ?? 0;
  if (!Number.isFinite(growth) || growth < -100) throw new BudgetCalcError('INVALID_GROWTH', 'Growth must be -100% or more.');
  if (!FORECAST_METHODS.includes(method)) throw new BudgetCalcError('INVALID_METHOD', `Unknown forecast method: ${method}`);

  const ahead = remainingMonths(months, asOf);
  const lastYear = (m: string) => actuals[addMonths(m, -12)] ?? 0;
  let projected: Milli[];
  switch (method) {
    case 'budget':
      projected = ahead.map((m) => budget[m] ?? 0);
      break;
    case 'run_rate': {
      const rate = runRate(actuals, asOf, n, unit);
      projected = ahead.map(() => rate);
      break;
    }
    case 'growth':
      projected = ahead.map((m) => roundTo(lastYear(m) * (1 + growth / 100), unit));
      break;
    case 'seasonal': {
      const total = runRate(actuals, asOf, n, unit) * ahead.length;
      const weights = ahead.map(lastYear);
      const usable = weights.every((w) => w >= 0) && weights.some((w) => w > 0);
      projected = ahead.length === 0 ? [] : allocateByWeights(total, usable ? weights : ahead.map(() => 1), unit);
      break;
    }
  }
  const byMonth = new Map(ahead.map((m, i) => [m, projected[i]]));
  return months.map((m) => (byMonth.has(m) ? byMonth.get(m) : (actuals[m] ?? 0)));
}

export interface Projection {
  /** Actuals of the months up to `asOf`. */
  actualToDate: Milli;
  /** Forecast of the months after `asOf`. */
  remaining: Milli;
  /** actualToDate + remaining (design §5: projected year-end). */
  projected: Milli;
}

export function projection(months: string[], asOf: string | null, actuals: Record<string, Milli>, forecast: Record<string, Milli>): Projection {
  let actualToDate = 0;
  let remaining = 0;
  for (const m of months) {
    if (asOf && m <= asOf) actualToDate += actuals[m] ?? 0;
    else remaining += forecast[m] ?? 0;
  }
  return { actualToDate, remaining, projected: actualToDate + remaining };
}
