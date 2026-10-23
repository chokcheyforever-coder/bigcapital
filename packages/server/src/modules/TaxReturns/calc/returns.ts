/**
 * Monthly Cambodian tax return figures (DiTech part C3). Pure: no database.
 * Not legal advice: the layout follows the GDT e-VAT purchase and sales books
 * and the monthly return (VAT, withholding, prepayment of tax on income,
 * Specific Tax, PLT, Accommodation Tax); check against the current templates.
 */
import * as moment from 'moment';

export type BookParty = 'taxpayer' | 'non_taxpayer';
export type BookDocType = 'invoice' | 'receipt' | 'credit_note' | 'bill' | 'vendor_credit' | 'expense';

export interface BookRow {
  no: number;
  date: string;
  number: string;
  type: BookDocType;
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

/** A document's figures in its own currency, before it becomes a book row. */
export interface BookDoc {
  type: BookDocType;
  id: number;
  date: string;
  number: string;
  contactId: number | null;
  currencyCode: string;
  exchangeRate: number;
  /** The riel rate stored on the document, if any. */
  khrRate: number | null;
  /** Value excluding VAT, after discount. */
  taxable: number;
  vat: number;
  specificTax: number;
  accommodationTax: number;
  plt: number;
  total: number;
  /** -1 for credit notes and vendor credits. */
  sign: 1 | -1;
}

const num = (v: unknown) => Number(v) || 0;

/**
 * A document with item lines (invoice, receipt, credit note, bill, vendor
 * credit) as a BookDoc. Reads the model's getters: VAT is
 * taxAmountWithheld, and the lines' Specific/Accommodation Tax and PLT.
 */
export function itemDoc(
  model: any,
  opts: {
    type: BookDocType;
    date: Date | string;
    number: string;
    contactId: number | null;
    subtotalExcludingTax?: number;
    sign?: 1 | -1;
    /** Use the riel rate stored on the document (sales documents). */
    ownRate?: boolean;
  },
): BookDoc {
  let specificTax = 0;
  let accommodationTax = 0;
  let plt = 0;
  for (const e of model.entries ?? []) {
    if (e.specificTaxCode?.kind === 'accommodation') accommodationTax += num(e.specificTaxAmount);
    else specificTax += num(e.specificTaxAmount);
    plt += num(e.pltAmount);
  }
  const subtotal = opts.subtotalExcludingTax ?? model.subtotalExcludingTax ?? model.subtotal;
  return {
    type: opts.type,
    id: model.id,
    date: moment(opts.date).format('YYYY-MM-DD'),
    number: opts.number,
    contactId: opts.contactId ?? null,
    currencyCode: model.currencyCode,
    exchangeRate: num(model.exchangeRate) || 1,
    khrRate: opts.ownRate === false ? null : num(model.khrRate) || null,
    taxable: Math.max(num(subtotal) - num(model.discountAmount), 0),
    vat: num(model.taxAmountWithheld),
    specificTax,
    accommodationTax,
    plt,
    total: num(model.total),
    sign: opts.sign ?? 1,
  };
}

/** A published expense as a BookDoc: its categories' total, input VAT if any. */
export function expenseDoc(model: any): BookDoc {
  const vat = num(model.taxAmountWithheld);
  const total = num(model.totalAmount);
  return {
    type: 'expense',
    id: model.id,
    date: moment(model.paymentDate).format('YYYY-MM-DD'),
    number: model.referenceNo || `EXP-${model.id}`,
    contactId: model.payeeId || null,
    currencyCode: model.currencyCode,
    exchangeRate: num(model.exchangeRate) || 1,
    khrRate: null,
    taxable: total - vat,
    vat,
    specificTax: 0,
    accommodationTax: 0,
    plt: 0,
    total,
    sign: 1,
  };
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
