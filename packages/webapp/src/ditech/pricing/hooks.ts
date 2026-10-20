// 103 DiTech: price levels are a plan feature (`price_levels`). The server
// blocks /api/price-levels for plans without it; the webapp hides the price
// level fields and shows the page locked.
import { isLocked, usePlanFeatures } from '@/ditech/plan';

export const PRICE_LEVELS_FEATURE = 'price_levels';

/** True unless the company's plan is known and leaves price levels out. */
export function usePriceLevelsEnabled(): boolean {
  const { data: plan } = usePlanFeatures();
  return !isLocked(plan, PRICE_LEVELS_FEATURE);
}

export const ROUNDING_OPTIONS = [
  { value: 'none', label: 'No rounding' },
  { value: '0.01', label: 'Nearest 0.01' },
  { value: '0.05', label: 'Nearest 0.05' },
  { value: '0.10', label: 'Nearest 0.10' },
  { value: '0.50', label: 'Nearest 0.50' },
  { value: '1', label: 'Nearest whole amount' },
  { value: 'x.99', label: 'Ends in .99' },
];

/** "−15% (ends in .99)", "Per item · 12 prices". */
export function describeLevel(level: {
  method: string;
  percentage?: number | null;
  rounding?: string;
  itemPricesCount?: number;
}): string {
  if (level.method === 'per_item') {
    return level.itemPricesCount != null ? `Per item · ${level.itemPricesCount} prices` : 'Per item prices';
  }
  const pct = Number(level.percentage ?? 0);
  const rounding = ROUNDING_OPTIONS.find((r) => r.value === level.rounding);
  const sign = pct > 0 ? '+' : pct < 0 ? '−' : '';
  return `${sign}${Math.abs(pct)}%${rounding && rounding.value !== 'none' ? ` (${rounding.label.toLowerCase()})` : ''}`;
}
