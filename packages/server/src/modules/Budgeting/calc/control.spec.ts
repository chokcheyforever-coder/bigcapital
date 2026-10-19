import { controlMonths, evaluate, normalizeThresholds, spendOf } from './control';

const months = ['2032-01-01', '2032-02-01', '2032-03-01', '2032-04-01'];

describe('controlMonths', () => {
  it('month, year to date, whole budget', () => {
    expect(controlMonths('month', '2032-03-01', months)).toEqual(['2032-03-01']);
    expect(controlMonths('ytd', '2032-03-01', months)).toEqual(['2032-01-01', '2032-02-01', '2032-03-01']);
    expect(controlMonths('year', '2032-01-01', months)).toEqual(months);
  });

  it('a date outside the budget is not controlled', () => {
    expect(controlMonths('year', '2033-01-01', months)).toEqual([]);
  });
});

describe('evaluate', () => {
  it('within budget below the thresholds', () => {
    expect(evaluate({ budget: 100_000, usedBefore: 10_000, document: 20_000 }, [75, 90])).toEqual({
      budget: 100_000,
      usedBefore: 10_000,
      document: 20_000,
      usedAfter: 30_000,
      available: 90_000,
      percentAfter: 30,
      level: 'none',
      excess: 0,
    });
  });

  it('info at a lower threshold, warning at the highest', () => {
    expect(evaluate({ budget: 100_000, usedBefore: 70_000, document: 5_000 }, [75, 90]).level).toBe('info');
    expect(evaluate({ budget: 100_000, usedBefore: 70_000, document: 20_000 }, [75, 90]).level).toBe('warning');
  });

  it('spending exactly the budget is allowed; one unit more exceeds', () => {
    expect(evaluate({ budget: 100_000, usedBefore: 0, document: 100_000 }).level).toBe('warning');
    const over = evaluate({ budget: 100_000, usedBefore: 0, document: 100_001 });
    expect([over.level, over.excess]).toEqual(['exceeded', 1]);
  });

  it('the excess is never more than the document', () => {
    const r = evaluate({ budget: 100_000, usedBefore: 150_000, document: 10_000 });
    expect([r.level, r.excess, r.available]).toEqual(['exceeded', 10_000, -50_000]);
  });

  it('any spend on a zero budget exceeds it; percent is n/a', () => {
    const r = evaluate({ budget: 0, usedBefore: 0, document: 1_000 });
    expect([r.level, r.excess, r.percentAfter]).toEqual(['exceeded', 1_000, null]);
  });

  it('a document that lowers spending never exceeds', () => {
    const r = evaluate({ budget: 100_000, usedBefore: 150_000, document: -10_000 });
    expect([r.level, r.excess]).toEqual(['none', 0]);
  });
});

describe('thresholds and spend', () => {
  it('normalizes thresholds', () => {
    expect(normalizeThresholds([90, 75, 90])).toEqual([75, 90]);
    expect(normalizeThresholds(undefined)).toEqual([75, 90]);
    expect(() => normalizeThresholds([0])).toThrow(RangeError);
    expect(() => normalizeThresholds([101])).toThrow(RangeError);
    expect(() => normalizeThresholds([10, 20, 30, 40, 50, 60])).toThrow(RangeError);
  });

  it('spend follows the account side; CAPEX counts debits only', () => {
    expect(spendOf({ debit: 500, credit: 100 }, 'debit', false)).toBe(400);
    expect(spendOf({ debit: 100, credit: 500 }, 'credit', false)).toBe(400);
    expect(spendOf({ debit: 500, credit: 100 }, 'debit', true)).toBe(500);
  });
});
