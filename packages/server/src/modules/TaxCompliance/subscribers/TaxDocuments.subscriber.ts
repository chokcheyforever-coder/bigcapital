import { Inject, Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Knex } from 'knex';
import * as moment from 'moment';
import { events } from '@/common/events/events';
import { ServiceError } from '@/modules/Items/ServiceError';
import { TENANCY_DB_CONNECTION } from '@/modules/Tenancy/TenancyDB/TenancyDB.constants';
import { TenancyContext } from '@/modules/Tenancy/TenancyContext.service';
import { TaxProfileService } from '../TaxProfile.service';
import { documentKind, DocumentKind, issueProblems } from '../calc/compliance';

type DocType = 'SaleInvoice' | 'SaleReceipt' | 'CreditNote';

const DOCS: Record<DocType, { table: string; date: string; issued: string; byKind: boolean }> = {
  SaleInvoice: { table: 'sales_invoices', date: 'invoice_date', issued: 'delivered_at', byKind: true },
  // Receipts have no tax lines, so they cannot itemise VAT: always commercial
  // invoices. A VAT invoice for a cash sale is an invoice plus a payment.
  SaleReceipt: { table: 'sales_receipts', date: 'receipt_date', issued: 'closed_at', byKind: false },
  // A credit note is always titled as such; the buyer's TIN is not required.
  CreditNote: { table: 'credit_notes', date: 'credit_note_date', issued: 'opened_at', byKind: false },
};

const camel = (s: string) => s.replace(/_([a-z])/g, (_m, c) => c.toUpperCase());
const dateOnly = (d: unknown) => (d ? moment(d as any).format('YYYY-MM-DD') : moment().format('YYYY-MM-DD'));

export const ERRORS = {
  ISSUED_DOCUMENT_DELETE: 'TAX_DOCUMENT_ISSUED',
};

/**
 * Cambodian tax documents, when the company has switched them on in its tax
 * profile (nothing changes for other companies):
 * - issuing (delivering an invoice, closing a receipt, opening a credit note)
 *   is refused while the seller TIN, the buyer TIN of a VAT invoice or the
 *   riel rate is missing;
 * - each saved document records the type it was issued as and the riel rate,
 *   so the printed document never changes afterwards;
 * - an issued document cannot be deleted (a credit note corrects it).
 */
@Injectable()
export class TaxDocumentsSubscriber {
  constructor(
    private readonly profiles: TaxProfileService,
    private readonly tenancyContext: TenancyContext,

    @Inject(TENANCY_DB_CONNECTION)
    private readonly tenantKnex: () => Knex,
  ) {}

  private async contact(id: number | undefined, trx?: Knex.Transaction) {
    if (!id) return null;
    const row = await (trx ?? this.tenantKnex())('contacts').where('id', id).first('tax_number', 'registered_taxpayer', 'currency_code');
    if (!row) return null;
    return {
      taxNumber: row.taxNumber ?? row.tax_number ?? null,
      registeredTaxpayer: !!(row.registeredTaxpayer ?? row.registered_taxpayer),
      currencyCode: row.currencyCode ?? row.currency_code ?? null,
    };
  }

  /** The organization's base currency, for contacts saved without one. */
  private async baseCurrency(_trx?: Knex.Transaction): Promise<string | null> {
    return (await this.tenancyContext.getTenantMetadata())?.baseCurrency ?? null;
  }

  /** Refuses to issue a document that would not be a valid tax document. */
  private async checkIssue(doc: DocType, customerId: number | undefined, date: unknown, trx?: Knex.Transaction) {
    const profile = await this.profiles.get(trx);
    if (!profile.enabled) return;
    const buyer = await this.contact(customerId, trx);
    const currency = buyer?.currencyCode ?? (await this.baseCurrency(trx));
    const kind: DocumentKind = DOCS[doc].byKind ? documentKind(profile, buyer) : 'commercial_invoice';
    const rate = await this.profiles.khrRate(currency ?? 'KHR', dateOnly(date), profile);
    const problems = issueProblems({
      kind,
      seller: profile,
      buyer,
      foreignCurrency: !!currency && currency.toUpperCase() !== 'KHR',
      khrRate: rate?.rate ?? null,
    });
    if (problems.length > 0) {
      throw new ServiceError(problems[0].code, problems.map((p) => p.message).join(' '), { problems });
    }
  }

  /** Records the document type and riel rate on the saved document (kept once issued). */
  private async stamp(doc: DocType, id: number | undefined, trx?: Knex.Transaction) {
    if (!id) return;
    const profile = await this.profiles.get(trx);
    if (!profile.enabled) return;
    const def = DOCS[doc];
    const knex = trx ?? this.tenantKnex();
    const row = await knex(def.table)
      .where('id', id)
      .first('customer_id', def.date, def.issued, 'currency_code', 'khr_rate', 'khr_rate_source', 'khr_rate_date', 'document_kind');
    if (!row) return;
    const get = (col: string) => row[camel(col)] ?? row[col];
    const buyer = await this.contact(get('customer_id'), trx);
    const currency = get('currency_code') ?? buyer?.currencyCode ?? (await this.baseCurrency(trx));
    const date = dateOnly(get(def.date));
    const issued = !!get(def.issued);
    const kind = def.byKind ? documentKind(profile, buyer) : null;

    // Once issued with a rate, the printed riel amounts must not change.
    const keepRate = issued && get('khr_rate') != null;
    const rate = keepRate ? null : await this.profiles.khrRate(currency ?? 'KHR', date, profile);
    await knex(def.table)
      .where('id', id)
      .update({
        document_kind: issued && get('document_kind') ? get('document_kind') : kind,
        ...(keepRate
          ? {}
          : { khr_rate: rate?.rate ?? null, khr_rate_source: rate?.source ?? null, khr_rate_date: rate?.date ?? null }),
      });
  }

