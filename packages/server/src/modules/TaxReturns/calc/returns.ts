/**
 * Monthly Cambodian tax return figures (DiTech part C3). Pure: no database.
 * Not legal advice: the layout follows the GDT e-VAT purchase and sales books
 * and the monthly return (VAT, withholding, prepayment of tax on income,
 * Specific Tax, PLT, Accommodation Tax); check against the current templates.
 */
export type BookParty = 'taxpayer' | 'non_taxpayer';

export interface BookRow {
  no: number;
  date: string;
  number: string;
  type: 'invoice' | 'receipt' | 'bill';
  id: number;
  party: BookParty;
  partyTin: string | null;
  partyNameKm: string | null;
  partyName: string;
  currencyCode: string;
  /** Riel per unit of the document currency (1 for KHR). */
  khrRate: number | null;
  /** In the base currency: */
  nonTaxable: number;
  taxable: number;
  vat: number;
  specificTax: number;
  accommodationTax: number;
  plt: number;
  total: number;
  /** In riel (null when no rate was available): */
  taxableKhr: number | null;
  vatKhr: number | null;
  totalKhr: number | null;
}

export const PREPAYMENT_RATE = 1;

const sum = (rows: BookRow[], key: keyof BookRow) => rows.reduce((s, r) => s + (Number(r[key]) || 0), 0);
const sumKhr = (rows: BookRow[], key: keyof BookRow) =>
  rows.some((r) => r[key] === null) ? null : rows.reduce((s, r) => s + (Number(r[key]) || 0), 0);
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface WhtTotal {
  code: string;
  name: string;
  base: number;
  amount: number;
}

/** The return worksheet of a month from its books and its withholding. */
export function worksheet(month: string, sales: BookRow[], purchases: BookRow[], wht: WhtTotal[], prepaymentRate = PREPAYMENT_RATE) {
  const outputVat = sum(sales, 'vat');
  const inputVat = sum(purchases, 'vat');
  const turnover = sum(sales, 'taxable') + sum(sales, 'nonTaxable');
  const [y, m] = month.split('-').map(Number);
  const due = m === 12 ? `${y + 1}-01-20` : `${y}-${String(m + 1).padStart(2, '0')}-20`;
  return {
    month,
    dueDate: due,
    vat: {
      taxableSales: round2(sum(sales, 'taxable')),
      nonTaxableSales: round2(sum(sales, 'nonTaxable')),
      outputVat: round2(outputVat),
      taxablePurchases: round2(sum(purchases, 'taxable')),
      inputVat: round2(inputVat),
      /** Positive: to pay; negative: credit carried forward. */
      payable: round2(outputVat - inputVat),
      outputVatKhr: sumKhr(sales, 'vatKhr'),
      inputVatKhr: sumKhr(purchases, 'vatKhr'),
    },
    withholding: { lines: wht.map((w) => ({ ...w, base: round2(w.base), amount: round2(w.amount) })), total: round2(wht.reduce((s, w) => s + w.amount, 0)) },
    prepayment: { turnover: round2(turnover), rate: prepaymentRate, amount: round2((turnover * prepaymentRate) / 100) },
    specificTax: round2(sum(sales, 'specificTax')),
    accommodationTax: round2(sum(sales, 'accommodationTax')),
    publicLightingTax: round2(sum(sales, 'plt')),
  };
}

export const SALES_BOOK_HEADER = [
  'No.', 'Date', 'Invoice No.', 'Buyer type', 'Buyer TIN', 'Buyer name (Khmer)', 'Buyer name', 'Currency', 'Riel rate',
  'Non-taxable sales', 'Taxable value', 'VAT', 'Specific Tax', 'Accommodation Tax', 'Public Lighting Tax', 'Total',
  'Taxable value (KHR)', 'VAT (KHR)', 'Total (KHR)',
];

export const PURCHASE_BOOK_HEADER = [
  'No.', 'Date', 'Bill No.', 'Supplier type', 'Supplier TIN', 'Supplier name (Khmer)', 'Supplier name', 'Currency', 'Riel rate',
  'Non-taxable purchases', 'Taxable value', 'VAT (input)', 'Total', 'Taxable value (KHR)', 'VAT (KHR)', 'Total (KHR)',
];

const PARTY_LABEL: Record<BookParty, string> = { taxpayer: '1 - Taxpayer', non_taxpayer: '2 - Non-taxpayer' };

/** Rows of a book as arrays for a spreadsheet, under its header. */
export function bookAoa(book: 'sales' | 'purchases', rows: BookRow[]): unknown[][] {
  const body = rows.map((r) =>
    book === 'sales'
      ? [r.no, r.date, r.number, PARTY_LABEL[r.party], r.partyTin ?? '', r.partyNameKm ?? '', r.partyName, r.currencyCode, r.khrRate ?? '',
          round2(r.nonTaxable), round2(r.taxable), round2(r.vat), round2(r.specificTax), round2(r.accommodationTax), round2(r.plt), round2(r.total),
          r.taxableKhr ?? '', r.vatKhr ?? '', r.totalKhr ?? '']
      : [r.no, r.date, r.number, PARTY_LABEL[r.party], r.partyTin ?? '', r.partyNameKm ?? '', r.partyName, r.currencyCode, r.khrRate ?? '',
          round2(r.nonTaxable), round2(r.taxable), round2(r.vat), round2(r.total), r.taxableKhr ?? '', r.vatKhr ?? '', r.totalKhr ?? ''],
  );
  return [book === 'sales' ? SALES_BOOK_HEADER : PURCHASE_BOOK_HEADER, ...body];
}
