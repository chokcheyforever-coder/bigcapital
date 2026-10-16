import { isException, matchLine, utilizationStatus, variance } from './variance';

describe('variance', () => {
  it('income above budget is favorable', () => {
    expect(variance(100_000, 120_000, 'income')).toEqual({
      budget: 100_000,
      actual: 120_000,
      variance: 20_000,
      variancePercent: 20,
      usedPercent: 120,
      favorable: true,
      unbudgeted: false,
    });
  });

  it('spending above budget is unfavorable', () => {
    const f = variance(100_000, 112_500, 'spend');
    expect(f.variance).toBe(12_500);
    expect(f.variancePercent).toBe(12.5);
    expect(f.usedPercent).toBe(112.5);
    expect(f.favorable).toBe(false);
  });

  it('exactly on budget is favorable both ways', () => {
    expect(variance(5_000, 5_000, 'income').favorable).toBe(true);
    expect(variance(5_000, 5_000, 'spend').favorable).toBe(true);
  });

  it('percentages are n/a (null) when the budget is 0, never 0 or infinity', () => {
    const f = variance(0, 3_000, 'spend');
    expect(f.variancePercent).toBeNull();
    expect(f.usedPercent).toBeNull();
    expect(f.unbudgeted).toBe(true);
    expect(variance(0, 0, 'spend')).toMatchObject({ variancePercent: null, unbudgeted: false, favorable: true });
  });

  it('a negative budget uses |budget| for the variance %, and keeps the sign', () => {
    const f = variance(-10_000, -5_000, 'income');
    expect(f.variance).toBe(5_000);
    expect(f.variancePercent).toBe(50);
    expect(f.favorable).toBe(true);
  });

  it('rounds percentages to 2 decimals', () => {
    expect(variance(3_000, 1_000, 'spend').usedPercent).toBe(33.33);
    expect(variance(3_000, 2_000, 'spend').variancePercent).toBe(-33.33);
  });
});

describe('utilizationStatus', () => {
  it('classifies spending', () => {
    expect(utilizationStatus(variance(100_000, 101_000, 'spend'))).toBe('over');
    expect(utilizationStatus(variance(100_000, 100_000, 'spend'))).toBe('near');
    expect(utilizationStatus(variance(100_000, 90_000, 'spend'))).toBe('near');
    expect(utilizationStatus(variance(100_000, 89_990, 'spend'))).toBe('on_track');
    expect(utilizationStatus(variance(0, 1, 'spend'))).toBe('unbudgeted');
    expect(utilizationStatus(variance(0, 0, 'spend'))).toBe('no_activity');
    expect(utilizationStatus(variance(100_000, 80_000, 'spend'), 80)).toBe('near');
  });
});

describe('isException', () => {
  it('flags unbudgeted spend and unfavorable variances at or above the threshold', () => {
    expect(isException(variance(0, 1_000, 'spend'), 10)).toBe(true);
    expect(isException(variance(100_000, 110_000, 'spend'), 10)).toBe(true);
    expect(isException(variance(100_000, 109_990, 'spend'), 10)).toBe(false);
    expect(isException(variance(100_000, 150_000, 'income'), 10)).toBe(false);
    expect(isException(variance(100_000, 80_000, 'income'), 10)).toBe(true);
    expect(isException(variance(100_000, 50_000, 'spend'), 10)).toBe(false);
  });
});

describe('matchLine', () => {
  const lines = [
    { id: 1, accountId: 10, branchId: null, projectId: null },
    { id: 2, accountId: 10, branchId: 1, projectId: null },
    { id: 3, accountId: 10, branchId: null, projectId: 7 },
    { id: 4, accountId: 10, branchId: 1, projectId: 7 },
    { id: 5, accountId: 20, branchId: 2, projectId: null },
  ];

  it('picks the most specific matching line', () => {
    expect(matchLine(lines, 10, 1, 7)?.id).toBe(4);
    expect(matchLine(lines, 10, 1, null)?.id).toBe(2);
    expect(matchLine(lines, 10, 1, 8)?.id).toBe(2);
    expect(matchLine(lines, 10, 2, 7)?.id).toBe(3);
    expect(matchLine(lines, 10, 2, null)?.id).toBe(1);
    expect(matchLine(lines, 10, null, null)?.id).toBe(1);
  });

  it('returns null when no line fits (unbudgeted)', () => {
    expect(matchLine(lines, 20, 1, null)).toBeNull();
    expect(matchLine(lines, 20, null, null)).toBeNull();
    expect(matchLine(lines, 30, 2, null)).toBeNull();
  });
});
