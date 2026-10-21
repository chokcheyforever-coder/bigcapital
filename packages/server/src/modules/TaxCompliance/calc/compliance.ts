/**
 * Cambodia tax document rules (design docs/ditech/compliance/cambodia-invoicing-design.md §1, §3).
 * Pure: no database. Not legal advice: rules as summarised from Prakas 723 MEF
 * and Notification 4908 GDT; confirm with a tax adviser.
 */
export type TaxpayerSize = 'small' | 'medium' | 'large';
export type DocumentKind = 'vat_invoice' | 'commercial_invoice';
export type DocumentLanguage = 'km_en' | 'km' | 'en';
export type RateSource = 'nbc_daily' | 'gdt_monthly';

export interface SellerProfile {
  enabled: boolean;
  tin?: string | null;
  taxpayerSize?: TaxpayerSize | null;
  vatRegistered: boolean;
}

export interface Buyer {
  taxNumber?: string | null;
  registeredTaxpayer?: boolean | null;
}

/**
 * VAT invoice: a VAT-registered medium or large taxpayer selling to a
 * registered taxpayer (who needs the invoice for its input credit).
 * Everyone else issues commercial invoices: small taxpayers always, and
 * medium/large ones to unregistered buyers.
 */
export function documentKind(seller: SellerProfile, buyer: Buyer | null | undefined): DocumentKind {
  const canIssueVat = seller.vatRegistered && (seller.taxpayerSize === 'medium' || seller.taxpayerSize === 'large');
  const registeredBuyer = !!buyer?.registeredTaxpayer;
  return canIssueVat && registeredBuyer ? 'vat_invoice' : 'commercial_invoice';
}

export interface IssueContext {
  kind: DocumentKind;
  seller: SellerProfile;
  buyer: Buyer | null | undefined;
  /** Document currency is not KHR: amounts must also be shown in riel. */
  foreignCurrency: boolean;
  khrRate: number | null;
}

/** What blocks issuing (delivering) a tax document. Empty = ready. */
export function issueProblems(ctx: IssueContext): Array<{ code: string; message: string }> {
  const out: Array<{ code: string; message: string }> = [];
  if (!ctx.seller.tin?.trim()) {
    out.push({ code: 'SELLER_TIN_MISSING', message: "Enter your company's TIN in Settings › Tax compliance before issuing tax documents." });
  }
  if (ctx.kind === 'vat_invoice' && !ctx.buyer?.taxNumber?.trim()) {
    out.push({ code: 'BUYER_TIN_MISSING', message: "A VAT invoice needs the customer's TIN: add it to the customer, or untick \"registered taxpayer\"." });
  }
  if (ctx.foreignCurrency && !(ctx.khrRate && ctx.khrRate > 0)) {
    out.push({ code: 'KHR_RATE_MISSING', message: 'No riel exchange rate for this date: add the GDT monthly rate in Settings › Tax compliance, or try again later for the NBC daily rate.' });
  }
  return out;
}

/** "2026-10-21" -> "2026-09": the GDT monthly rate used is the previous month's. */
export function previousMonth(date: string): string {
  const [y, m] = date.slice(0, 7).split('-').map(Number);
  const pm = m === 1 ? 12 : m - 1;
  const py = m === 1 ? y - 1 : y;
  return `${py}-${String(pm).padStart(2, '0')}`;
}

export function gdtRateFor(date: string, rates: Array<{ month: string; rate: number }>): number | null {
  const month = previousMonth(date);
  const hit = rates.find((r) => r.month === month);
  return hit && hit.rate > 0 ? hit.rate : null;
}

/** Riel amount, rounded to whole riel. */
export const toKhr = (amount: number, rate: number) => Math.round(amount * rate);

/** Document titles (Khmer, English). */
export const TITLES: Record<string, { km: string; en: string }> = {
  vat_invoice: { km: 'វិក្កយបត្រអាករ', en: 'VAT Invoice' },
  commercial_invoice: { km: 'វិក្កយបត្រ', en: 'Commercial Invoice' },
  receipt: { km: 'បង្កាន់ដៃទទួលប្រាក់', en: 'Receipt' },
  credit_note: { km: 'កំណត់ត្រាឥណទាន', en: 'Credit Note' },
};

/** Printed labels (Khmer, English). */
export const LABELS: Record<string, { km: string; en: string }> = {
  invoiceNumber: { km: 'លេខវិក្កយបត្រ', en: 'Invoice No.' },
  receiptNumber: { km: 'លេខបង្កាន់ដៃ', en: 'Receipt No.' },
  creditNoteNumber: { km: 'លេខកំណត់ត្រា', en: 'Credit Note No.' },
  dateIssue: { km: 'កាលបរិច្ឆេទ', en: 'Date' },
  dueDate: { km: 'ថ្ងៃផុតកំណត់', en: 'Due Date' },
  seller: { km: 'អ្នកលក់', en: 'Seller' },
  buyer: { km: 'អ្នកទិញ', en: 'Buyer' },
  tin: { km: 'លេខអត្តសញ្ញាណកម្មសារពើពន្ធ (VATTIN)', en: 'Tax ID (VATTIN)' },
  item: { km: 'បរិយាយ', en: 'Description' },
  quantity: { km: 'បរិមាណ', en: 'Qty' },
  rate: { km: 'តម្លៃឯកតា', en: 'Unit Price' },
  total: { km: 'តម្លៃសរុប', en: 'Amount' },
  subtotal: { km: 'សរុប (មិនរួមអាករ)', en: 'Subtotal (excl. tax)' },
  grandTotal: { km: 'សរុបរួម', en: 'Grand Total' },
  totalInclTax: { km: 'សរុប (រួមអាករ)', en: 'Total (incl. tax)' },
  paymentMade: { km: 'បានបង់', en: 'Paid' },
  dueAmount: { km: 'នៅជំពាក់', en: 'Balance Due' },
  khr: { km: 'ចំនួនជាប្រាក់រៀល', en: 'Amounts in riel (KHR)' },
  khrRate: { km: 'អត្រាប្តូរប្រាក់', en: 'Exchange rate' },
  khrSubtotal: { km: 'សរុប (មិនរួមអាករ)', en: 'Subtotal' },
  khrTax: { km: 'អាករលើតម្លៃបន្ថែម', en: 'VAT' },
  khrTotal: { km: 'សរុបរួម', en: 'Total' },
  sellerSignature: { km: 'ហត្ថលេខា និងឈ្មោះអ្នកលក់', en: "Seller's signature and name" },
  buyerSignature: { km: 'ហត្ថលេខា និងឈ្មោះអ្នកទិញ', en: "Buyer's signature and name" },
};

export const RATE_SOURCE_LABELS: Record<RateSource, { km: string; en: string }> = {
  nbc_daily: { km: 'អត្រាប្រចាំថ្ងៃ ធនាគារជាតិនៃកម្ពុជា', en: 'NBC daily rate' },
  gdt_monthly: { km: 'អត្រាប្រចាំខែ អគ្គនាយកដ្ឋានពន្ធដារ', en: 'GDT monthly rate' },
};

/** A label in the company's document language: "ខ្មែរ\nEnglish", "ខ្មែរ" or "English". */
export function label(key: { km: string; en: string }, language: DocumentLanguage): string {
  if (language === 'km') return key.km;
  if (language === 'en') return key.en;
  return `${key.km}\n${key.en}`;
}
