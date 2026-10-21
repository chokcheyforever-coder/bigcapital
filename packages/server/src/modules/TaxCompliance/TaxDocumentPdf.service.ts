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
    const profile = await this.profiles.get();
    if (!profile.enabled) return undefined;
    const knex = this.tenantKnex();
    const row = await knex(TABLES[doc])
      .where('id', id)
      .first('customer_id', 'document_kind', 'khr_rate', 'khr_rate_source', 'khr_rate_date', 'currency_code');
    if (!row) return undefined;
    const get = (camel: string, snake: string) => row[camel] ?? row[snake];
    const contact = await knex('contacts')
      .where('id', get('customerId', 'customer_id'))
      .first('display_name', 'display_name_km', 'tax_number', 'billing_address_1', 'billing_address_2', 'billing_address_city', 'billing_address_country', 'billing_address_km');
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
    const address = [c('billingAddress1', 'billing_address_1'), c('billingAddress2', 'billing_address_2'), c('billingAddressCity', 'billing_address_city'), c('billingAddressCountry', 'billing_address_country')]
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
