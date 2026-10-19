import { Inject, Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import * as moment from 'moment';
import { ServiceError } from '@/modules/Items/ServiceError';
import { TenantModelProxy } from '@/modules/System/models/TenantBaseModel';
import { Budget } from '../models/Budget.model';
import { BudgetOverride } from '../models/BudgetOverride.model';
import { BudgetControlEvent } from '../models/BudgetControlEvent.model';
import { BudgetNotification } from '../models/BudgetNotification.model';
import { BudgetValidator } from '../commands/BudgetValidator.service';
import { dateOnly, normalizeMonth } from '../commands/BudgetCommands.service';
import { BudgetDashboardQueryDto } from '../dtos/BudgetForecast.dto';
import { BudgetReportQueryDto } from '../dtos/Budget.dto';
import { BudgetVersionKind, BudgetVersionStatus, ERRORS, FORECASTABLE_BUDGET_TYPES, PL_BUDGET_TYPES } from '../Budgeting.types';
import { periodMonths } from '../calc/budget-calc';
import { BudgetReportsService } from './BudgetReports.service';
import { BudgetForecastService } from './BudgetForecast.service';
import { BudgetWorkflowQueriesService } from './BudgetWorkflowQueries.service';
import { toBudgetDto } from './BudgetQueries.service';

const TOP = 5;

/**
 * Budget dashboard (design §15). Every figure is taken from the budget reports
 * (budget vs actual for the year and for the year to date, exceptions,
 * forecast vs budget), so the dashboard always equals them.
 */
@Injectable()
export class BudgetDashboardService {
  constructor(
    private readonly cls: ClsService,
    private readonly validator: BudgetValidator,
    private readonly reports: BudgetReportsService,
    private readonly forecasts: BudgetForecastService,
    private readonly workflowQueries: BudgetWorkflowQueriesService,
    @Inject(Budget.name) private readonly budgetModel: TenantModelProxy<typeof Budget>,
    @Inject(BudgetOverride.name) private readonly overrideModel: TenantModelProxy<typeof BudgetOverride>,
    @Inject(BudgetControlEvent.name) private readonly eventModel: TenantModelProxy<typeof BudgetControlEvent>,
    @Inject(BudgetNotification.name) private readonly notificationModel: TenantModelProxy<typeof BudgetNotification>,
  ) {}

  async dashboard(q: BudgetDashboardQueryDto) {
    const userId = this.cls.get<number>('userId');
    const budgets = await this.budgetModel()
      .query()
      .modify('notDeleted')
      .orderBy([{ column: 'startDate', order: 'desc' }, { column: 'id', order: 'desc' }]);
    const choices = budgets.map((b) => ({ id: b.id, reference: b.reference, name: b.name, type: b.type, fiscalYear: b.fiscalYear, hasActiveVersion: !!b.activeVersionId }));

    const [approvals, pendingOverrides, alerts30, unread] = await Promise.all([
      this.workflowQueries.getApprovals({ mine: true } as any),
      this.overrideModel().query().where('status', 'pending').resultSize(),
      this.eventModel().query().where('createdAt', '>=', moment().subtract(30, 'days').toDate()).whereIn('level', ['warning', 'exceeded']).resultSize(),
      this.notificationModel().query().where('userId', userId).whereNull('readAt').resultSize(),
    ]);
    const workflow = { waitingForMe: approvals.data.length, pendingOverrides, alertsLast30Days: alerts30, unreadNotifications: unread };

    const budget = q.budgetId
      ? await this.validator.getBudgetOrThrow(q.budgetId)
      : (budgets.find((b) => b.activeVersionId) ?? budgets[0] ?? null);
    if (!budget) return { budgets: choices, budget: null, workflow };

    const months = periodMonths(dateOnly(budget.startDate), dateOnly(budget.endDate));
    const asOf = this.asOf(q.asOfMonth, months);
    const base = { budgetId: budget.id } as BudgetReportQueryDto;

    // Whole period by month, and year to date (nothing yet when the period has not started).
    const annual = await this.reports.report('budget-vs-actual', { ...base, columns: 'month' } as BudgetReportQueryDto);
    const ytd = asOf ? await this.reports.report('budget-vs-actual', { ...base, fromMonth: months[0], toMonth: asOf } as BudgetReportQueryDto) : null;
    const exceptions = asOf ? await this.reports.report('exceptions', { ...base, fromMonth: months[0], toMonth: asOf } as BudgetReportQueryDto) : null;

    const group = (r: typeof annual | null, rootType: string) => r?.groups.find((g) => g.rootType === rootType)?.total ?? null;
    const isPl = PL_BUDGET_TYPES.includes(budget.type);
    const ytdRows = ytd?.rows ?? [];

    const kpis = {
      // P&L-style budgets: revenue achievement, expense utilization and net income.
      revenue: isPl
        ? {
            annualBudget: group(annual, 'income')?.budget ?? 0,
            ytdBudget: group(ytd, 'income')?.budget ?? 0,
            ytdActual: group(ytd, 'income')?.actual ?? 0,
            achievementPercent: group(ytd, 'income')?.usedPercent ?? null,
          }
        : null,
      expenses: isPl
        ? (() => {
            const annualBudget = group(annual, 'expense')?.budget ?? 0;
            const ytdActual = group(ytd, 'expense')?.actual ?? 0;
            return {
              annualBudget,
              ytdBudget: group(ytd, 'expense')?.budget ?? 0,
              ytdActual,
              utilizationPercent: group(ytd, 'expense')?.usedPercent ?? null,
              annualUsedPercent: annualBudget === 0 ? null : Math.round((ytdActual / annualBudget) * 10_000) / 100,
              remaining: Math.round((annualBudget - ytdActual) * 1000) / 1000,
            };
          })()
        : null,
      netIncome: annual.netIncome
        ? {
            annualBudget: annual.netIncome.total.budget,
            ytdBudget: ytd?.netIncome?.total.budget ?? 0,
            ytdActual: ytd?.netIncome?.total.actual ?? 0,
            ytdVariance: ytd?.netIncome?.total.variance ?? 0,
          }
        : null,
      // Every budget type: totals by account group, year to date and for the whole period.
      groups: annual.groups.map((g) => ({
        rootType: g.rootType,
        annualBudget: g.total.budget,
        ytd: ytd?.groups.find((y) => y.rootType === g.rootType)?.total ?? null,
      })),
      cashPosition: ytd?.cashPosition ?? null,
      lines: {
        budgeted: ytdRows.filter((r) => !r.unbudgeted).length || annual.rows.filter((r) => !r.unbudgeted).length,
        over: ytdRows.filter((r) => r.status === 'over').length,
        near: ytdRows.filter((r) => r.status === 'near').length,
        unbudgeted: ytdRows.filter((r) => r.unbudgeted).length,
        exceptions: exceptions?.rows.length ?? 0,
      },
    };

    // Months: budget and actual by month (actual up to the as-of month), with running totals.
    let cumBudget = 0;
    let cumActual = 0;
    const monthly = annual.columns.map((col, i) => {
      const done = !!asOf && col.key <= asOf;
      const net = annual.netIncome?.columns[i];
      const groups = Object.fromEntries(annual.groups.map((g) => [g.rootType, { budget: g.columns[i].budget, actual: done ? g.columns[i].actual : null }]));
      const budgetValue = net ? net.budget : annual.groups.reduce((a, g) => a + g.columns[i].budget, 0);
      const actualValue = net ? net.actual : annual.groups.reduce((a, g) => a + g.columns[i].actual, 0);
      cumBudget += budgetValue;
      if (done) cumActual += actualValue;
      return {
        month: col.key,
        label: col.label,
        groups,
        netIncome: net ? { budget: net.budget, actual: done ? net.actual : null } : null,
        cumulative: { budget: round3(cumBudget), actual: done ? round3(cumActual) : null },
      };
    });

    // Projection from the latest forecast, when there is one.
    let projection = null;
    if (FORECASTABLE_BUDGET_TYPES.includes(budget.type)) {
      try {
        const f = await this.forecasts.forecastVsBudget(budget.id, {});
        projection = {
          forecastVersionNo: f.forecastVersion.versionNo,
          asOfMonth: f.asOfMonth,
          method: f.forecastVersion.forecast?.method ?? null,
          groups: f.groups.map((g) => ({ rootType: g.rootType, budget: g.budget, projected: g.projected, variance: g.variance, variancePercent: g.variancePercent, favorable: g.favorable })),
          netIncome: f.netIncome ? { budget: f.netIncome.budget, projected: f.netIncome.projected, variance: f.netIncome.variance, variancePercent: f.netIncome.variancePercent, favorable: f.netIncome.favorable } : null,
        };
      } catch (err) {
        if (!(err instanceof ServiceError) || err.errorType !== 'BUDGET_NO_FORECAST') throw err;
      }
    }

    return {
      budgets: choices,
      budget: toBudgetDto(budget),
      version: annual.version,
      activeVersion: annual.version.id === budget.activeVersionId,
      approved: [BudgetVersionStatus.Approved, BudgetVersionStatus.Locked].includes(annual.version.status as BudgetVersionStatus) && annual.version.kind !== BudgetVersionKind.Forecast,
      currencyCode: budget.currencyCode,
      asOfMonth: asOf,
      months,
      kpis,
      monthly,
      topExceptions: (exceptions?.rows ?? []).slice(0, TOP).map((r) => ({
        account: r.account,
        branch: r.branch,
        project: r.project,
        unbudgeted: r.unbudgeted,
        budget: r.total.budget,
        actual: r.total.actual,
        variance: r.total.variance,
        variancePercent: r.total.variancePercent,
      })),
      projection,
      workflow,
    };
  }

  /** Year to date up to the given month, else last month; inside the period; null before it starts. */
  private asOf(requested: string | undefined, months: string[]): string | null {
    if (requested) {
      const m = normalizeMonth(requested);
      if (!m || !months.includes(m)) {
        throw new ServiceError(ERRORS.INVALID_PERIOD, `Choose a month between ${months[0].slice(0, 7)} and ${months[months.length - 1].slice(0, 7)}.`);
      }
      return m;
    }
    const last = moment().subtract(1, 'month').format('YYYY-MM-01');
    if (last < months[0]) return null;
    return last > months[months.length - 1] ? months[months.length - 1] : last;
  }
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
