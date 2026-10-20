/**
 * Price level formula (design docs/ditech/pricing/price-levels-design.md §3).
 * Pure: no database. Amounts are integers in thousandths (the precision of
 * item prices), so rounding is exact.
 */
import type { PriceLevelMethod, Rounding } from '../PriceLevels.types';

export const toUnits = (amount: number | string | null | undefined) => Math.round(Number(amount ?? 0) * 1000);
export const fromUnits = (units: number) => units / 1000;

export interface PriceLevelRule {
  method: PriceLevelMethod;
  /** Percentage method: +15 marks the normal price up 15%, -10 marks it down 10%. */
  percentage?: number | null;
  rounding: Rounding;
  /** Percentage method: only items in these categories; empty = all items. */
  categoryIds: number[];
  /** Per-item method: fixed prices; minQuantity 1 is the plain item price, higher ones are quantity breaks. */
  items: Array<{ itemId: number; minQuantity: number; price: number }>;
  active: boolean;
  validFrom?: string | null;
  validTo?: string | null;
}

export type PriceSource = 'item_price' | 'quantity_break' | 'percentage' | 'standard';

export interface PriceLine {
  itemId: number;
  categoryId?: number | null;
  /** The item's normal price in units (sell price for sales, cost price for purchases). */
  standard: number;
  quantity: number;
}

const STEP: Record<Exclude<Rounding, 'none' | 'x.99'>, number> = {
  '0.01': 10,
  '0.05': 50,
  '0.10': 100,
  '0.50': 500,
  '1': 1000,
};

/** Rounds a price in units; half-way rounds up. "x.99" rounds to the nearest whole amount, then takes 0.01 off. */
export function roundPrice(units: number, rounding: Rounding): number {
  if (rounding === 'none') return units;
  if (rounding === 'x.99') {
    const whole = Math.round(units / 1000) * 1000;
    // Below 1.00 there is no ".99" price lower than the amount itself: keep cents.
    return whole >= 1000 ? whole - 10 : Math.round(units / 10) * 10;
  }
  const step = STEP[rounding];
  return Math.round(units / step) * step;
}

/** Whether the level applies on `date` (YYYY-MM-DD): active and inside its dates. */
export function levelApplies(rule: Pick<PriceLevelRule, 'active' | 'validFrom' | 'validTo'>, date: string): boolean {
  if (!rule.active) return false;
  if (rule.validFrom && date < rule.validFrom.slice(0, 10)) return false;
  if (rule.validTo && date > rule.validTo.slice(0, 10)) return false;
  return true;
}

/**
 * The price of one line under a price level, most specific first:
 * a quantity break or fixed item price (per-item method), then the
 * percentage (percentage method, if the item's category is covered),
 * else the normal price. Never negative.
 */
export function priceFor(rule: PriceLevelRule, line: PriceLine): { rate: number; source: PriceSource } {
  if (rule.method === 'per_item') {
    const hit = rule.items
      .filter((i) => i.itemId === line.itemId && i.minQuantity <= line.quantity)
      .sort((a, b) => b.minQuantity - a.minQuantity)[0];
    if (hit) return { rate: Math.max(0, hit.price), source: hit.minQuantity > 1 ? 'quantity_break' : 'item_price' };
    return { rate: line.standard, source: 'standard' };
  }
  const covered = rule.categoryIds.length === 0 || (line.categoryId != null && rule.categoryIds.includes(line.categoryId));
  if (!covered || !rule.percentage) return { rate: line.standard, source: 'standard' };
  const raw = Math.round((line.standard * (100 + Number(rule.percentage))) / 100);
  return { rate: Math.max(0, roundPrice(raw, rule.rounding)), source: 'percentage' };
}
