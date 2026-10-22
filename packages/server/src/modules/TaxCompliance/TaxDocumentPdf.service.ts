import { Inject, Injectable } from '@nestjs/common';
import { Knex } from 'knex';
import * as moment from 'moment';
import { TenancyContext } from '@/modules/Tenancy/TenancyContext.service';
import { TENANCY_DB_CONNECTION } from '@/modules/Tenancy/TenancyDB/TenancyDB.constants';
import { TaxProfileService } from './TaxProfile.service';
import { label, LABELS, RATE_SOURCE_LABELS, RateSource, TITLES, toKhr } from './calc/compliance';

/** What the paper templates print for a Cambodian tax document (see shared/pdf-templates Compliance). */
export interface ComplianceAttributes {
  language: 'km_en' | 'km' | 'en';
  title: string;
  subtitle?: string;
  seller: { name: string; nameKm?: string | null; address?: string | null; addressKm?: string | null; tin?: string | null };
  buyer: { name: string; nameKm?: string | null; address?: string | null; addressKm?: string | null; tin?: string | null };
  labels: Record<string, string>;
  khr?: { rate: string; source: string; date: string; subtotal: string; tax: string; total: string; label: string };
  signatory?: { name?: string | null; title?: string | null };
}

type DocType = 'SaleInvoice' | 'SaleReceipt' | 'CreditNote';
const TABLES: Record<DocType, string> = { SaleInvoice: 'sales_invoices', SaleReceipt: 'sales_receipts', CreditNote: 'credit_notes' };
const riel = (n: number) => `${n.toLocaleString('en-US')} ៛`;

@Injectable()
export class TaxDocumentPdfService {
  constructor(
    private readonly profiles: TaxProfileService,
    private readonly tenancyContext: TenancyContext,

    @Inject(TENANCY_DB_CONNECTION)
    private readonly tenantKnex: () => Knex,
  ) {}

  /**
   * The compliance block of a document's PDF, or undefined when the company
   * has not switched Cambodian tax documents on (the PDF stays as before).
   * `amounts` are in the document currency: total payable and tax in it.
   */
  async attributes(doc: DocType, id: number, amounts: { total: number; tax: number }): Promise<ComplianceAttributes | undefined> {
    return (await this.explain(doc, id, amounts)).attributes;
  }

  /** The attributes, or why there are none (profile off, document not found). */
  async explain(doc: DocType, id: number, amounts: { total: number; tax: number }): Promise<{ attributes?: ComplianceAttributes; reason?: string }> {
    const profile = await this.profiles.get();
    if (!profile.enabled) return { reason: 'profile_off' };
    const knex = this.tenantKnex();
    const row = await knex(TABLES[doc])
      .where('id', id)
      .first('customer_id', 'document_kind', 'khr_rate', 'khr_rate_source', 'khr_rate_date', 'currency_code');
    if (!row) return { reason: `not_found:${TABLES[doc]}:${id}` };
    return { attributes: await this.build(doc, row, profile, amounts) };
  }

  /**
   * Sample block for the designer's preview: the company's real profile, a
   * sample registered buyer and today's rate on 1,000 of the base currency
   * with 10% VAT. Undefined when tax documents are off.
   */
  async sample(document: 'invoice' | 'receipt' | 'credit-note' = 'invoice'): Promise<ComplianceAttributes | undefined> {
    const profile = await this.profiles.get();
    if (!profile.enabled) return undefined;
    const metadata = await this.tenancyContext.getTenantMetadata();
    const currency = metadata?.baseCurrency ?? 'USD';
    const today = moment().format('YYYY-MM-DD');
    const rate = await this.profiles.khrRate(currency, today, profile);
    const lang = profile.documentLanguage;
    const total = 1100;
    const tax = 100;
    return {
      language: lang,
      // Receipts print as commercial invoices (no tax lines); credit notes as credit notes.
      title: label(document === 'credit-note' ? TITLES.credit_note : document === 'receipt' ? TITLES.commercial_invoice : TITLES.vat_invoice, lang),
      subtitle: document === 'receipt' ? label(TITLES.receipt, lang) : undefined,
      seller: { name: metadata?.name ?? '', nameKm: profile.companyNameKm, address: profile.addressEn, addressKm: profile.addressKm, tin: profile.tin },
      buyer: { name: 'Sample Customer Co., Ltd.', nameKm: 'ក្រុមហ៊ុន គំរូ', address: 'Phnom Penh', addressKm: 'ភ្នំពេញ', tin: 'K001-000000000' },
      labels: Object.fromEntries(Object.entries(LABELS).map(([k, v]) => [k, label(v, lang)])),
      khr: rate
        ? {
            label: label(LABELS.khr, lang),
            rate: `1 ${currency} = ${riel(rate.rate)}`,
            source: label(RATE_SOURCE_LABELS[rate.source], lang),
            date: rate.date,
            subtotal: riel(toKhr(total - tax, rate.rate)),
            tax: riel(toKhr(tax, rate.rate)),
            total: riel(toKhr(total, rate.rate)),
          }
        : undefined,
      signatory: { name: profile.signatoryName, title: profile.signatoryTitle },
    };
  }

