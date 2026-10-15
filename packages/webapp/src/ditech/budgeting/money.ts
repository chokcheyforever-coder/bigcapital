/**
 * Exact amounts in the grid: integer thousandths, like the server
 * (modules/Budgeting/calc). Floating point never accumulates in totals.
 */
export type Milli = number;

/** Parses what a person types or pastes: "1,250.50", "-30", "(30)" accounting negatives. */
export function parseAmount(text: string, decimals = 2): { ok: true; value: Milli | null } | { ok: false; error: string } {
  let t = String(text ?? '').trim().replace(/ /g, '');
  if (t === '') return { ok: true, value: null };
  let negative = false;
  if (/^\(.*\)$/.test(t)) {
    negative = true;
    t = t.slice(1, -1);
  }
  t = t.replace(/^[$៛€£]\s*/, '');
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, '');
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(t);
  if (!m) return { ok: false, error: `"${text}" is not an amount` };
  const frac = (m[3] ?? '').replace(/0+$/, '');
  if (frac.length > decimals) return { ok: false, error: `At most ${decimals} decimals` };
  const milli = Number(m[2]) * 1000 + Number(frac.padEnd(3, '0') || '0');
  if (milli > 9_999_999_999_999) return { ok: false, error: 'Amount too large' };
  const sign = (m[1] ? -1 : 1) * (negative ? -1 : 1);
  return { ok: true, value: milli === 0 ? 0 : sign * milli };
}

export const toMilli = (n: number): Milli => Math.round(n * 1000);
export const fromMilli = (m: Milli): number => m / 1000;

export function formatAmount(m: Milli | null | undefined, decimals = 2): string {
  if (m === null || m === undefined) return '';
  return fromMilli(m).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** The editable text of a cell (no thousands separators). */
export const editText = (m: Milli | null | undefined): string => (m === null || m === undefined ? '' : String(fromMilli(m)));

export const sum = (values: Array<Milli | null | undefined>): Milli => values.reduce<number>((a, v) => a + (v ?? 0), 0);

export const currencyDecimals = (currencyCode: string): number => {
  try {
    return Math.min(new Intl.NumberFormat('en', { style: 'currency', currency: currencyCode }).resolvedOptions().maximumFractionDigits ?? 2, 3);
  } catch {
    return 2;
  }
};
