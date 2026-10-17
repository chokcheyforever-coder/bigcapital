import { Inject, Injectable } from '@nestjs/common';
import { Knex } from 'knex';
import * as moment from 'moment';
import { TenantModelProxy } from '@/modules/System/models/TenantBaseModel';
import { BillGLEntries } from '@/modules/Bills/commands/BillsGLEntries';
import { ExpenseGLEntriesService } from '@/modules/Expenses/subscribers/ExpenseGLEntries.service';
import { ManualJournalGL } from '@/modules/ManualJournals/commands/ManualJournalGL';
import { ManualJournal } from '@/modules/ManualJournals/models/ManualJournal';
import { Bill } from '@/modules/Bills/models/Bill';
import { Expense } from '@/modules/Expenses/models/Expense.model';
import { ILedger } from '@/modules/Ledger/types/Ledger.types';
import { toMilli } from '../calc/budget-calc';
import { ControlledType, LedgerLeg } from '../calc/control';

/**
 * The ledger a document posts (or would post), built by the document's own GL
 * builder, so budget control sees exactly what the ledger will hold.
 */
@Injectable()
export class BudgetDocumentLedgerService {
  constructor(
    private readonly billGL: BillGLEntries,
    private readonly expenseGL: ExpenseGLEntriesService,
    @Inject(Bill.name) private readonly billModel: TenantModelProxy<typeof Bill>,
    @Inject(Expense.name) private readonly expenseModel: TenantModelProxy<typeof Expense>,
    @Inject(ManualJournal.name) private readonly journalModel: TenantModelProxy<typeof ManualJournal>,
  ) {}

  async legs(type: ControlledType, id: number, trx?: Knex.Transaction): Promise<LedgerLeg[]> {
    return toLegs(await this.ledger(type, id, trx));
  }

  /** Whether the document posts to the ledger (open bill, published expense or journal). */
  async isPosted(type: ControlledType, id: number, trx?: Knex.Transaction): Promise<boolean | null> {
    if (type === 'bill') {
      const bill = await this.billModel().query(trx).findById(id);
      return bill ? !!bill.openedAt : null;
    }
    if (type === 'expense') {
      const expense = await this.expenseModel().query(trx).findById(id);
      return expense ? !!expense.publishedAt : null;
    }
    const journal = await this.journalModel().query(trx).findById(id);
    return journal ? !!journal.publishedAt : null;
  }

  /**
   * Open commitments: legs of draft bills and draft expenses dated in the
   * range, except the document being checked.
   */
  async draftLegs(fromDate: string, toDate: string, except: { type: ControlledType; id: number } | null, trx?: Knex.Transaction): Promise<LedgerLeg[]> {
    const bills = await this.billModel()
      .query(trx)
      .whereNull('openedAt')
      .whereBetween('billDate', [fromDate, toDate])
      .select('id');
    const expenses = await this.expenseModel()
      .query(trx)
      .whereNull('publishedAt')
      .whereBetween('paymentDate', [fromDate, toDate])
      .select('id');
    const legs: LedgerLeg[] = [];
    for (const { id } of bills) {
      if (except?.type === 'bill' && except.id === id) continue;
      legs.push(...toLegs(await this.billGL.getBillLedger(id, trx)));
    }
    for (const { id } of expenses) {
      if (except?.type === 'expense' && except.id === id) continue;
      legs.push(...toLegs(await this.expenseGL.getExpenseLedgerById(id, trx)));
    }
    return legs;
  }

  private async ledger(type: ControlledType, id: number, trx?: Knex.Transaction): Promise<ILedger> {
    if (type === 'bill') return this.billGL.getBillLedger(id, trx);
    if (type === 'expense') return this.expenseGL.getExpenseLedgerById(id, trx);
    const journal = await this.journalModel().query(trx).findById(id).withGraphFetched('entries.account').throwIfNotFound();
    return new ManualJournalGL(journal).getManualJournalGLedger();
  }
}

export const toLegs = (ledger: ILedger): LedgerLeg[] =>
  ledger.getEntries().map((e) => ({
    accountId: e.accountId as number,
    branchId: e.branchId ?? null,
    projectId: e.projectId ?? null,
    month: moment(e.date).format('YYYY-MM-01'),
    debit: toMilli(Number(e.debit || 0).toFixed(3)),
    credit: toMilli(Number(e.credit || 0).toFixed(3)),
  }));