  private async build(doc: DocType, row: any, profile: Awaited<ReturnType<TaxProfileService['get']>>, amounts: { total: number; tax: number }): Promise<ComplianceAttributes> {
    const knex = this.tenantKnex();
    const get = (camel: string, snake: string) => row[camel] ?? row[snake];
    const contact = await knex('contacts')
      .where('id', get('customerId', 'customer_id'))
      // camelCase: the identifier mapper turns billingAddress1 into BILLING_ADDRESS1 (snake_case "billing_address_1" would not match).
      .first('displayName', 'displayNameKm', 'taxNumber', 'billingAddress1', 'billingAddress2', 'billingAddressCity', 'billingAddressCountry', 'billingAddressKm');
    const c = (camel: string, snake: string) => (contact ? contact[camel] ?? contact[snake] : null);
    const metadata = await this.tenancyContext.getTenantMetadata();
    const lang = profile.documentLanguage;
    const kind = get('documentKind', 'document_kind') ?? 'commercial_invoice';

    const titleKey = doc === 'CreditNote' ? 'credit_note' : kind;
    const title = label(TITLES[titleKey], lang);
    const subtitle = doc === 'SaleReceipt' ? label(TITLES.receipt, lang) : undefined;

    const rate = Number(get('khrRate', 'khr_rate') ?? 0);
    const source = get('khrRateSource', 'khr_rate_source') as RateSource | null;
    const total = Number(amounts.total ?? 0);
    const tax = Number(amounts.tax ?? 0);
    const khr =
      rate > 0
        ? {
            label: label(LABELS.khr, lang),
            rate: `1 ${get('currencyCode', 'currency_code') ?? ''} = ${riel(rate)}`.trim(),
            source: source ? label(RATE_SOURCE_LABELS[source], lang) : '',
            date: get('khrRateDate', 'khr_rate_date') ? moment(get('khrRateDate', 'khr_rate_date')).format('YYYY-MM-DD') : '',
            subtotal: riel(toKhr(total - tax, rate)),
            tax: riel(toKhr(tax, rate)),
            total: riel(toKhr(total, rate)),
          }
        : undefined;

    const labels = Object.fromEntries(Object.entries(LABELS).map(([k, v]) => [k, label(v, lang)]));
    const address = [c('billingAddress1', 'billingAddress1'), c('billingAddress2', 'billingAddress2'), c('billingAddressCity', 'billingAddressCity'), c('billingAddressCountry', 'billingAddressCountry')]
      .filter(Boolean)
      .join(', ');
    return {
      language: lang,
      title,
      subtitle,
      seller: {
        name: metadata?.name ?? '',
        nameKm: profile.companyNameKm,
        address: profile.addressEn,
        addressKm: profile.addressKm,
        tin: profile.tin,
      },
      buyer: {
        name: c('displayName', 'display_name') ?? '',
        nameKm: c('displayNameKm', 'display_name_km'),
        address: address || null,
        addressKm: c('billingAddressKm', 'billing_address_km'),
        tin: c('taxNumber', 'tax_number'),
      },
      labels,
      khr,
      signatory: { name: profile.signatoryName, title: profile.signatoryTitle },
    };
  }
}
