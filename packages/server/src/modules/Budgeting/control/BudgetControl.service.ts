import { Inject, Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { Knex } from 'knex';
import * as moment from 'moment';
import { ServiceError } from '@/modules/Items/ServiceError';
import { TenantModelProxy } from '@/modules/System/models/TenantBaseModel';
import { AccountTransaction } from '@/modules/Accounts/models/AccountTransaction.model';
import { Account } from '@/modules/Accounts/models/Account.model';
import { Budget } from '../models/Budget.model';
import { BudgetVersion } from '../models/BudgetVersion.model';
import { BudgetLine } from '../models/BudgetLine.model';
import { BudgetControlPolicy } from '../models/BudgetControlPolicy.model';
import { BudgetOverride } from '../models/BudgetOverride.model';
import { BudgetControlEvent } from '../models/BudgetControlEvent.model';
import { BudgetType } from '../Budgeting.types';
import { dateOnly } from '../commands/BudgetCommands.service';
import { fromMilli, Milli, periodMonths, toMilli } from '../calc/budget-calc';
import { matchLine } from '../calc/variance';
import {
  ControlledType,
  ControlLevel,
  ControlMode,
  controlMonths,
  DEFAULT_THRESHOLDS,
  evaluate,
  LEDGER_REFERENCE,
  LedgerLeg,
  PeriodBasis,
  spendOf,
} from '../calc/control';
import { APPROVED_STATUSES } from '../workflow/approval';
import { BudgetDocumentLedgerService } from './BudgetDocumentLedger.service';

export const CONTROL_ERRORS = {
  EXCEEDED: 'BUDGET_EXCEEDED',
  APPROVAL_REQUIRED: 'BUDGET_APPROVAL_REQUIRED',
};

export interface Policy {
  budgetId: number | null;
  mode: ControlMode;
  thresholds: number[];
  periodBasis: PeriodBasis;
  transactionTypes: ControlledType[];
}

export const parsePolicy = (row: BudgetControlPolicy): Policy => ({
  budgetId: row.budgetId ?? null,
  mode: row.mode as ControlMode,
  thresholds: JSON.parse(row.thresholds || '[]'),
  periodBasis: row.periodBasis as PeriodBasis,
  transactionTypes: JSON.parse(row.transactionTypes || '[]'),
});

export interface ControlCheck {
  budgetId: number;
  budgetReference: string;
  budgetName: string;
  versionId: number;
  lineId: number;
  accountId: number;
  accountName: string;
  branchId: number | null;
  projectId: number | null;
  periodFrom: string;
  periodTo: string;
  periodBasis: PeriodBasis;
  mode: ControlMode;
  budget: Milli;
  actual: Milli;
  commitments: Milli;
  document: Milli;
  usedAfter: Milli;
  available: Milli;
  percentAfter: number | null;
  level: ControlLevel;
  excess: Milli;
}

export const toCheckDto = (c: ControlCheck) => ({
  ...c,
  budget: fromMilli(c.budget),
  actual: fromMilli(c.actual),
  commitments: fromMilli(c.commitments),
  document: fromMilli(c.document),
  usedAfter: fromMilli(c.usedAfter),
  available: fromMilli(c.available),
  excess: fromMilli(c.excess),
});

interface Cell {
  accountId: number;
  branchId: number | null;
  projectId: number | null;
  month: string;
  debit: Milli;
  credit: Milli;
}

const endOfMonth = (month: string) => moment(month).endOf('month').format('YYYY-MM-DD');
const monthLabel = (month: string) => moment(month).format('MMM YYYY');

/**
 * Spending control (design §6, §13). A checked document (open bill, published
 * expense or manual journal) takes the tenant's budget-control lock on its
 * "-ing" event, before any ledger row is written, so checked documents run one
 * at a time; the check on its "-ed" event then reads actuals with a locking
 * read, which sees every document committed before it (a plain read would use
 * the transaction's older snapshot). The document's own ledger rows are always
 * left out and its amounts come from its GL builder, so the check does not
 * depend on whether the GL subscriber has run yet, and an edit never counts
 * the old amounts.
 */
@Injectable()
export class BudgetControlService {
  constructor(
    private readonly documents: BudgetDocumentLedgerService,
    private readonly cls: ClsService,
    @Inject(Budget.name) private readonly budgetModel: TenantModelProxy<typeof Budget>,
    @Inject(BudgetVersion.name) private readonly versionModel: TenantModelProxy<typeof BudgetVersion>,
    @Inject(BudgetLine.name) private readonly lineModel: TenantModelProxy<typeof BudgetLine>,
    @Inject(BudgetControlPolicy.name) private readonly policyModel: TenantModelProxy<typeof BudgetControlPolicy>,
    @Inject(BudgetOverride.name) private readonly overrideModel: TenantModelProxy<typeof BudgetOverride>,
    @Inject(BudgetControlEvent.name) private readonly eventModel: TenantModelProxy<typeof BudgetControlEvent>,
    @Inject(Account.name) private readonly accountModel: TenantModelProxy<typeof Account>,
    @Inject(AccountTransaction.name) private readonly transactionModel: TenantModelProxy<typeof AccountTransaction>,
  ) {}

  async policies(trx?: Knex.Transaction): Promise<Policy[]> {
    return (await this.policyModel().query(trx)).map(parsePolicy);
  }

  /** Takes the tenant's budget-control lock when any policy is on; held until the document commits. */
  async acquire(trx?: Knex.Transaction): Promise<void> {
    if (!trx) return;
    const on = await this.policyModel().query(trx).whereNot('mode', 'off').first();
    if (!on) return;
    await trx('budget_control_lock').where('id', 1).forUpdate().first();
  }

  /**
   * Checks a posted document and applies the policies: `block` refuses an
   * excess, `warn_approve` refuses it unless an approved override covers it,
   * `inform` lets it through. Every threshold reached is recorded.
   */
  async enforce(type: ControlledType, id: number, trx: Knex.Transaction): Promise<ControlCheck[]> {
    const checks = await this.check(type, id, trx, true);
    const exceeded = checks.filter((c) => c.level === 'exceeded');
    const blocked = exceeded.filter((c) => c.mode === 'block');
    if (blocked.length) {
      throw new ServiceError(CONTROL_ERRORS.EXCEEDED, describe(blocked[0]), { checks: blocked.map(toCheckDto) }, 400);
    }
    const outcomes = new Map<ControlCheck, string>();
    const needApproval: ControlCheck[] = [];
    for (const c of exceeded.filter((x) => x.mode === 'warn_approve')) {
      const override = await this.overrideModel()
        .query(trx)
        .where({ referenceType: LEDGER_REFERENCE[type], referenceId: id, lineId: c.lineId, status: 'approved' })
        .where('amount', '>=', fromMilli(c.excess).toFixed(3))
        .first();
      if (override) outcomes.set(c, 'override');
      else needApproval.push(c);
    }
    if (needApproval.length) {
      throw new ServiceError(
        CONTROL_ERRORS.APPROVAL_REQUIRED,
        `${describe(needApproval[0])} Save it as a draft and request a budget override.`,
        { checks: needApproval.map(toCheckDto) },
        400,
      );
    }
    const now = moment().toDate();
    for (const c of checks.filter((x) => x.level !== 'none')) {
      await this.eventModel().query(trx).insert({
        budgetId: c.budgetId,
        versionId: c.versionId,
        lineId: c.lineId,
        accountId: c.accountId,
        referenceType: LEDGER_REFERENCE[type],
        referenceId: id,
        periodFrom: c.periodFrom,
        periodTo: c.periodTo,
        budgetAmount: fromMilli(c.budget).toFixed(3),
        usedBefore: fromMilli(c.actual + c.commitments).toFixed(3),
        documentAmount: fromMilli(c.document).toFixed(3),
        percentAfter: c.percentAfter,
        level: c.level,
        mode: c.mode,
        outcome: outcomes.get(c) ?? 'allowed',
        createdBy: this.cls.get<number>('userId') ?? null,
        createdAt: now,
      });
    }
    return checks;
  }

  /**
   * The document's spend against every active budget whose policy controls it,
   * as if posted. `locking` makes the actuals read see concurrent commits.
   */
  async check(type: ControlledType, id: number, trx: Knex.Transaction | undefined, locking: boolean): Promise<ControlCheck[]> {
    const policies = await this.policies(trx);
    if (!policies.some((p) => p.mode !== 'off')) return [];
    const fallback = policies.find((p) => p.budgetId === null);
    const legs = await this.documents.legs(type, id, trx);
    if (legs.length === 0) return [];

    const docMonths = [...new Set(legs.map((l) => l.month))].sort();
    const budgets = await this.budgetModel()
      .query(trx)
      .modify('notDeleted')
      .whereNotNull('activeVersionId')
      .where('startDate', '<=', endOfMonth(docMonths[docMonths.length - 1]))
      .where('endDate', '>=', docMonths[0]);
    const controlled = budgets
      .map((budget) => ({ budget, policy: policies.find((p) => p.budgetId === budget.id) ?? fallback }))
      .filter((x): x is { budget: Budget; policy: Policy } => !!x.policy && x.policy.mode !== 'off' && x.policy.transactionTypes.includes(type));
    if (controlled.length === 0) return [];

    const versions = await this.versionModel()
      .query(trx)
      .whereIn('id', controlled.map((x) => x.budget.activeVersionId as number))
      .whereIn('status', APPROVED_STATUSES);
    const accountIds = [...new Set(legs.map((l) => l.accountId))];
    const lines = versions.length
      ? await this.lineModel().query(trx).whereIn('versionId', versions.map((v) => v.id)).whereIn('accountId', accountIds).withGraphFetched('amounts')
      : [];
    if (lines.length === 0) return [];
    const accounts = new Map((await this.accountModel().query(trx).whereIn('id', accountIds)).map((a) => [a.id, a]));

    // What the document spends on each line, by month.
    type Target = { budget: Budget; policy: Policy; version: BudgetVersion; months: string[]; lines: BudgetLine[] };
    const targets: Target[] = [];
    for (const { budget, policy } of controlled) {
      const version = versions.find((v) => v.id === budget.activeVersionId);
      if (!version) continue;
      const vLines = lines.filter((l) => l.versionId === version.id);
      if (vLines.length) targets.push({ budget, policy, version, months: periodMonths(dateOnly(budget.startDate), dateOnly(budget.endDate)), lines: vLines });
    }
    const pending: Array<{ t: Target; line: BudgetLine; period: string[]; document: Milli }> = [];
    for (const t of targets) {
      const capex = t.budget.type === BudgetType.Capex;
      const byLine = assign(t, legs, accounts, capex);
      for (const [lineId, months] of byLine) {
        const line = t.lines.find((l) => l.id === lineId)!;
        const anchors = t.policy.periodBasis === 'year' ? [[...months.keys()].sort().pop()!] : [...months.keys()].sort();
        for (const anchor of anchors) {
          const period = controlMonths(t.policy.periodBasis, anchor, t.months);
          const document = period.reduce((sum, m) => sum + (months.get(m) ?? 0), 0);
          if (document > 0) pending.push({ t, line, period, document });
        }
      }
    }
    if (pending.length === 0) return [];

    // Used before the document: actuals (locking read, document excluded) and open commitments.
    const from = pending.reduce((m, p) => (p.period[0] < m ? p.period[0] : m), pending[0].period[0]);
    const to = endOfMonth(pending.reduce((m, p) => (p.period[p.period.length - 1] > m ? p.period[p.period.length - 1] : m), pending[0].period[0]));
    const lineAccountIds = [...new Set(pending.map((p) => p.line.accountId))];
    const actualCells = await this.ledgerCells(lineAccountIds, from, to, trx, { locking, except: { type, id } });
    const draftCells = (await this.documents.draftLegs(from, to, { type, id }, trx)).filter((l) => lineAccountIds.includes(l.accountId));

    return pending.map(({ t, line, period, document }) => {
      const capex = t.budget.type === BudgetType.Capex;
      const inPeriod = new Set(period);
      const used = (cells: Cell[]) => sumFor(t, line, cells.filter((c) => inPeriod.has(c.month)), accounts, capex);
      const actual = used(actualCells);
      const commitments = used(draftCells);
      const budget = ((line as any).amounts ?? [])
        .filter((a: any) => inPeriod.has(dateOnly(a.month)))
        .reduce((sum: Milli, a: any) => sum + toMilli(String(a.amount)), 0);
      const r = evaluate({ budget, usedBefore: actual + commitments, document }, t.policy.thresholds.length ? t.policy.thresholds : DEFAULT_THRESHOLDS);
      const account = accounts.get(line.accountId);
      return {
        budgetId: t.budget.id,
        budgetReference: t.budget.reference,
        budgetName: t.budget.name,
        versionId: t.version.id,
        lineId: line.id,
        accountId: line.accountId,
        accountName: account?.name ?? '',
        branchId: line.branchId ?? t.budget.branchId ?? null,
        projectId: line.projectId ?? t.budget.projectId ?? null,
        periodFrom: period[0],
        periodTo: endOfMonth(period[period.length - 1]),
        periodBasis: t.policy.periodBasis,
        mode: t.policy.mode,
        budget,
        actual,
        commitments,
        document,
        usedAfter: r.usedAfter,
        available: r.available,
        percentAfter: r.percentAfter,
        level: r.level,
        excess: r.excess,
      };
    });
  }

  /**
   * Budget, actual, open commitments and available for every line of the
   * active version, over the period the basis gives for `month`.
   */
  async availability(budgetId: number, month: string | undefined, basis: PeriodBasis | undefined) {
    const budget = await this.budgetModel().query().modify('notDeleted').findById(budgetId);
    if (!budget) throw new ServiceError('BUDGET_NOT_FOUND', 'The budget was not found.', null, 404);
    const version = budget.activeVersionId ? await this.versionModel().query().findById(budget.activeVersionId) : null;
    if (!version || !APPROVED_STATUSES.includes(version.status)) {
      throw new ServiceError('BUDGET_NO_ACTIVE_VERSION', 'The budget has no approved version yet.', null, 409);
    }
    const months = periodMonths(dateOnly(budget.startDate), dateOnly(budget.endDate));
    const policies = await this.policies();
    const policy = policies.find((p) => p.budgetId === budgetId) ?? policies.find((p) => p.budgetId === null) ?? null;
    const usedBasis: PeriodBasis = basis ?? policy?.periodBasis ?? 'year';
    const today = moment().format('YYYY-MM-01');
    const anchor = month ? moment(month, ['YYYY-MM', 'YYYY-MM-DD']).format('YYYY-MM-01') : today < months[0] ? months[0] : today > months[months.length - 1] ? months[months.length - 1] : today;
    const period = controlMonths(usedBasis, anchor, months);
    if (period.length === 0) throw new ServiceError('BUDGET_MONTH_OUTSIDE_PERIOD', `${month} is not a month of this budget.`);

    const lines = await this.lineModel().query().where('versionId', version.id).withGraphFetched('[amounts, account]');
    const accountIds = [...new Set(lines.map((l) => l.accountId))];
    const accounts = new Map((accountIds.length ? await this.accountModel().query().whereIn('id', accountIds) : []).map((a) => [a.id, a]));
    const from = period[0];
    const to = endOfMonth(period[period.length - 1]);
    const actualCells = await this.ledgerCells(accountIds, from, to, undefined, { locking: false, except: null });
    const draftCells = (await this.documents.draftLegs(from, to, null)).filter((l) => accounts.has(l.accountId));
    const capex = budget.type === BudgetType.Capex;
    const t = { budget, lines };
    const inPeriod = new Set(period);

    const rows = lines.map((line) => {
      const b = ((line as any).amounts ?? []).filter((a: any) => inPeriod.has(dateOnly(a.month))).reduce((s: Milli, a: any) => s + toMilli(String(a.amount)), 0);
      const actual = sumFor(t, line, actualCells, accounts, capex);
      const commitments = sumFor(t, line, draftCells, accounts, capex);
      const available = b - actual - commitments;
      return {
        lineId: line.id,
        accountId: line.accountId,
        account: { id: line.accountId, code: (line as any).account?.code, name: (line as any).account?.name },
        branchId: line.branchId,
        projectId: line.projectId,
        budget: fromMilli(b),
        actual: fromMilli(actual),
        commitments: fromMilli(commitments),
        available: fromMilli(available),
        usedPercent: b > 0 ? Math.round(((actual + commitments) / b) * 10_000) / 100 : null,
      };
    });
    const total = (key: 'budget' | 'actual' | 'commitments' | 'available') => fromMilli(rows.reduce((s, r) => s + toMilli(r[key]), 0));
    return {
      budgetId,
      versionNo: version.versionNo,
      periodBasis: usedBasis,
      periodFrom: from,
      periodTo: to,
      policy: policy ? { mode: policy.mode, thresholds: policy.thresholds, periodBasis: policy.periodBasis } : null,
      lines: rows,
      totals: { budget: total('budget'), actual: total('actual'), commitments: total('commitments'), available: total('available') },
    };
  }

  /** Ledger amounts by account, branch, project and month. */
  private async ledgerCells(
    accountIds: number[],
    fromDate: string,
    toDate: string,
    trx: Knex.Transaction | undefined,
    opts: { locking: boolean; except: { type: ControlledType; id: number } | null },
  ): Promise<Cell[]> {
    if (accountIds.length === 0) return [];
    const query = this.transactionModel()
      .query(trx)
      .onBuild((q) => {
        q.whereIn('accountId', accountIds);
        q.modify('filterDateRange', fromDate, toDate);
        q.modify('groupByDateFormat', 'month');
        q.sum('credit as credit');
        q.sum('debit as debit');
        q.select('accountId', 'branchId', 'projectId');
        q.groupBy('accountId', 'branchId', 'projectId');
        if (opts.except) {
          const except = opts.except;
          q.whereNot((w) => w.where('referenceType', LEDGER_REFERENCE[except.type]).where('referenceId', except.id));
        }
      });
    if (opts.locking) query.forShare();
    const rows = (await query) as any[];
    return rows.map((r) => ({
      accountId: r.accountId,
      branchId: r.branchId ?? null,
      projectId: r.projectId ?? null,
      month: `${r.date}-01`,
      debit: toMilli(Number(r.debit ?? 0).toFixed(3)),
      credit: toMilli(Number(r.credit ?? 0).toFixed(3)),
    }));
  }
}

/** A leg counts for a budget when it is in the budget's branch/project scope; then it goes to its most specific line. */
const inScope = (budget: Budget, c: { branchId: number | null; projectId: number | null }) =>
  (!budget.branchId || c.branchId === budget.branchId) && (!budget.projectId || c.projectId === budget.projectId);

function assign(
  t: { budget: Budget; lines: BudgetLine[]; months: string[] },
  legs: LedgerLeg[],
  accounts: Map<number, Account>,
  capex: boolean,
): Map<number, Map<string, Milli>> {
  const months = new Set(t.months);
  const out = new Map<number, Map<string, Milli>>();
  for (const leg of legs) {
    if (!months.has(leg.month) || !inScope(t.budget, leg)) continue;
    const line = matchLine(t.lines, leg.accountId, leg.branchId, leg.projectId);
    if (!line) continue;
    const spend = spendOf(leg, accounts.get(leg.accountId)?.accountNormal ?? 'debit', capex);
    const byMonth = out.get(line.id) ?? new Map<string, Milli>();
    byMonth.set(leg.month, (byMonth.get(leg.month) ?? 0) + spend);
    out.set(line.id, byMonth);
  }
  return out;
}

function sumFor(t: { budget: Budget; lines: BudgetLine[] }, line: BudgetLine, cells: Cell[], accounts: Map<number, Account>, capex: boolean): Milli {
  let sum = 0;
  for (const c of cells) {
    if (c.accountId !== line.accountId || !inScope(t.budget, c)) continue;
    if (matchLine(t.lines, c.accountId, c.branchId, c.projectId)?.id !== line.id) continue;
    sum += spendOf(c, accounts.get(c.accountId)?.accountNormal ?? 'debit', capex);
  }
  return sum;
}

const money = (milli: Milli) => fromMilli(milli).toFixed(2);

function describe(c: ControlCheck): string {
  const period = c.periodFrom.slice(0, 7) === c.periodTo.slice(0, 7) ? monthLabel(c.periodFrom) : `${monthLabel(c.periodFrom)}–${monthLabel(c.periodTo)}`;
  return `This goes over budget ${c.budgetReference} for ${c.accountName} (${period}) by ${money(c.excess)}: available ${money(c.available)}, this document ${money(c.document)}.`;
}
