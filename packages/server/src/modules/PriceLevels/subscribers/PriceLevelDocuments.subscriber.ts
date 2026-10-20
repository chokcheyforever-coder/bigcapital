import { Inject, Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Knex } from 'knex';
import { events } from '@/common/events/events';
import { TENANCY_DB_CONNECTION } from '@/modules/Tenancy/TenancyDB/TenancyDB.constants';
import { PriceLevelValidator } from '../commands/PriceLevelValidator.service';
import { DOCUMENT_TYPES, PriceDocumentType, PriceLevelType } from '../PriceLevels.types';

type WithLevel = { priceLevelId?: number | null } | undefined;
type Saved = { id: number } | undefined;

/**
 * Price levels on customers, vendors and sales/purchase documents:
 * - while saving (inside the record's transaction), the level must exist, be
 *   of the right type and, for new use, be active;
 * - after a document is saved, each line records the item's normal price, so
 *   reports can show the discount (or markup) a price level gave.
 * Rates themselves are never changed here: the document keeps what was sent.
 */
@Injectable()
export class PriceLevelDocumentsSubscriber {
  constructor(
    private readonly validator: PriceLevelValidator,

    @Inject(TENANCY_DB_CONNECTION)
    private readonly tenantKnex: () => Knex,
  ) {}

  private check(dto: WithLevel, type: PriceLevelType, currentId: number | null | undefined, trx?: Knex.Transaction) {
    return this.validator.validateUse(dto?.priceLevelId, type, currentId, trx);
  }

  private async contactLevel(contactId: number | undefined, trx?: Knex.Transaction) {
    if (!contactId) return null;
    const row = await (trx ?? this.tenantKnex())('contacts').where('id', contactId).first('price_level_id');
    return row ? row.priceLevelId ?? row.price_level_id ?? null : null;
  }

  /** Stores the normal item price on each line of a document that used a price level (clears it otherwise). */
  private async stampStandardRates(type: PriceDocumentType, doc: Saved, trx?: Knex.Transaction) {
    if (!doc?.id) return;
    const knex = trx ?? this.tenantKnex();
    // Read back: an edit that leaves the field out keeps the stored level.
    const row = await knex(DOCUMENT_TYPES[type].table).where('id', doc.id).first('price_level_id');
    // Raw SQL bypasses the identifier mapper: tenant tables and columns are UPPER_SNAKE.
    if (row?.priceLevelId ?? row?.price_level_id) {
      const price = DOCUMENT_TYPES[type].basePrice === 'sellPrice' ? 'I.SELL_PRICE' : 'I.COST_PRICE';
      await knex.raw(
        `UPDATE ITEMS_ENTRIES IE JOIN ITEMS I ON I.ID = IE.ITEM_ID
         SET IE.STANDARD_RATE = ${price}
         WHERE IE.REFERENCE_TYPE = ? AND IE.REFERENCE_ID = ?`,
        [type, doc.id],
      );
    } else {
      await knex.raw('UPDATE ITEMS_ENTRIES SET STANDARD_RATE = NULL WHERE REFERENCE_TYPE = ? AND REFERENCE_ID = ? AND STANDARD_RATE IS NOT NULL', [type, doc.id]);
    }
  }

  // --- Customers and vendors ---
  @OnEvent(events.customers.onCreating, { suppressErrors: false })
  async onCustomerCreating({ customerDTO, trx }) {
    await this.check(customerDTO, 'sales', null, trx);
  }

  @OnEvent(events.customers.onEditing, { suppressErrors: false })
  async onCustomerEditing({ customerDTO, customerId, trx }) {
    await this.check(customerDTO, 'sales', await this.contactLevel(customerId, trx), trx);
  }

  @OnEvent(events.vendors.onCreating, { suppressErrors: false })
  async onVendorCreating({ vendorDTO, trx }) {
    await this.check(vendorDTO, 'purchase', null, trx);
  }

  @OnEvent(events.vendors.onEditing, { suppressErrors: false })
  async onVendorEditing({ vendorDTO, vendorId, trx }) {
    await this.check(vendorDTO, 'purchase', await this.contactLevel(vendorId, trx), trx);
  }

  // --- Sales documents ---
  @OnEvent(events.saleEstimate.onCreating, { suppressErrors: false })
  async onEstimateCreating({ estimateDTO, trx }) {
    await this.check(estimateDTO, 'sales', null, trx);
  }

