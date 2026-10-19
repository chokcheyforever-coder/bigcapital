import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Knex } from 'knex';
import { events } from '@/common/events/events';
import { ControlledType } from '../calc/control';
import { BudgetControlService } from './BudgetControl.service';

type Payload = { trx?: Knex.Transaction };

/**
 * Budget spending control on bills, expenses and manual journals (design §13).
 * "-ing" events take the control lock before any ledger row is written;
 * "-ed" events check the saved document if it posts (drafts are commitments,
 * not checked). Errors must reach the caller so the document rolls back.
 */
@Injectable()
export class BudgetControlSubscriber {
  constructor(private readonly control: BudgetControlService) {}

  @OnEvent(events.bill.onCreating, { suppressErrors: false })
  @OnEvent(events.bill.onEditing, { suppressErrors: false })
  @OnEvent(events.bill.onOpening, { suppressErrors: false })
  @OnEvent(events.expenses.onCreating, { suppressErrors: false })
  @OnEvent(events.expenses.onEditing, { suppressErrors: false })
  @OnEvent(events.expenses.onPublishing, { suppressErrors: false })
  @OnEvent(events.manualJournals.onCreating, { suppressErrors: false })
  @OnEvent(events.manualJournals.onEditing, { suppressErrors: false })
  @OnEvent(events.manualJournals.onPublishing, { suppressErrors: false })
  async lock({ trx }: Payload) {
    await this.control.acquire(trx);
  }

  @OnEvent(events.bill.onCreated, { suppressErrors: false })
  @OnEvent(events.bill.onEdited, { suppressErrors: false })
  @OnEvent(events.bill.onOpened, { suppressErrors: false })
  async bill({ bill, trx }: Payload & { bill: { id: number; openedAt?: unknown } }) {
    if (bill?.openedAt) await this.check('bill', bill.id, trx);
  }

  @OnEvent(events.expenses.onCreated, { suppressErrors: false })
  @OnEvent(events.expenses.onEdited, { suppressErrors: false })
  @OnEvent(events.expenses.onPublished, { suppressErrors: false })
  async expense({ expense, trx }: Payload & { expense: { id: number; publishedAt?: unknown } }) {
    if (expense?.publishedAt) await this.check('expense', expense.id, trx);
  }

  @OnEvent(events.manualJournals.onCreated, { suppressErrors: false })
  @OnEvent(events.manualJournals.onEdited, { suppressErrors: false })
  @OnEvent(events.manualJournals.onPublished, { suppressErrors: false })
  async manualJournal({ manualJournal, trx }: Payload & { manualJournal: { id: number; publishedAt?: unknown } }) {
    if (manualJournal?.publishedAt) await this.check('manual_journal', manualJournal.id, trx);
  }

  private async check(type: ControlledType, id: number, trx?: Knex.Transaction) {
    // Outside a transaction there is nothing to roll back; documents always post in one.
    if (trx) await this.control.enforce(type, id, trx);
  }
}
