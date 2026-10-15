import { Inject, Injectable } from '@nestjs/common';
import * as moment from 'moment';
import { ServiceError } from '@/modules/Items/ServiceError';
import { TenantModelProxy } from '@/modules/System/models/TenantBaseModel';
import { Account } from '@/modules/Accounts/models/Account.model';
import { BudgetVersion } from '../models/BudgetVersion.model';
import { BudgetLine } from '../models/BudgetLine.model';
import { PrefillBudgetDto } from '../dtos/Budget.dto';
import { BudgetValidator } from '../commands/BudgetValidator.service';
import { currencyDecimals, dateOnly } from '../commands/BudgetCommands.service';
import { BUDGET_TYPE_ACCOUNT_TYPES, BudgetType, ERRORS } from '../Budgeting.types';
import { fromMilli, Milli, periodMonths, roundTo, toMilli, unitFor } from '../calc/budget-calc';
import { BudgetActualsService } from './BudgetActuals.service';

interface Series {
  accountId: number;
  branchId: number | null;
  projectId: number | null;
  /** Amounts in the target budget's months, by index of month. */
  values: Milli[];
}

/**
 * Prefill preview: proposed lines for a budget from posted actuals of an
 * earlier period or from another budget version, with optional growth. Saves
 * nothing; the editor reviews the lines and saves them through the lines
 * endpoint (only the months shown change).
 */
@Injectable()
export class BudgetPrefillService {
  constructor(
    private readonly validator: BudgetValidator,
    private readonly actuals: BudgetActualsService,
    @Inject(Account.name) private readonly accountModel: TenantModelProxy<typeof Account>,
    @Inject(BudgetVersion.name) private readonly versionModel: TenantModelProxy<typeof BudgetVersion>,
    @Inject(BudgetLine.name) private readonly lineModel: TenantModelProxy<typeof BudgetLine>,
  ) {}

  async preview(budgetId: number, dto: PrefillBudgetDto) {
    const budget = await this.validator.getBudgetOrThrow(budgetId);
    const months = periodMonths(dateOnly(budget.startDate), dateOnly(budget.endDate));
    const unit = unitFor(currencyDecimals(budget.currencyCode));

    // Accounts the budget type allows (optionally narrowed).
    const allowed = BUDGET_TYPE_ACCOUNT_TYPES[budget.type as BudgetType] ?? [];
    const accountQuery = this.accountModel().query().whereIn('accountType', allowed);
    if (dto.accountIds?.length) {
      await this.validator.getAccountsOrThrow(budget.type, dto.accountIds);
      accountQuery.whereIn('id', dto.accountIds);
    }
    const accounts = await accountQuery;
    const accountIds = accounts.map((a) => a.id);

    let series: Series[];
    let source: Record<string, unknown>;
    if (dto.source === 'actuals') {
      const yearsBack = dto.yearsBack ?? 1;
      const shifted = months.map((m) => moment(m).subtract(yearsBack, 'years').format('YYYY-MM-01'));
      const fromDate = shifted[0];
      const toDate = moment(shifted[shifted.length - 1]).endOf('month').format('YYYY-MM-DD');
      const found = await this.actuals.byMonth({
        accountIds,
        fromDate,
        toDate,
        branchIds: budget.branchId ? [budget.branchId] : undefined,
        projectIds: budget.projectId ? [budget.projectId] : undefined,
        splitBy: dto.splitBy ?? 'none',
      });
      series = found.map((s) => ({ ...s, values: shifted.map((m) => s.months[m] ?? 0) }));
      source = { type: 'actuals', fromDate, toDate, yearsBack, splitBy: dto.splitBy ?? 'none' };
    } else {
      if (!dto.sourceBudgetId) throw new ServiceError(ERRORS.INVALID_ALLOCATION, 'sourceBudgetId is required.');
      const sourceBudget = await this.validator.getBudgetOrThrow(dto.sourceBudgetId);
      const versionNo =
        dto.sourceVersionNo ??
        (await this.versionModel().query().where('budgetId', sourceBudget.id).max('versionNo as max').first() as any)?.max;
      const version = await this.validator.getVersionOrThrow(sourceBudget.id, Number(versionNo));
      const sourceMonths = periodMonths(dateOnly(sourceBudget.startDate), dateOnly(sourceBudget.endDate));
      const lines = await this.lineModel().query().where('versionId', version.id).whereIn('accountId', accountIds).withGraphFetched('amounts');
      series = lines.map((line) => {
        const byMonth: Record<string, Milli> = {};
        for (const a of (line as any).amounts ?? []) byMonth[dateOnly(a.month)] = toMilli(String(a.amount));
        // Month i of the source period goes to month i of this budget.
        return {
          accountId: line.accountId,
          branchId: line.branchId,
          projectId: line.projectId,
          values: months.map((_, i) => (i < sourceMonths.length ? byMonth[sourceMonths[i]] ?? 0 : 0)),
        };
      });
      source = { type: 'budget', budgetId: sourceBudget.id, reference: sourceBudget.reference, versionNo: version.versionNo };
    }

    const growth = dto.growthPercent ?? 0;
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const lines = series
      .map((s) => {
        const values = s.values.map((v) => roundTo(v * (1 + growth / 100), unit));
        const account = byId.get(s.accountId);
        return {
          accountId: s.accountId,
          account: { id: account.id, code: account.code, name: account.name, accountType: account.accountType },
          branchId: s.branchId,
          projectId: s.projectId,
          amounts: months.map((month, i) => ({ month, amount: fromMilli(values[i]) })),
          totalMilli: values.reduce((a, b) => a + b, 0),
          isZero: values.every((v) => v === 0),
        };
      })
      .filter((l) => !l.isZero)
      .map(({ isZero, totalMilli, ...l }) => ({ ...l, total: fromMilli(totalMilli), totalMilli }))
      .sort((a, b) => String(a.account.code ?? '').localeCompare(String(b.account.code ?? '')));

    return {
      source: { ...source, growthPercent: growth },
      months,
      lines: lines.map(({ totalMilli, ...l }) => l),
      total: fromMilli(lines.reduce((a, l) => a + l.totalMilli, 0)),
    };
  }
}
