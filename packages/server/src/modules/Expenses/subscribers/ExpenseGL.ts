import * as R from 'ramda';
import { sumBy } from 'lodash';
import { ILedger } from '@/modules/Ledger/types/Ledger.types';
import { AccountNormal } from '@/modules/Accounts/Accounts.types';
import { ILedgerEntry } from '@/modules/Ledger/types/Ledger.types';
import { ExpenseCategory } from '../models/ExpenseCategory.model';
import { Ledger } from '@/modules/Ledger/Ledger';
import { Expense } from '../models/Expense.model';

export class ExpenseGL {
  private expense: Expense;

  /**
   * Constructor method.
   * @param {Expense} expense - Expense.
   */
  constructor(expense: Expense) {
    this.expense = expense;
  }

  /**
   * Retrieves the expense GL common entry.
   */
  private getExpenseGLCommonEntry = () => {
    return {
      currencyCode: this.expense.currencyCode,
      exchangeRate: this.expense.exchangeRate,

      transactionType: 'Expense',
      transactionId: this.expense.id,

      date: this.expense.paymentDate,
      userId: this.expense.userId,

      debit: 0,
      credit: 0,

      branchId: this.expense.branchId,
    };
  };

  /**
   * Retrieves the expense GL payment entry.
   * @returns {ILedgerEntry}
   */
  private getExpenseGLPaymentEntry = (): ILedgerEntry => {
    const commonEntry = this.getExpenseGLCommonEntry();

    return {
      ...commonEntry,
      // 103 DiTech: the payment account pays the total less withholding tax.
      credit:
        this.expense.localAmount -
        sumBy(this.getExpenseGLWithholdingEntries(), 'credit'),
      accountId: this.expense.paymentAccountId,
      accountNormal:
        this.expense?.paymentAccount?.accountNormal === 'debit'
          ? AccountNormal.DEBIT
          : AccountNormal.CREDIT,
      index: 1,
    };
  };

  /**
   * Retrieves the expense GL category entry.
   * @param {ExpenseCategory} category - Expense category.
   * @param {number} index
   * @returns {ILedgerEntry}
   */
  private getExpenseGLCategoryEntry = R.curry(
    (category: ExpenseCategory, index: number): ILedgerEntry => {
      const commonEntry = this.getExpenseGLCommonEntry();
      const localAmount = category.amount * this.expense.exchangeRate;

      return {
        ...commonEntry,
        accountId: category.expenseAccountId,
        accountNormal: AccountNormal.DEBIT,
        debit: localAmount,
        note: category.description,
        index: index + 2,
        projectId: category.projectId,
      };
    },
  );

  /**
   * 103 DiTech: withholding tax in base currency.
   */
  private get whtLocalAmount(): number {
    return (Number(this.expense.whtAmount) || 0) * this.expense.exchangeRate;
  }

  /**
   * 103 DiTech: the withholding tax, credited to its code's payable account.
   * @returns {ILedgerEntry[]}
   */
  private getExpenseGLWithholdingEntries = (): ILedgerEntry[] => {
    const accountId = (this.expense as any).whtCode?.accountId;
    if (!this.whtLocalAmount || !accountId) return [];
    return [
      {
        ...this.getExpenseGLCommonEntry(),
        credit: this.whtLocalAmount,
        accountId,
        accountNormal: AccountNormal.CREDIT,
        index: 1,
      } as ILedgerEntry,
    ];
  };

  /**
   * Retrieves the expense GL entries.
   * @returns {ILedgerEntry[]}
   */
  public getExpenseGLEntries = (): ILedgerEntry[] => {
    const getCategoryEntry = this.getExpenseGLCategoryEntry();

    const paymentEntry = this.getExpenseGLPaymentEntry();
    const categoryEntries = this.expense.categories.map((category, index) =>
      getCategoryEntry(category, index),
    );
    return [
      paymentEntry,
      ...this.getExpenseGLWithholdingEntries(),
      ...categoryEntries,
    ];
  };

  /**
   * Retrieves the given expense ledger.
   * @returns {ILedger}
   */
  public getExpenseLedger = (): ILedger => {
    const entries = this.getExpenseGLEntries();

    return new Ledger(entries);
  };
}
