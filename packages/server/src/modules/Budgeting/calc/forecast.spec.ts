import { addMonths, forecastLine, ForecastInput, projection, rollingMonths, runRate } from './forecast';
import { periodMonths } from './budget-calc';

/**
 * The fixture of design §15: 2027 budget of 110 a month; 2026 actuals of 100 a
 * month except December 200; 2027 actuals Jan 120, Feb 90, Mar 150; as of March.
 * Amounts in thousandths, 2-decimal currency (unit 10).
 */
const months = periodMonths('2027-01-01', '2027-12-31');
const actuals: Record<string, number> = {};
for (const m of periodMonths('2026-01-01', '2026-12-31')) actuals[m] = 100_000;
actuals['2026-12-01'] = 200_000;
Object.assign(actuals, { '2027-01-01': 120_000, '2027-02-01': 90_000, '2027-03-01': 150_000 });
const budget = Object.fromEntries(months.map((m) => [m, 110_000]));
const base: ForecastInput = { months, asOf: '2027-03-01', actuals, budget, method: 'budget', unit: 10 };
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const ACTUAL_Q1 = [120_000, 90_000, 150_000];

describe('forecast fixture (design §15)', () => {
  it('budget remainder: actuals to March, then the budget', () => {
    const f = forecastLine(base);
    expect(f).toEqual([...ACTUAL_Q1, ...Array(9).fill(110_000)]);
    expect(sum(f)).toBe(1_350_000);
  });

  it('run rate: the average of the last 3 actual months, every remaining month', () => {
    const f = forecastLine({ ...base, method: 'run_rate' });
    expect(f).toEqual([...ACTUAL_Q1, ...Array(9).fill(120_000)]);
    expect(sum(f)).toBe(1_440_000);
  });

  it('growth: the same month last year + 10 %', () => {
    const f = forecastLine({ ...base, method: 'growth', growthPercent: 10 });
    expect(f).toEqual([...ACTUAL_Q1, ...Array(8).fill(110_000), 220_000]);
    expect(sum(f)).toBe(1_460_000);
  });

  it('seasonal: run rate × 9 months spread like last year (December double)', () => {
    const f = forecastLine({ ...base, method: 'seasonal' });
    expect(f).toEqual([...ACTUAL_Q1, ...Array(8).fill(108_000), 216_000]);
    expect(sum(f)).toBe(1_440_000);
  });

  it('projection: actual to date + remaining forecast', () => {
    const f = forecastLine({ ...base, method: 'run_rate' });
    const byMonth = Object.fromEntries(months.map((m, i) => [m, f[i]]));
    expect(projection(months, '2027-03-01', actuals, byMonth)).toEqual({ actualToDate: 360_000, remaining: 1_080_000, projected: 1_440_000 });
  });
});

describe('forecast edge cases', () => {
  it('run rate rounds to the currency unit', () => {
    expect(runRate({ '2027-01-01': 100_000, '2027-02-01': 100_000, '2027-03-01': 101_000 }, '2027-03-01', 3, 10)).toBe(100_330);
  });

  it('months without activity count as zero in the run rate', () => {
    expect(runRate({ '2027-03-01': 90_000 }, '2027-03-01', 3, 10)).toBe(30_000);
  });

  it('before the period: every month is forecast, from the history before it', () => {
    const f = forecastLine({ ...base, asOf: '2026-12-01', method: 'run_rate' });
    // Oct–Dec 2026: 100, 100, 200 → 133.33
    expect(f).toEqual(Array(12).fill(133_330));
  });

  it('without an as-of month, run rate is zero and budget is kept', () => {
    expect(forecastLine({ ...base, asOf: null, method: 'run_rate' })).toEqual(Array(12).fill(0));
    expect(forecastLine({ ...base, asOf: null })).toEqual(Array(12).fill(110_000));
  });

  it('after the period: actuals only', () => {
    const f = forecastLine({ ...base, asOf: '2027-12-01', method: 'run_rate' });
    expect(f.slice(0, 3)).toEqual(ACTUAL_Q1);
    expect(f.slice(3)).toEqual(Array(9).fill(0));
  });

  it('seasonal falls back to an even spread when last year mixes signs', () => {
    const mixed = { ...actuals, '2026-04-01': -50_000 };
    const f = forecastLine({ ...base, actuals: mixed, method: 'seasonal' });
    expect(f.slice(3)).toEqual(Array(9).fill(120_000));
  });

  it('seasonal keeps the exact total when it does not divide evenly', () => {
    const f = forecastLine({ ...base, actuals: { ...actuals, '2027-03-01': 151_000 }, method: 'seasonal' });
    // run rate 120.33 × 9 = 1,082.97 spread 1:…:1:2 → the remainder lands on December.
    expect(sum(f.slice(3))).toBe(1_082_970);
  });

  it('refuses a bad run-rate window or growth', () => {
    expect(() => forecastLine({ ...base, method: 'run_rate', runRateMonths: 0 })).toThrow();
    expect(() => forecastLine({ ...base, method: 'growth', growthPercent: -101 })).toThrow();
  });

  it('month arithmetic across years', () => {
    expect(addMonths('2027-01-01', -1)).toBe('2026-12-01');
    expect(addMonths('2026-12-01', 13)).toBe('2028-01-01');
    expect(rollingMonths('2027-11-01', 3)).toEqual(['2027-12-01', '2028-01-01', '2028-02-01']);
  });
});
