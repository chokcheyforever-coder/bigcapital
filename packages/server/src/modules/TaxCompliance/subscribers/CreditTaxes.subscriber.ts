import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { events } from '@/common/events/events';
import { CommandTaxRatesValidators } from '@/modules/TaxRates/commands/CommandTaxRatesValidator.service';
import { WriteTaxTransactionsItemEntries } from '@/modules/TaxRates/WriteTaxTransactionsItemEntries';
import {
  ICreditNoteCreatedPayload,
  ICreditNoteCreatingPayload,
  ICreditNoteDeletedPayload,
  ICreditNoteEditedPayload,
  ICreditNoteEditingPayload,
} from '@/modules/CreditNotes/types/CreditNotes.types';
import {
  IVendorCreditCreatedPayload,
  IVendorCreditCreatingPayload,
  IVendorCreditDeletedPayload,
  IVendorCreditEditedPayload,
  IVendorCreditEditingPayload,
} from '@/modules/VendorCredit/types/VendorCredit.types';

/**
 * VAT on credit notes and vendor credits (DiTech compliance gaps G2), as the
 * TaxRates subscribers do for invoices and bills: the lines' tax rates must
 * exist, and the rates used are recorded as tax rate transactions.
 */
@Injectable()
export class CreditTaxesSubscriber {
  constructor(
    private readonly validators: CommandTaxRatesValidators,
    private readonly taxTransactions: WriteTaxTransactionsItemEntries,
  ) {}

  private async validate(entries: any[]) {
    await this.validators.validateItemEntriesTaxCode(entries);
    await this.validators.validateItemEntriesTaxCodeId(entries);
  }

  @OnEvent(events.creditNote.onCreating, { suppressErrors: false })
  async validateCreditNoteOnCreating({ creditNoteDTO }: ICreditNoteCreatingPayload) {
    await this.validate(creditNoteDTO.entries);
  }

  @OnEvent(events.creditNote.onEditing, { suppressErrors: false })
  async validateCreditNoteOnEditing({ creditNoteEditDTO }: ICreditNoteEditingPayload) {
    await this.validate(creditNoteEditDTO.entries);
  }

  @OnEvent(events.creditNote.onCreated)
  async writeCreditNoteTaxes({ creditNote, trx }: ICreditNoteCreatedPayload) {
    await this.taxTransactions.writeTaxTransactionsFromItemEntries(creditNote.entries, trx);
  }

  @OnEvent(events.creditNote.onEdited)
  async rewriteCreditNoteTaxes({ creditNote, trx }: ICreditNoteEditedPayload) {
    await this.taxTransactions.rewriteTaxRateTransactionsFromItemEntries(creditNote.entries, 'CreditNote', creditNote.id, trx);
  }

  @OnEvent(events.creditNote.onDeleted)
  async removeCreditNoteTaxes({ oldCreditNote, trx }: ICreditNoteDeletedPayload) {
    await this.taxTransactions.removeTaxTransactionsFromItemEntries(oldCreditNote.id, 'CreditNote', trx);
  }

  @OnEvent(events.vendorCredit.onCreating, { suppressErrors: false })
  async validateVendorCreditOnCreating({ vendorCreditCreateDTO }: IVendorCreditCreatingPayload) {
    await this.validate(vendorCreditCreateDTO.entries);
  }

  @OnEvent(events.vendorCredit.onEditing, { suppressErrors: false })
  async validateVendorCreditOnEditing({ vendorCreditDTO }: IVendorCreditEditingPayload) {
    await this.validate(vendorCreditDTO.entries);
  }

  @OnEvent(events.vendorCredit.onCreated)
  async writeVendorCreditTaxes({ vendorCredit, trx }: IVendorCreditCreatedPayload) {
    await this.taxTransactions.writeTaxTransactionsFromItemEntries(vendorCredit.entries, trx);
  }

  @OnEvent(events.vendorCredit.onEdited)
  async rewriteVendorCreditTaxes({ vendorCredit, trx }: IVendorCreditEditedPayload) {
    await this.taxTransactions.rewriteTaxRateTransactionsFromItemEntries(vendorCredit.entries, 'VendorCredit', vendorCredit.id, trx);
  }

  @OnEvent(events.vendorCredit.onDeleted)
  async removeVendorCreditTaxes({ oldVendorCredit, trx }: IVendorCreditDeletedPayload) {
    await this.taxTransactions.removeTaxTransactionsFromItemEntries(oldVendorCredit.id, 'VendorCredit', trx);
  }
}
