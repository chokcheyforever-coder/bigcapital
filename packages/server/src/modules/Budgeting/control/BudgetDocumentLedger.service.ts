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

  /** How people know the document: "Bill B-0012", "Expense #31", "Journal MJ-0004". */
  async label(type: ControlledType, id: number, trx?: Knex.Transaction): Promise<string> {
    if (type === 'bill') {
      const bill = await this.billModel().query(trx).findById(id);
      return `Bill ${bill?.billNumber || bill?.referenceNo || `#${id}`}`;
    }
    if (type === 'expense') {
      const expense = await this.expenseModel().query(trx).findById(id);
      return `Expense ${expense?.referenceNo || `#${id}`}`;
    }
    const journal = await this.journalModel().query(trx).findById(id);
    return `Journal ${journal?.journalNumber || `#${id}`}`;
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

  /** Latest draft bills, expenses and manual journals, to pick one for an override request. */
  async recentDrafts(limit = 100) {
    const [bills, expenses, journals] = await Promise.all([
      this.billModel().query().whereNull('openedAt').withGraphFetched('vendor').orderBy('id', 'desc').limit(limit),
      this.expenseModel().query().whereNull('publishedAt').orderBy('id', 'desc').limit(limit),
      this.journalModel().query().whereNull('publishedAt').orderBy('id', 'desc').limit(limit),
    ]);
    const day = (d: unknown) => moment(d as moment.MomentInput).format('YYYY-MM-DD');
    return [
      ...bills.map((b) => ({ type: 'bill' as ControlledType, id: b.id, number: b.billNumber, date: day(b.billDate), amount: Number(b.amount ?? 0), contact: (b as any).vendor?.displayName ?? null })),
      ...expenses.map((e) => ({ type: 'expense' as ControlledType, id: e.id, number: e.referenceNo, date: day(e.paymentDate), amount: Number(e.totalAmount ?? 0), contact: null })),
      ...journals.map((j) => ({ type: 'manual_journal' as ControlledType, id: j.id, number: j.journalNumber, date: day(j.date), amount: Number(j.amount ?? 0), contact: null })),
    ];
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
