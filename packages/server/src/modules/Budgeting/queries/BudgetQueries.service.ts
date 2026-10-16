import { Inject, Injectable } from '@nestjs/common';
import { TenantModelProxy } from '@/modules/System/models/TenantBaseModel';
import { AccountTypesUtils } from '@/libs/accounts-utils/AccountTypesUtils';
import { ServiceError } from '@/modules/Items/ServiceError';
import { Budget } from '../models/Budget.model';
import { BudgetVersion } from '../models/BudgetVersion.model';
import { BudgetLine } from '../models/BudgetLine.model';
import { AllocateBudgetDto, GetBudgetsQueryDto } from '../dtos/Budget.dto';
import { BudgetValidator } from '../commands/BudgetValidator.service';
import { currencyDecimals, dateOnly, normalizeMonth } from '../commands/BudgetCommands.service';
import { ERRORS } from '../Budgeting.types';
import {
  allocateByPercentages,
  allocateByWeights,
  allocateEqual,
  applyGrowth,
  BudgetCalcError,
  fromMilli,
  Milli,
  PeriodTotals,
  periodMonths,
  periodTotals,
  sumTotals,
  toMilli,
  unitFor,
} from '../calc/budget-calc';

const money = (t: PeriodTotals) => ({
  months: Object.fromEntries(Object.entries(t.months).map(([m, v]) => [m, fromMilli(v)])),
  quarters: t.quarters.map(fromMilli),
  total: fromMilli(t.total),
});

export const toBudgetDto = (b: Budget) => ({
  id: b.id,
  reference: b.reference,
  name: b.name,
  type: b.type,
  fiscalYear: b.fiscalYear,
  startDate: dateOnly(b.startDate),
  endDate: dateOnly(b.endDate),
  currencyCode: b.currencyCode,
  branchId: b.branchId,
  projectId: b.projectId,
  ownerUserId: b.ownerUserId,
  description: b.description,
  notes: b.notes,
  activeVersionId: b.activeVersionId,
  createdBy: b.createdBy,
  createdAt: b.createdAt,
  updatedAt: b.updatedAt,
});

export const toVersionDto = (v: BudgetVersion) => ({
  id: v.id,
  versionNo: v.versionNo,
  kind: v.kind,
  scenario: v.scenario,
  label: v.label,
  status: v.status,
  sourceVersionId: v.sourceVersionId,
  revisionReason: v.revisionReason,
  lockVersion: v.lockVersion,
  submittedAt: v.submittedAt,
  approvedAt: v.approvedAt,
  lockedAt: v.lockedAt,
  createdAt: v.createdAt,
  updatedAt: v.updatedAt,
});

@Injectable()
export class BudgetQueriesService {
  constructor(
    private readonly validator: BudgetValidator,
    @Inject(Budget.name) private readonly budgetModel: TenantModelProxy<typeof Budget>,
    @Inject(BudgetVersion.name) private readonly versionModel: TenantModelProxy<typeof BudgetVersion>,
    @Inject(BudgetLine.name) private readonly lineModel: TenantModelProxy<typeof BudgetLine>,
  ) {}

  async getBudgets(filter: GetBudgetsQueryDto) {
    const page = filter.page ?? 1;
    const pageSize = filter.pageSize ?? 50;
    const query = this.budgetModel().query().modify('notDeleted').orderBy([{ column: 'fiscalYear', order: 'desc' }, { column: 'name' }]);
    if (filter.fiscalYear) query.where('fiscalYear', filter.fiscalYear);
    if (filter.type) query.where('type', filter.type);
    if (filter.search?.trim()) {
      const term = `%${filter.search.trim()}%`;
      query.where((q) => q.where('name', 'like', term).orWhere('reference', 'like', term));
    }
    const { results, total } = await query.page(page - 1, pageSize);

    // Latest version of each budget on the page, in one query.
    const ids = results.map((b) => b.id);
    const versions = ids.length ? await this.versionModel().query().whereIn('budgetId', ids).orderBy('versionNo') : [];
    const latest = new Map<number, BudgetVersion>();
    for (const v of versions) latest.set(v.budgetId, v);

    return {
      data: results.map((b) => ({
        ...toBudgetDto(b),
        versionsCount: versions.filter((v) => v.budgetId === b.id).length,
        latestVersion: latest.has(b.id) ? toVersionDto(latest.get(b.id)) : null,
      })),
      pagination: { page, pageSize, total },
    };
  }

  async getBudget(budgetId: number) {
    const budget = await this.validator.getBudgetOrThrow(budgetId);
    const versions = await this.versionModel().query().where('budgetId', budgetId).orderBy('versionNo');
    const totals = await this.versionTotals(versions.map((v) => v.id));
    return {
      ...toBudgetDto(budget),
      months: periodMonths(dateOnly(budget.startDate), dateOnly(budget.endDate)),
      versions: versions.map((v) => ({ ...toVersionDto(v), total: fromMilli(totals.get(v.id) ?? 0) })),
    };
  }

