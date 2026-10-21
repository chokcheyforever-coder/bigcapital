/**
 * 103 DiTech: Cambodian taxes charged on a sales line before VAT (design
 * docs/ditech/compliance/tax-reports-plan.md, part C1). Pure: no React, no
 * database, so the server's ledger and the webapp's invoice form calculate
 * the same amounts.
 *
 *   Specific Tax (or Accommodation Tax) = amount × base% × rate%
 *   Public Lighting Tax                 = (amount + Specific Tax) × base% × rate%
 *   VAT base                            = amount + Specific Tax + PLT
 *
 * The base percentage is set per tax code: 100% by default, 20% for a
 * reseller's PLT (20% of the price excluding VAT and PLT), 90% for a local
 * producer's Specific Tax. Rates change: they are company settings, not
 * constants; the defaults below are a starting point to check with the GDT.
 */
export type ExciseTaxKind = 'specific' | 'accommodation' | 'plt';

export interface ExciseLineRates {
  specificTaxRate?: number | null;
  specificTaxBase?: number | null;
  pltRate?: number | null;
  pltBase?: number | null;
}

export interface ExciseLineAmounts {
  specificTax: number;
  plt: number;
  total: number;
}

const fraction = (percent: number | null | undefined, fallback: number) =>
  (percent === null || percent === undefined || Number.isNaN(Number(percent)) ? fallback : Number(percent)) / 100;

/** Specific Tax and PLT of one line whose amount (quantity × rate) excludes VAT. */
export function exciseAmounts(amount: number, rates: ExciseLineRates | null | undefined): ExciseLineAmounts {
  const base = Number(amount) || 0;
  const specificTax = rates?.specificTaxRate ? base * fraction(rates.specificTaxBase, 100) * fraction(rates.specificTaxRate, 0) : 0;
  const plt = rates?.pltRate ? (base + specificTax) * fraction(rates.pltBase, 100) * fraction(rates.pltRate, 0) : 0;
  return { specificTax, plt, total: specificTax + plt };
}

export interface ExciseTaxCodeDefault {
  kind: ExciseTaxKind;
  code: string;
  name: string;
  nameKm: string;
  rate: number;
  basePercent: number;
}

/**
 * Starting codes for a new company, from published 2023–24 rates (Andersen
 * and VDB Loi tax booklets). Check them against current GDT notices before
 * filing: sources disagree on PLT for wine, and a new health tax was planned
 * in 2025.
 */
export const DEFAULT_EXCISE_TAX_CODES: ExciseTaxCodeDefault[] = [
  { kind: 'specific', code: 'ST-TOBACCO', name: 'Specific Tax – cigarettes and cigars', nameKm: 'អាករពិសេស – បារី', rate: 20, basePercent: 100 },
  { kind: 'specific', code: 'ST-ALCOHOL', name: 'Specific Tax – wine and spirits', nameKm: 'អាករពិសេស – ស្រា', rate: 35, basePercent: 100 },
  { kind: 'specific', code: 'ST-BEER', name: 'Specific Tax – beer', nameKm: 'អាករពិសេស – ស្រាបៀរ', rate: 30, basePercent: 100 },
  { kind: 'accommodation', code: 'AT', name: 'Accommodation Tax', nameKm: 'អាករលើការស្នាក់នៅ', rate: 2, basePercent: 100 },
  { kind: 'plt', code: 'PLT', name: 'Public Lighting Tax', nameKm: 'អាករបំភ្លឺសាធារណៈ', rate: 3, basePercent: 100 },
  { kind: 'plt', code: 'PLT-RESELLER', name: 'Public Lighting Tax – reseller (20% base)', nameKm: 'អាករបំភ្លឺសាធារណៈ – អ្នកលក់បន្ត', rate: 3, basePercent: 20 },
];
