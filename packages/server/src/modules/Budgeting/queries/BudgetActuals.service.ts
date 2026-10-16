import { Inject, Injectable } from '@nestjs/common';
import { isEmpty } from 'lodash';
import { TenantModelProxy } from '@/modules/System/models/TenantBaseModel';
import { AccountTransaction } from '@/modules/Accounts/models/AccountTransaction.model';
import { Account } from '@/modules/Accounts/models/Account.model';
import { Milli, toMilli } from '../calc/budget-calc';

export type SplitBy = 'none' | 'branch' | 'project';

export interface ActualsQuery {
  accountIds: number[];
  fromDate: string;
  toDate: string;
  branchIds?: number[];
  projectIds?: number[];
  /** Keep branches or projects apart (one series per account × branch/project). */
  splitBy?: SplitBy;
}

export interface ActualSeries {
  accountId: number;
  branchId: number | null;
  projectId: number | null;
  /** "YYYY-MM-01" → amount on the account's natural side, in thousandths. */
  months: Record<string, Milli>;
}

/**
 * Posted actuals from the ledger, by account and month — the same rows and
 * filters as the Profit & Loss report (ProfitLossSheetRepository: date range,
 * month grouping, branches), so budget figures reconcile with the statements.
 * The ledger only holds posted entries: drafts never write to it and deleted or
 * unpublished documents remove theirs (design §1).
 */
@Injectable()
export class BudgetActualsService {
  constructor(
    @Inject(AccountTransaction.name)
    private readonly transactionModel: TenantModelProxy<typeof AccountTransaction>,
    @Inject(Account.name)
    private readonly accountModel: TenantModelProxy<typeof Account>,
  ) {}

  async byMonth(q: ActualsQuery): Promise<ActualSeries[]> {
    if (q.accountIds.length === 0) return [];
    const accounts = await this.accountModel().query().whereIn('id', q.accountIds);
    const creditNormal = new Set(accounts.filter((a) => a.accountNormal === 'credit').map((a) => a.id));
    const split = q.splitBy ?? 'none';

    const rows = await this.transactionModel()
      .query()
      .onBuild((query) => {
        query.whereIn('accountId', q.accountIds);
        query.modify('filterDateRange', q.fromDate, q.toDate);
        query.modify('groupByDateFormat', 'month');
        query.sum('credit as credit');
        query.sum('debit as debit');
        query.select('accountId');
        query.groupBy('accountId');
        if (split === 'branch') query.select('branchId').groupBy('branchId');
        if (split === 'project') query.select('projectId').groupBy('projectId');
        if (!isEmpty(q.branchIds)) query.modify('filterByBranches', q.branchIds);
        if (!isEmpty(q.projectIds)) query.modify('filterByProjects', q.projectIds);
      });

    const series = new Map<string, ActualSeries>();
    for (const r of rows as any[]) {
      const branchId = split === 'branch' ? (r.branchId ?? null) : null;
      const projectId = split === 'project' ? (r.projectId ?? null) : null;
      const key = `${r.accountId}:${branchId ?? 0}:${projectId ?? 0}`;
      const s = series.get(key) ?? { accountId: r.accountId, branchId, projectId, months: {} };
      const credit = toMilli(Number(r.credit ?? 0).toFixed(3));
      const debit = toMilli(Number(r.debit ?? 0).toFixed(3));
      const month = `${r.date}-01`;
      s.months[month] = (s.months[month] ?? 0) + (creditNormal.has(r.accountId) ? credit - debit : debit - credit);
      series.set(key, s);
    }
    return [...series.values()];
  }

  /**
   * Debit and credit totals by account, month, branch and project, in one
   * grouped query (same rows and filters as `byMonth`). Budget vs actual
   * assigns each group to its budget line.
   */
  async byDimensions(q: Omit<ActualsQuery, 'splitBy'>): Promise<LedgerCell[]> {
    if (q.accountIds.length === 0) return [];
    const rows = await this.transactionModel()
      .query()
      .onBuild((query) => {
        query.whereIn('accountId', q.accountIds);
        query.modify('filterDateRange', q.fromDate, q.toDate);
        query.modify('groupByDateFormat', 'month');
        query.sum('credit as credit');
        query.sum('debit as debit');
        query.select('accountId', 'branchId', 'projectId');
        query.groupBy('accountId', 'branchId', 'projectId');
        if (!isEmpty(q.branchIds)) query.modify('filterByBranches', q.branchIds);
        if (!isEmpty(q.projectIds)) query.modify('filterByProjects', q.projectIds);
      });
    return (rows as any[]).map((r) => ({
      accountId: r.accountId,
      branchId: r.branchId ?? null,
      projectId: r.projectId ?? null,
      month: `${r.date}-01`,
      debit: toMilli(Number(r.debit ?? 0).toFixed(3)),
      credit: toMilli(Number(r.credit ?? 0).toFixed(3)),
    }));
  }
}

export interface LedgerCell {
  accountId: number;
  branchId: number | null;
  projectId: number | null;
  /** YYYY-MM-01 */
  month: string;
  debit: Milli;
  credit: Milli;
}
