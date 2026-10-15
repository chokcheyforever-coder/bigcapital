import { cellAmount, headerMonth } from './BudgetSheet.service';

describe('budget sheet parsing', () => {
  it('reads month headers in the usual spreadsheet forms', () => {
    expect(headerMonth('2031-01')).toBe('2031-01-01');
    expect(headerMonth('2031-1')).toBe('2031-01-01');
    expect(headerMonth('2031-12-01')).toBe('2031-12-01');
    expect(headerMonth('Jan 2031')).toBe('2031-01-01');
    expect(headerMonth('january 2031')).toBe('2031-01-01');
    expect(headerMonth('Sep-2031')).toBe('2031-09-01');
    expect(headerMonth(new Date(2031, 2, 1))).toBe('2031-03-01');
  });

  it('refuses headers that are not months', () => {
    for (const h of ['2031-13', '2031-01-15', 'Janx 2031', 'Jan 2031x', 'Total', '', null, 2031]) {
      expect(headerMonth(h)).toBeNull();
    }
  });

  it('reads amounts, with or without thousands separators', () => {
    expect(cellAmount(1250.5)).toBe(1250.5);
    expect(cellAmount('1,250.50')).toBe('1250.50');
    expect(cellAmount('-1,000')).toBe('-1000');
    expect(cellAmount('1250.5')).toBe('1250.5');
    expect(cellAmount('  ')).toBeNull();
    expect(cellAmount(null)).toBeNull();
    // "1,5" is not a thousands separator: left as is, refused later as not an amount.
    expect(cellAmount('1,5')).toBe('1,5');
  });
});