  private async refuseDelete(issuedAt: unknown, trx?: Knex.Transaction) {
    if (!issuedAt) return;
    const profile = await this.profiles.get(trx);
    if (!profile.enabled) return;
    throw new ServiceError(ERRORS.ISSUED_DOCUMENT_DELETE, 'An issued tax document cannot be deleted. Issue a credit note to cancel it.');
  }

  // --- Invoices ---
  @OnEvent(events.saleInvoice.onCreating, { suppressErrors: false })
  async onInvoiceCreating({ saleInvoiceDTO, trx }) {
    if (saleInvoiceDTO?.delivered) await this.checkIssue('SaleInvoice', saleInvoiceDTO.customerId, saleInvoiceDTO.invoiceDate, trx);
  }

  @OnEvent(events.saleInvoice.onEditing, { suppressErrors: false })
  async onInvoiceEditing({ saleInvoiceDTO, oldSaleInvoice, trx }) {
    if (saleInvoiceDTO?.delivered && !oldSaleInvoice?.deliveredAt) {
      await this.checkIssue('SaleInvoice', saleInvoiceDTO.customerId, saleInvoiceDTO.invoiceDate, trx);
    }
  }

  @OnEvent(events.saleInvoice.onDelivering, { suppressErrors: false })
  async onInvoiceDelivering({ oldSaleInvoice, trx }) {
    await this.checkIssue('SaleInvoice', oldSaleInvoice?.customerId, oldSaleInvoice?.invoiceDate, trx);
  }

  @OnEvent(events.saleInvoice.onCreated, { suppressErrors: false })
  @OnEvent(events.saleInvoice.onEdited, { suppressErrors: false })
  @OnEvent(events.saleInvoice.onDelivered, { suppressErrors: false })
  async onInvoiceSaved({ saleInvoice, saleInvoiceId, trx }) {
    await this.stamp('SaleInvoice', saleInvoice?.id ?? saleInvoiceId, trx);
  }

  @OnEvent(events.saleInvoice.onDeleting, { suppressErrors: false })
  async onInvoiceDeleting({ oldSaleInvoice, trx }) {
    await this.refuseDelete(oldSaleInvoice?.deliveredAt, trx);
  }

  // --- Sales receipts ---
  @OnEvent(events.saleReceipt.onCreating, { suppressErrors: false })
  async onReceiptCreating({ saleReceiptDTO, trx }) {
    if (saleReceiptDTO?.closed) await this.checkIssue('SaleReceipt', saleReceiptDTO.customerId, saleReceiptDTO.receiptDate, trx);
  }

  @OnEvent(events.saleReceipt.onEditing, { suppressErrors: false })
  async onReceiptEditing({ saleReceiptDTO, oldSaleReceipt, trx }) {
    if (saleReceiptDTO?.closed && !oldSaleReceipt?.closedAt) {
      await this.checkIssue('SaleReceipt', saleReceiptDTO.customerId, saleReceiptDTO.receiptDate, trx);
    }
  }

  @OnEvent(events.saleReceipt.onClosing, { suppressErrors: false })
  async onReceiptClosing({ oldSaleReceipt, trx }) {
    await this.checkIssue('SaleReceipt', oldSaleReceipt?.customerId, oldSaleReceipt?.receiptDate, trx);
  }

  @OnEvent(events.saleReceipt.onCreated, { suppressErrors: false })
  @OnEvent(events.saleReceipt.onEdited, { suppressErrors: false })
  @OnEvent(events.saleReceipt.onClosed, { suppressErrors: false })
  async onReceiptSaved({ saleReceipt, saleReceiptId, trx }) {
    await this.stamp('SaleReceipt', saleReceipt?.id ?? saleReceiptId, trx);
  }

  @OnEvent(events.saleReceipt.onDeleting, { suppressErrors: false })
  async onReceiptDeleting({ oldSaleReceipt, trx }) {
    await this.refuseDelete(oldSaleReceipt?.closedAt, trx);
  }

  // --- Credit notes ---
  @OnEvent(events.creditNote.onCreating, { suppressErrors: false })
  async onCreditNoteCreating({ creditNoteDTO, trx }) {
    if (creditNoteDTO?.open) await this.checkIssue('CreditNote', creditNoteDTO.customerId, creditNoteDTO.creditNoteDate, trx);
  }

  @OnEvent(events.creditNote.onEditing, { suppressErrors: false })
  async onCreditNoteEditing({ creditNoteEditDTO, oldCreditNote, trx }) {
    if (creditNoteEditDTO?.open && !oldCreditNote?.openedAt) {
      await this.checkIssue('CreditNote', creditNoteEditDTO.customerId, creditNoteEditDTO.creditNoteDate, trx);
    }
  }

  @OnEvent(events.creditNote.onOpening, { suppressErrors: false })
  async onCreditNoteOpening({ oldCreditNote, trx }) {
    await this.checkIssue('CreditNote', oldCreditNote?.customerId, oldCreditNote?.creditNoteDate, trx);
  }

  @OnEvent(events.creditNote.onCreated, { suppressErrors: false })
  @OnEvent(events.creditNote.onEdited, { suppressErrors: false })
  @OnEvent(events.creditNote.onOpened, { suppressErrors: false })
  async onCreditNoteSaved({ creditNote, creditNoteId, trx }) {
    await this.stamp('CreditNote', creditNote?.id ?? creditNoteId, trx);
  }

  @OnEvent(events.creditNote.onDeleting, { suppressErrors: false })
  async onCreditNoteDeleting({ oldCreditNote, trx }) {
    await this.refuseDelete(oldCreditNote?.openedAt, trx);
  }
}