  /** One version with its lines, monthly amounts, quarters and totals (per account group and overall). */
  async getVersion(budgetId: number, versionNo: number) {
    const budget = await this.validator.getBudgetOrThrow(budgetId);
    const version = await this.validator.getVersionOrThrow(budgetId, versionNo);
    const months = periodMonths(dateOnly(budget.startDate), dateOnly(budget.endDate));

    const lines = await this.lineModel().query().where('versionId', version.id).withGraphFetched('[amounts, account]');
    const rows = lines.map((line) => {
      const amounts: Record<string, Milli> = {};
      for (const a of (line as any).amounts ?? []) amounts[dateOnly(a.month)] = toMilli(String(a.amount));
      const account = (line as any).account;
      const rootType = AccountTypesUtils.getType(account.accountType, 'rootType');
      return { line, account, rootType, totals: periodTotals(amounts, months) };
    });
    rows.sort((a, b) => String(a.account.code ?? '').localeCompare(String(b.account.code ?? '')) || a.line.id - b.line.id);

    const byRoot = new Map<string, PeriodTotals[]>();
    for (const r of rows) byRoot.set(r.rootType, [...(byRoot.get(r.rootType) ?? []), r.totals]);
    const groups = [...byRoot.entries()].map(([rootType, list]) => ({ rootType, ...money(sumTotals(list, months)) }));

    // Net income for P&L-style budgets: income − expense, both entered on their natural side.
    const income = sumTotals(byRoot.get('income') ?? [], months);
    const expense = sumTotals(byRoot.get('expense') ?? [], months);
    const net: Record<string, Milli> = {};
    for (const m of months) net[m] = (income.months[m] ?? 0) - (expense.months[m] ?? 0);

    return {
      budget: toBudgetDto(budget),
      version: toVersionDto(version),
      months,
      quarters: [0, 1, 2, 3, 4, 5, 6, 7].slice(0, Math.ceil(months.length / 3)).map((q) => ({
        label: `Q${q + 1}`,
        months: months.slice(q * 3, q * 3 + 3),
      })),
      lines: rows.map(({ line, account, rootType, totals }) => ({
        id: line.id,
        accountId: line.accountId,
        account: {
          id: account.id,
          code: account.code,
          name: account.name,
          accountType: account.accountType,
          rootType,
          normal: account.accountNormal,
        },
        branchId: line.branchId,
        projectId: line.projectId,
        note: line.note,
        assumption: line.assumption,
        ...money(totals),
      })),
      totals: {
        groups,
        netIncome: money(periodTotals(net, months)),
        grand: money(sumTotals(rows.map((r) => r.totals), months)),
      },
    };
  }

  /**
   * Allocation preview: returns amounts by month without saving, so the grid
   * can show them and save through the lines endpoint.
   */
  async allocate(budgetId: number, dto: AllocateBudgetDto) {
    const budget = await this.validator.getBudgetOrThrow(budgetId);
    const months = periodMonths(dateOnly(budget.startDate), dateOnly(budget.endDate));
    const decimals = currencyDecimals(budget.currencyCode);
    const unit = unitFor(decimals);
    const invalid = (message: string) => new ServiceError(ERRORS.INVALID_ALLOCATION, message);

    try {
      let values: Milli[];
      if (dto.method === 'growth') {
        if (dto.growthPercent === undefined) throw invalid('growthPercent is required.');
        const base = months.map((m) => {
          const entry = (dto.baseAmounts ?? []).find((a) => normalizeMonth(String(a.month ?? '')) === m);
          return entry && entry.amount !== null && entry.amount !== '' ? toMilli(entry.amount, 3) : 0;
        });
        values = applyGrowth(base, dto.growthPercent, unit);
      } else {
        if (dto.amount === undefined || dto.amount === null || dto.amount === '') throw invalid('amount is required.');
        const amount = toMilli(dto.amount, decimals);
        if (dto.method === 'equal') values = allocateEqual(amount, months.length, unit);
        else {
          if (!dto.values || dto.values.length !== months.length) {
            throw invalid(`Give exactly ${months.length} values, one per month.`);
          }
          values = dto.method === 'percentage'
            ? allocateByPercentages(amount, dto.values, unit)
            : allocateByWeights(amount, dto.values, unit);
        }
      }
      const amounts = Object.fromEntries(months.map((m, i) => [m, fromMilli(values[i])]));
      return { method: dto.method, months, amounts, total: fromMilli(values.reduce((a, b) => a + b, 0)) };
    } catch (err) {
      if (err instanceof BudgetCalcError) throw new ServiceError(ERRORS.INVALID_ALLOCATION, err.message, { reason: err.code });
      throw err;
    }
  }

  private async versionTotals(versionIds: number[]): Promise<Map<number, Milli>> {
    if (versionIds.length === 0) return new Map();
    const rows = await this.lineModel()
      .query()
      .join('budget_line_amounts', 'budget_line_amounts.lineId', 'budget_lines.id')
      .whereIn('budget_lines.versionId', versionIds)
      .groupBy('budget_lines.versionId')
      .select('budget_lines.versionId')
      .sum('budget_line_amounts.amount as total');
    return new Map(rows.map((r: any) => [r.versionId, toMilli(Number(r.total).toFixed(3))]));
  }
}
