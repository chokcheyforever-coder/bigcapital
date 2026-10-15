import { Inject, Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Knex } from 'knex';
import { events } from '@/common/events/events';
import { TENANCY_DB_CONNECTION } from '@/modules/Tenancy/TenancyDB/TenancyDB.constants';
import { ProjectValidator } from '../commands/ProjectValidator.service';

type WithProject = { projectId?: number | null };
type Old = { id: number; projectId?: number | null } | undefined;

/**
 * Validates the project on every document and journal line that can carry one,
 * inside the document's transaction: it must exist and, for new use, be active.
 * Editing keeps working for projects the document already used, even if closed.
 */
@Injectable()
export class ProjectTransactionsValidatorSubscriber {
  constructor(
    private readonly validator: ProjectValidator,

    @Inject(TENANCY_DB_CONNECTION)
    private readonly tenantKnex: () => Knex,
  ) {}

  private header(dto: WithProject, old: Old, trx?: Knex.Transaction) {
    return this.validator.validateTransactionProjects([dto?.projectId], [old?.projectId], trx);
  }

  private async lines(
    lines: WithProject[] | undefined,
    oldId: number | undefined,
    table: string,
    foreignKey: string,
    trx?: Knex.Transaction,
  ) {
    const allowed = oldId
      ? (await (trx ?? this.tenantKnex())(table).where(foreignKey, oldId).whereNotNull('project_id').select('project_id')).map(
          // The tenant knex maps column names back to camelCase.
          (r: { projectId?: number; project_id?: number }) => r.projectId ?? r.project_id,
        )
      : [];
    return this.validator.validateTransactionProjects((lines ?? []).map((l) => l.projectId), allowed, trx);
  }

  // --- Sales ---
  @OnEvent(events.saleInvoice.onCreating, { suppressErrors: false })
  async onInvoiceCreating({ saleInvoiceDTO, trx }) {
    await this.header(saleInvoiceDTO, undefined, trx);
  }

  @OnEvent(events.saleInvoice.onEditing, { suppressErrors: false })
  async onInvoiceEditing({ saleInvoiceDTO, oldSaleInvoice, trx }) {
    await this.header(saleInvoiceDTO, oldSaleInvoice, trx);
  }

  @OnEvent(events.saleReceipt.onCreating, { suppressErrors: false })
  async onReceiptCreating({ saleReceiptDTO, trx }) {
    await this.header(saleReceiptDTO, undefined, trx);
  }

  @OnEvent(events.saleReceipt.onEditing, { suppressErrors: false })
  async onReceiptEditing({ saleReceiptDTO, oldSaleReceipt, trx }) {
    await this.header(saleReceiptDTO, oldSaleReceipt, trx);
  }

  @OnEvent(events.creditNote.onCreating, { suppressErrors: false })
  async onCreditNoteCreating({ creditNoteDTO, trx }) {
    await this.header(creditNoteDTO, undefined, trx);
  }

  @OnEvent(events.creditNote.onEditing, { suppressErrors: false })
  async onCreditNoteEditing({ creditNoteEditDTO, oldCreditNote, trx }) {
    await this.header(creditNoteEditDTO, oldCreditNote, trx);
  }

  // --- Purchases ---
  @OnEvent(events.bill.onCreating, { suppressErrors: false })
  async onBillCreating({ billDTO, trx }) {
    await this.header(billDTO, undefined, trx);
  }

  @OnEvent(events.bill.onEditing, { suppressErrors: false })
  async onBillEditing({ billDTO, oldBill, trx }) {
    await this.header(billDTO, oldBill, trx);
  }

  @OnEvent(events.vendorCredit.onCreating, { suppressErrors: false })
  async onVendorCreditCreating({ vendorCreditCreateDTO, trx }) {
    await this.header(vendorCreditCreateDTO, undefined, trx);
  }

  @OnEvent(events.vendorCredit.onEditing, { suppressErrors: false })
  async onVendorCreditEditing({ vendorCreditDTO, oldVendorCredit, trx }) {
    await this.header(vendorCreditDTO, oldVendorCredit, trx);
  }

  // --- Line-level: expenses and manual journals ---
  @OnEvent(events.expenses.onCreating, { suppressErrors: false })
  async onExpenseCreating({ expenseDTO, trx }) {
    await this.lines(expenseDTO?.categories, undefined, 'expense_transaction_categories', 'expense_id', trx);
  }

  @OnEvent(events.expenses.onEditing, { suppressErrors: false })
  async onExpenseEditing({ expenseDTO, oldExpense, trx }) {
    await this.lines(expenseDTO?.categories, oldExpense?.id, 'expense_transaction_categories', 'expense_id', trx);
  }

  @OnEvent(events.manualJournals.onCreating, { suppressErrors: false })
  async onManualJournalCreating({ manualJournalDTO, trx }) {
    await this.lines(manualJournalDTO?.entries, undefined, 'manual_journals_entries', 'manual_journal_id', trx);
  }

  @OnEvent(events.manualJournals.onEditing, { suppressErrors: false })
  async onManualJournalEditing({ manualJournalDTO, oldManualJournal, trx }) {
    await this.lines(manualJournalDTO?.entries, oldManualJournal?.id, 'manual_journals_entries', 'manual_journal_id', trx);
  }
}
