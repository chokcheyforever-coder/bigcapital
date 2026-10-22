/**
 * Withholding tax (DiTech part C2). Pure: no database.
 * Rates as summarised from the Law on Taxation, articles 25 and 26 (residents)
 * and 26 (non-residents); confirm with a tax adviser. They are company
 * settings, not constants: these are the starting codes.
 */
import type { WhtPaymentType } from '../models/WhtCode.model';

export interface WhtCodeDefault {
  code: string;
  name: string;
  nameKm: string;
  paymentType: WhtPaymentType;
  rate: number;
}

export const DEFAULT_WHT_CODES: WhtCodeDefault[] = [
  { code: 'WHT-SERVICE', name: 'Services from an unregistered resident', nameKm: 'សេវាពីនិវាសនជនមិនបានចុះបញ្ជី', paymentType: 'service', rate: 15 },
  { code: 'WHT-ROYALTY', name: 'Royalties', nameKm: 'សួយសារ', paymentType: 'royalty', rate: 15 },
  { code: 'WHT-INTEREST', name: 'Interest (paid by a non-bank)', nameKm: 'ការប្រាក់', paymentType: 'interest', rate: 15 },
  { code: 'WHT-RENT', name: 'Rent of movable and immovable property', nameKm: 'ថ្លៃឈ្នួលទ្រព្យ', paymentType: 'rent', rate: 10 },
  { code: 'WHT-NR', name: 'Payments to non-residents', nameKm: 'ការទូទាត់ឱ្យអនិវាសនជន', paymentType: 'non_resident', rate: 14 },
];

/** Tax withheld on a base amount (excluding VAT), rounded to the cent. */
export const whtAmount = (base: number, rate: number | null | undefined) =>
  rate ? Math.round((Number(base) || 0) * Number(rate)) / 100 : 0;

export const WHT_LABELS = {
  certificate: { km: 'លិខិតបញ្ជាក់ការកាត់ទុកពន្ធ', en: 'Withholding Tax Certificate' },
  withholder: { km: 'អ្នកកាត់ទុក', en: 'Withholder' },
  recipient: { km: 'អ្នកទទួលប្រាក់', en: 'Recipient' },
  month: { km: 'ខែ', en: 'Month' },
  document: { km: 'ឯកសារ', en: 'Document' },
  date: { km: 'កាលបរិច្ឆេទ', en: 'Date' },
  paymentType: { km: 'ប្រភេទការទូទាត់', en: 'Payment type' },
  base: { km: 'ចំនួនទឹកប្រាក់ត្រូវបង់', en: 'Amount paid (excl. VAT)' },
  rate: { km: 'អត្រា', en: 'Rate' },
  withheld: { km: 'ពន្ធកាត់ទុក', en: 'Tax withheld' },
  total: { km: 'សរុប', en: 'Total' },
  tin: { km: 'លេខ TIN', en: 'TIN' },
  signature: { km: 'ហត្ថលេខា និងត្រា', en: 'Signature and seal' },
};
