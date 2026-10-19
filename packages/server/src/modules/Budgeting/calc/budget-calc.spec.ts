import {
  allocateByPercentages,
  allocateByWeights,
  allocateEqual,
  applyGrowth,
  BudgetCalcError,
  fiscalYearPeriod,
  periodMonths,
  periodTotals,
  roundTo,
  sumTotals,
  toMilli,
  unitFor,
} from './budget-calc';

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const CENT = unitFor(2); // 10 thousandths

describe('toMilli', () => {
  it('parses numbers and strings exactly', () => {
    expect(toMilli('1234.5')).toBe(1_234_500);
    expect(toMilli(0.1)).toBe(100);
    expect(toMilli(0.1 + 0.2)).toBe(300); // 0.30000000000000004 is still 0.3 to 3 decimals
    expect(toMilli('-0.125')).toBe(-125);
    expect(toMilli('-0')).toBe(0);
    expect(toMilli('10.000')).toBe(10_000);
  });

  it('refuses more decimals than the currency allows, and junk', () => {
    expect(() => toMilli('1.005', 2)).toThrow(BudgetCalcError);
    expect(() => toMilli('1.0001')).toThrow(/At most 3 decimals/);
    expect(() => toMilli('12abc')).toThrow(/Not a number/);
    expect(() => toMilli('')).toThrow(/Not a number/);
    expect(() => toMilli(Number.NaN)).toThrow(/Not a number/);
    expect(() => toMilli('10000000000')).toThrow(/too large/);
  });
});

describe('roundTo', () => {
  it('rounds half away from zero', () => {
    expect(roundTo(83_335, CENT)).toBe(83_340);
    expect(roundTo(-83_335, CENT)).toBe(-83_340);
    expect(roundTo(83_334, CENT)).toBe(83_330);
    expect(Object.is(roundTo(-4, CENT), -0)).toBe(false);
  });
});

describe('periods', () => {
  it('lists the months of a period', () => {
    expect(periodMonths('2026-01-01', '2026-12-31')).toHaveLength(12);
    expect(periodMonths('2026-07-01', '2027-06-30')[0]).toBe('2026-07-01');
    expect(periodMonths('2026-07-01', '2027-06-30')[11]).toBe('2027-06-01');
    expect(periodMonths('2026-11-01', '2027-02-28')).toEqual(['2026-11-01', '2026-12-01', '2027-01-01', '2027-02-01']);
  });

  it('derives the fiscal year from its start month', () => {
    expect(fiscalYearPeriod(2026, 1)).toEqual({ startDate: '2026-01-01', endDate: '2026-12-31' });
    expect(fiscalYearPeriod(2026, 7)).toEqual({ startDate: '2026-07-01', endDate: '2027-06-30' });
    expect(fiscalYearPeriod(2027, 3)).toEqual({ startDate: '2027-03-01', endDate: '2028-02-29' });
  });

  it('totals months into fiscal quarters and the year', () => {
    const months = periodMonths('2026-07-01', '2027-06-30');
    const amounts = Object.fromEntries(months.map((m, i) => [m, (i + 1) * 1000]));
    const t = periodTotals(amounts, months);
    expect(t.quarters).toEqual([6000, 15000, 24000, 33000]);
    expect(t.total).toBe(78_000);
    expect(t.months['2026-07-01']).toBe(1000);
  });

  it('counts missing months as zero and adds totals', () => {
    const months = periodMonths('2026-01-01', '2026-12-31');
    const a = periodTotals({ '2026-01-01': 500, '2026-12-01': -200 }, months);
    expect(a.quarters).toEqual([500, 0, 0, -200]);
    const b = periodTotals({ '2026-01-01': 250 }, months);
    expect(sumTotals([a, b], months)).toMatchObject({ total: 550, quarters: [750, 0, 0, -200] });
  });

  it('balance sheet amounts: a quarter and the year show their last month (design §15)', () => {
    const months = periodMonths('2026-07-01', '2027-06-30');
    const amounts = Object.fromEntries(months.map((m, i) => [m, (i + 1) * 1000]));
    const t = periodTotals(amounts, months, true);
    expect(t.quarters).toEqual([3000, 6000, 9000, 12000]);
    expect(t.total).toBe(12_000);
    expect(sumTotals([t, t], months, true)).toMatchObject({ total: 24_000, quarters: [6000, 12000, 18000, 24000] });
  });
});

describe('allocation', () => {
  it('equal: 1,000.00 over 12 months adds up exactly', () => {
    const out = allocateEqual(toMilli('1000'), 12, CENT);
    expect(out.slice(0, 11).every((v) => v === 83_330)).toBe(true);
    expect(out[11]).toBe(83_370);
    expect(sum(out)).toBe(1_000_000);
  });

  it('equal: negative and zero amounts', () => {
    const neg = allocateEqual(toMilli('-100'), 3, CENT);
    expect(neg).toEqual([-33_330, -33_330, -33_340]);
    expect(allocateEqual(0, 12, CENT).every((v) => v === 0)).toBe(true);
  });

  it('percentages must add up to 100', () => {
    const out = allocateByPercentages(toMilli('1200'), [10, 20, 30, 40], CENT);
    expect(out).toEqual([120_000, 240_000, 360_000, 480_000]);
    expect(() => allocateByPercentages(1000, [50, 49], CENT)).toThrow(/not 100/);
  });

  it('seasonal weights keep zero months at zero and still add up', () => {
    const weights = [0, 1, 1, 1, 0, 0, 2, 2, 2, 0, 0, 3];
    const out = allocateByWeights(toMilli('1000'), weights, CENT);
    expect(out[0]).toBe(0);
    expect(out[4]).toBe(0);
    expect(out[10]).toBe(0);
    expect(sum(out)).toBe(1_000_000);
  });

  it('refuses bad weights', () => {
    expect(() => allocateByWeights(1000, [0, 0], CENT)).toThrow(/above zero/);
    expect(() => allocateByWeights(1000, [1, -1], CENT)).toThrow(/zero or more/);
    expect(() => allocateByWeights(1000, [], CENT)).toThrow(/Nothing to allocate/);
  });

  it('whole-currency rounding (precision 0)', () => {
    const out = allocateEqual(toMilli('100'), 3, unitFor(0));
    expect(out).toEqual([33_000, 33_000, 34_000]);
  });

  it('growth applies to each month and rounds to the currency', () => {
    expect(applyGrowth([100_000, 33_330], 10, CENT)).toEqual([110_000, 36_660]);
    expect(applyGrowth([100_000], -100, CENT)).toEqual([0]);
    expect(() => applyGrowth([1], -101, CENT)).toThrow(/-100%/);
  });
});
