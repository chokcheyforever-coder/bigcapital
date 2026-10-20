import { fromUnits, levelApplies, priceFor, PriceLevelRule, roundPrice, toUnits } from './price-level';

/**
 * Fixture (design §6): Laptop 900 (category 1), Router 120 (category 2),
 * Printer ink 25 (no category).
 */
const LAPTOP = { itemId: 1, categoryId: 1, standard: toUnits(900) };
const ROUTER = { itemId: 2, categoryId: 2, standard: toUnits(120) };
const INK = { itemId: 3, categoryId: null, standard: toUnits(25) };

const percentage = (pct: number, extra: Partial<PriceLevelRule> = {}): PriceLevelRule => ({
  method: 'percentage', percentage: pct, rounding: 'none', categoryIds: [], items: [], active: true, ...extra,
});
const price = (rule: PriceLevelRule, line: typeof LAPTOP, quantity = 1) => {
  const r = priceFor(rule, { ...line, quantity });
  return { rate: fromUnits(r.rate), source: r.source };
};

describe('price level fixture (design §6)', () => {
  it('wholesale -15% on all items', () => {
    const rule = percentage(-15);
    expect(price(rule, LAPTOP)).toEqual({ rate: 765, source: 'percentage' });
    expect(price(rule, ROUTER)).toEqual({ rate: 102, source: 'percentage' });
    expect(price(rule, INK)).toEqual({ rate: 21.25, source: 'percentage' });
  });

  it('wholesale -15% with prices ending in .99', () => {
    const rule = percentage(-15, { rounding: 'x.99' });
    expect([LAPTOP, ROUTER, INK].map((l) => price(rule, l).rate)).toEqual([764.99, 101.99, 20.99]);
  });

  it('markup +12.5% rounded to whole amounts; -10% rounded to 0.05', () => {
    expect(price(percentage(12.5, { rounding: '1' }), ROUTER).rate).toBe(135);
    expect(price(percentage(-10, { rounding: '0.05' }), { ...INK, standard: toUnits(24.99) }).rate).toBe(22.5);
  });

  it('a category-limited percentage leaves other items at the normal price', () => {
    const rule = percentage(-15, { categoryIds: [1] });
    expect(price(rule, LAPTOP)).toEqual({ rate: 765, source: 'percentage' });
    expect(price(rule, ROUTER)).toEqual({ rate: 120, source: 'standard' });
    expect(price(rule, INK)).toEqual({ rate: 25, source: 'standard' });
  });

  it('per-item prices with quantity breaks: 1+ 10, 10+ 8, 50+ 7', () => {
    const rule: PriceLevelRule = {
      method: 'per_item', rounding: 'x.99', categoryIds: [], active: true,
      items: [
        { itemId: 1, minQuantity: 1, price: toUnits(850) },
        { itemId: 3, minQuantity: 1, price: toUnits(10) },
        { itemId: 3, minQuantity: 10, price: toUnits(8) },
        { itemId: 3, minQuantity: 50, price: toUnits(7) },
      ],
    };
    // Fixed prices are used as entered: no rounding.
    expect(price(rule, LAPTOP)).toEqual({ rate: 850, source: 'item_price' });
    expect([1, 9, 10, 49, 50, 500].map((q) => price(rule, INK, q).rate)).toEqual([10, 10, 8, 8, 7, 7]);
    expect(price(rule, INK, 10).source).toBe('quantity_break');
    // Items not on the list keep their normal price.
    expect(price(rule, ROUTER)).toEqual({ rate: 120, source: 'standard' });
  });

  it('a break above the ordered quantity alone does not apply', () => {
    const rule: PriceLevelRule = { method: 'per_item', rounding: 'none', categoryIds: [], active: true, items: [{ itemId: 3, minQuantity: 10, price: toUnits(8) }] };
    expect(price(rule, INK, 5)).toEqual({ rate: 25, source: 'standard' });
  });

  it('never below zero', () => {
    expect(price(percentage(-150), LAPTOP).rate).toBe(0);
  });
});

describe('roundPrice', () => {
  it.each([
    [toUnits(21.255), '0.01', 21.26],
    [toUnits(21.249), '0.05', 21.25],
    [toUnits(21.3), '0.10', 21.3],
    [toUnits(21.74), '0.50', 21.5],
    [toUnits(21.75), '0.50', 22],
    [toUnits(21.5), '1', 22],
    [toUnits(0.4), 'x.99', 0.4],
    [toUnits(1.6), 'x.99', 1.99],
  ] as const)('%d units, %s', (units, rounding, expected) => {
    expect(fromUnits(roundPrice(units, rounding))).toBe(expected);
  });
});

describe('levelApplies', () => {
  it('needs an active level inside its dates (inclusive)', () => {
    const rule = { active: true, validFrom: '2026-11-01', validTo: '2026-11-30' };
    expect(levelApplies(rule, '2026-10-31')).toBe(false);
    expect(levelApplies(rule, '2026-11-01')).toBe(true);
    expect(levelApplies(rule, '2026-11-30')).toBe(true);
    expect(levelApplies(rule, '2026-12-01')).toBe(false);
    expect(levelApplies({ ...rule, active: false }, '2026-11-15')).toBe(false);
    expect(levelApplies({ active: true }, '2030-01-01')).toBe(true);
  });
});
