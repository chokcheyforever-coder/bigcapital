/**
 * A document's taxes as printable lines (DiTech compliance gaps G2/G3), for
 * documents whose taxes are read from their lines: VAT one line per tax rate,
 * Specific/Accommodation Tax and PLT one line per code and rate. Pure.
 */
export interface TaxLine {
  kind: 'vat' | 'specific' | 'accommodation' | 'plt';
  taxRateId: number | null;
  code: string;
  name: string;
  nameKm: string | null;
  rate: number;
  amount: number;
}

export function documentTaxLines(entries: any[]): TaxLine[] {
  const lines = new Map<string, TaxLine>();
  const add = (key: string, init: Omit<TaxLine, 'amount'>, amount: number) => {
    if (!amount) return;
    const line = lines.get(key) ?? { ...init, amount: 0 };
    line.amount += amount;
    lines.set(key, line);
  };
  for (const e of entries ?? []) {
    const excise = [
      { code: e.specificTaxCode, rate: e.specificTaxRate, amount: Number(e.specificTaxAmount) || 0 },
      { code: e.pltCode, rate: e.pltRate, amount: Number(e.pltAmount) || 0 },
    ];
    for (const part of excise) {
      add(
        `x:${part.code?.code ?? '?'}@${Number(part.rate)}`,
        { kind: part.code?.kind ?? 'specific', taxRateId: null, code: part.code?.code ?? '', name: part.code?.name ?? '', nameKm: part.code?.nameKm ?? null, rate: Number(part.rate) },
        part.amount,
      );
    }
  }
  for (const e of entries ?? []) {
    if (!e.taxRateId) continue;
    add(
      `v:${e.taxRateId}@${Number(e.taxRate)}`,
      { kind: 'vat', taxRateId: e.taxRateId, code: e.tax?.code ?? '', name: e.tax?.name ?? 'VAT', nameKm: null, rate: Number(e.taxRate) || 0 },
      Number(e.taxAmount) || 0,
    );
  }
  return [...lines.values()].map((l) => ({ ...l, amount: Math.round(l.amount * 1000) / 1000 }));
}