  @OnEvent(events.saleEstimate.onEditing, { suppressErrors: false })
  async onEstimateEditing({ estimateDTO, oldSaleEstimate, trx }) {
    await this.check(estimateDTO, 'sales', oldSaleEstimate?.priceLevelId, trx);
  }

  @OnEvent(events.saleEstimate.onCreated)
  @OnEvent(events.saleEstimate.onEdited)
  async onEstimateSaved({ saleEstimate, trx }) {
    await this.stampStandardRates('SaleEstimate', saleEstimate, trx);
  }

  @OnEvent(events.saleInvoice.onCreating, { suppressErrors: false })
  async onInvoiceCreating({ saleInvoiceDTO, trx }) {
    await this.check(saleInvoiceDTO, 'sales', null, trx);
  }

  @OnEvent(events.saleInvoice.onEditing, { suppressErrors: false })
  async onInvoiceEditing({ saleInvoiceDTO, oldSaleInvoice, trx }) {
    await this.check(saleInvoiceDTO, 'sales', oldSaleInvoice?.priceLevelId, trx);
  }

  @OnEvent(events.saleInvoice.onCreated)
  @OnEvent(events.saleInvoice.onEdited)
  async onInvoiceSaved({ saleInvoice, trx }) {
    await this.stampStandardRates('SaleInvoice', saleInvoice, trx);
  }

  @OnEvent(events.saleReceipt.onCreating, { suppressErrors: false })
  async onReceiptCreating({ saleReceiptDTO, trx }) {
    await this.check(saleReceiptDTO, 'sales', null, trx);
  }

  @OnEvent(events.saleReceipt.onEditing, { suppressErrors: false })
  async onReceiptEditing({ saleReceiptDTO, oldSaleReceipt, trx }) {
    await this.check(saleReceiptDTO, 'sales', oldSaleReceipt?.priceLevelId, trx);
  }

  @OnEvent(events.saleReceipt.onCreated)
  @OnEvent(events.saleReceipt.onEdited)
  async onReceiptSaved({ saleReceipt, trx }) {
    await this.stampStandardRates('SaleReceipt', saleReceipt, trx);
  }

  @OnEvent(events.creditNote.onCreating, { suppressErrors: false })
  async onCreditNoteCreating({ creditNoteDTO, trx }) {
    await this.check(creditNoteDTO, 'sales', null, trx);
  }

  @OnEvent(events.creditNote.onEditing, { suppressErrors: false })
  async onCreditNoteEditing({ creditNoteEditDTO, oldCreditNote, trx }) {
    await this.check(creditNoteEditDTO, 'sales', oldCreditNote?.priceLevelId, trx);
  }

  @OnEvent(events.creditNote.onCreated)
  @OnEvent(events.creditNote.onEdited)
  async onCreditNoteSaved({ creditNote, trx }) {
    await this.stampStandardRates('CreditNote', creditNote, trx);
  }

  // --- Purchase documents ---
  @OnEvent(events.bill.onCreating, { suppressErrors: false })
  async onBillCreating({ billDTO, trx }) {
    await this.check(billDTO, 'purchase', null, trx);
  }

  @OnEvent(events.bill.onEditing, { suppressErrors: false })
  async onBillEditing({ billDTO, oldBill, trx }) {
    await this.check(billDTO, 'purchase', oldBill?.priceLevelId, trx);
  }

  @OnEvent(events.bill.onCreated)
  @OnEvent(events.bill.onEdited)
  async onBillSaved({ bill, trx }) {
    await this.stampStandardRates('Bill', bill, trx);
  }

  @OnEvent(events.vendorCredit.onCreating, { suppressErrors: false })
  async onVendorCreditCreating({ vendorCreditCreateDTO, trx }) {
    await this.check(vendorCreditCreateDTO, 'purchase', null, trx);
  }

  @OnEvent(events.vendorCredit.onEditing, { suppressErrors: false })
  async onVendorCreditEditing({ vendorCreditDTO, oldVendorCredit, trx }) {
    await this.check(vendorCreditDTO, 'purchase', oldVendorCredit?.priceLevelId, trx);
  }

  @OnEvent(events.vendorCredit.onCreated)
  @OnEvent(events.vendorCredit.onEdited)
  async onVendorCreditSaved({ vendorCredit, trx }) {
    await this.stampStandardRates('VendorCredit', vendorCredit, trx);
  }
}
