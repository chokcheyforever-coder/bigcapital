// 103 DiTech: Specific/Accommodation Tax and PLT of a form's lines, from the
// items' codes, with the same rules the server posts (shared pdf-templates
// ExciseTax.ts, imported as source: the built bundle carries its own React).
import { exciseAmounts } from '../../../../../shared/pdf-templates/src/components/ExciseTax';
import type { ExciseTaxCode } from './useExciseTaxCodes';

export interface EntriesExciseLine {
  code: string;
  label: string;
  amount: number;
}

export interface EntriesExcise {
  lines: EntriesExciseLine[];
  total: number;
  /** VAT charged on these taxes, by tax rate id (tax-exclusive lines only). */
  vatByTaxRateId: Record<string, number>;
  vat: number;
  /** Some line's item carries one of these taxes (whatever the tax mode). */
  hasExciseItems: boolean;
}

export function entriesExcise(
  entries: Array<{ itemId?: string | number; quantity?: string | number; rate?: string | number; taxRateId?: string | number }>,
  codes: ExciseTaxCode[],
  taxRates: Array<{ id: number; rate: number }>,
  isExclusiveTax: boolean,
): EntriesExcise {
  const empty = { lines: [], total: 0, vatByTaxRateId: {}, vat: 0, hasExciseItems: false };
  if (!codes?.length) return empty;
  const byItem: Record<string, { specific?: ExciseTaxCode; plt?: ExciseTaxCode }> = {};
  for (const code of codes) {
    if (!code.active) continue;
    for (const itemId of code.item_ids ?? []) {
      byItem[itemId] = { ...byItem[itemId], [code.kind === 'plt' ? 'plt' : 'specific']: code };
    }
  }
  const hasExciseItems = entries.some((entry) => !!byItem[String(entry.itemId)]);
  if (!isExclusiveTax) return { ...empty, hasExciseItems };
  const lines = new Map<string, EntriesExciseLine>();
  const vatByTaxRateId: Record<string, number> = {};
  let total = 0;
  let vat = 0;
  for (const entry of entries) {
    const assigned = byItem[String(entry.itemId)];
    if (!assigned) continue;
    const amount = (Number(entry.quantity) || 0) * (Number(entry.rate) || 0);
    const out = exciseAmounts(amount, {
      specificTaxRate: assigned.specific?.rate,
      specificTaxBase: assigned.specific?.base_percent,
      pltRate: assigned.plt?.rate,
      pltBase: assigned.plt?.base_percent,
    });
    for (const [code, value] of [
      [assigned.specific, out.specificTax],
      [assigned.plt, out.plt],
    ] as Array<[ExciseTaxCode | undefined, number]>) {
      if (!code || !value) continue;
      const line = lines.get(code.code) ?? { code: code.code, label: `${code.name} [${code.rate}%]`, amount: 0 };
      line.amount += value;
      lines.set(code.code, line);
    }
    total += out.total;
    const taxRate = entry.taxRateId ? taxRates.find((t) => String(t.id) === String(entry.taxRateId)) : undefined;
    if (taxRate && out.total) {
      const lineVat = (out.total * Number(taxRate.rate)) / 100;
      vatByTaxRateId[String(taxRate.id)] = (vatByTaxRateId[String(taxRate.id)] ?? 0) + lineVat;
      vat += lineVat;
    }
  }
  return { lines: [...lines.values()], total, vatByTaxRateId, vat, hasExciseItems };
}
