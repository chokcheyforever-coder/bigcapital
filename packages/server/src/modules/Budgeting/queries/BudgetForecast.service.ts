import { Inject, Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { Knex } from 'knex';
import * as moment from 'moment';
import { ServiceError } from '@/modules/Items/ServiceError';
import { UnitOfWork } from '@/modules/Tenancy/TenancyDB/UnitOfWork.service';
import { TenantModelProxy } from '@/modules/System/models/TenantBaseModel';
import { AuditLogService } from '@/modules/AuditLogs/AuditLog.service';
import { AbilitySubject } from '@/modules/Roles/Roles.types';
import { AccountTypesUtils } from '@/libs/accounts-utils/AccountTypesUtils';
import { Account } from '@/modules/Accounts/models/Account.model';
import { Budget } from '../models/Budget.model';
import { BudgetVersion } from '../models/BudgetVersion.model';
import { BudgetLine } from '../models/BudgetLine.model';
import { BudgetValidator } from '../commands/BudgetValidator.service';
import { currencyDecimals, dateOnly, lineKey, normalizeMonth } from '../commands/BudgetCommands.service';
import {
  BUDGET_TYPE_ACCOUNT_TYPES,
  BudgetType,
  BudgetVersionKind,
  BudgetVersionStatus,
  ERRORS,
  FORECASTABLE_BUDGET_TYPES,
  PL_BUDGET_TYPES,
} from '../Budgeting.types';
import { fromMilli, Milli, periodMonths, toMilli, unitFor, BudgetCalcError } from '../calc/budget-calc';
import { addMonths, DEFAULT_RUN_RATE_MONTHS, forecastLine, ForecastMethod, projection, rollingMonths } from '../calc/forecast';
import { Direction, matchLine, variance } from '../calc/variance';
import { APPROVED_STATUSES } from '../workflow/approval';
import { CreateForecastDto, ForecastSettingsDto, ForecastVsBudgetQueryDto, RefreshForecastDto, RollingForecastQueryDto } from '../dtos/BudgetForecast.dto';
import { BudgetActualsService } from './BudgetActuals.service';
import { toBudgetDto, toVersionDto } from './BudgetQueries.service';

interface Settings {
  method: ForecastMethod;
  asOf: string;
  runRateMonths: number;
  growthPercent: number;
}

interface PlanLine {
  id: number;
  accountId: number;
  branchId: number | null;
  projectId: number | null;
  /** YYYY-MM-01 → amount */
  amounts: Record<string, Milli>;
}

const METHOD_LABEL: Record<ForecastMethod, string> = {
  budget: 'budget remainder',
  run_rate: 'run rate',
  growth: 'growth',
  seasonal: 'seasonal',
};

const pctOf = (base: Milli, value: Milli) => (base === 0 ? null : Math.round(((value - base) / Math.abs(base)) * 10_000) / 100);
const NOT_CANCELLED = (v: BudgetVersion) => v.status !== BudgetVersionStatus.Cancelled;

/**
 * Forecasts (DiTech Phase 6, design §15): forecast versions (actuals to the
 * as-of month, then a method), forecast vs budget, and a rolling forecast.
 * Actuals are matched to lines exactly as in the budget vs actual reports
 * (most specific line, else an unbudgeted row per account).
 */
@Injectable()
export class BudgetForecastService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly validator: BudgetValidator,
    private readonly auditLog: AuditLogService,
    private readonly cls: ClsService,
    private readonly actuals: BudgetActualsService,
    @Inject(Budget.name) private readonly budgetModel: TenantModelProxy<typeof Budget>,
    @Inject(BudgetVersion.name) private readonly versionModel: TenantModelProxy<typeof BudgetVersion>,
    @Inject(BudgetLine.name) private readonly lineModel: TenantModelProxy<typeof BudgetLine>,
    @Inject(Account.name) private readonly accountModel: TenantModelProxy<typeof Account>,
  ) {}

  private get userId(): number | null {
    return this.cls.get<number>('userId') ?? null;
  }

  // ------------------------------------------------------------ versions

  createForecast(budgetId: number, dto: CreateForecastDto): Promise<BudgetVersion> {
    return this.uow.withTransaction(async (trx: Knex.Transaction) => {
      const budget = await this.budgetModel().query(trx).modify('notDeleted').findById(budgetId).forUpdate();
      if (!budget) throw new ServiceError(ERRORS.BUDGET_NOT_FOUND, 'The budget was not found.', null, 404);
      this.ensureForecastable(budget);
      const versions = await this.versionModel().query(trx).where('budgetId', budgetId).orderBy('versionNo');
      const base = this.baseVersion(budget, versions, dto.baseVersionNo);
      const settings = this.settings(budget, dto);
      const lines = await this.computeLines(budget, base, settings, trx);

      const versionNo = Math.max(...versions.map((v) => v.versionNo)) + 1;
      const version = await this.versionModel().query(trx).insertAndFetch({
        budgetId,
        versionNo,
        kind: BudgetVersionKind.Forecast,
        label: dto.label?.trim() || `Forecast ${settings.asOf.slice(0, 7)} (${METHOD_LABEL[settings.method]})`,
        sourceVersionId: base.id,
        status: BudgetVersionStatus.Draft,
        lockVersion: 0,
        submissionNo: 0,
        createdBy: this.userId,
        ...this.forecastFields(settings, base),
      });
      await this.writeLines(version.id, lines, trx);
      await this.audit(trx, budgetId, 'forecast_created', { versionNo, baseVersionNo: base.versionNo, ...this.settingsDto(settings), lines: lines.length });
      return version;
    });
  }

  /** Recomputes a draft forecast with today's actuals (and optionally new settings); replaces its amounts. */
  refreshForecast(budgetId: number, versionNo: number, dto: RefreshForecastDto) {
    return this.uow.withTransaction(async (trx: Knex.Transaction) => {
      const budget = await this.validator.getBudgetOrThrow(budgetId, trx);
      const version = await this.validator.getVersionOrThrow(budgetId, versionNo, trx);
      if (version.kind !== BudgetVersionKind.Forecast) {
        throw new ServiceError(ERRORS.INVALID_FORECAST, 'Only a forecast version can be refreshed.', { kind: version.kind });
      }
      this.validator.ensureEditable(version);
      this.validator.ensureLockVersion(version, dto.lockVersion);
      const stored = JSON.parse(version.forecastParams || '{}');
      const versions = await this.versionModel().query(trx).where('budgetId', budgetId).orderBy('versionNo');
      const base = versions.find((v) => v.versionNo === stored.baseVersionNo && NOT_CANCELLED(v)) ?? this.baseVersion(budget, versions);
      const settings = this.settings(budget, {
        method: dto.method ?? (version.forecastMethod as ForecastMethod),
        // Keeps its as-of month unless a new one is given; refreshing brings in actuals posted since.
        asOfMonth: dto.asOfMonth ?? (version.forecastAsOf ? dateOnly(version.forecastAsOf).slice(0, 7) : undefined),
        runRateMonths: dto.runRateMonths ?? stored.runRateMonths,
        growthPercent: dto.growthPercent ?? stored.growthPercent,
      });
      const lines = await this.computeLines(budget, base, settings, trx);

      const old = await this.lineModel().query(trx).where('versionId', version.id).select('id');
      if (old.length) {
        await trx('budget_line_amounts').whereIn('line_id', old.map((l) => l.id)).delete();
        await this.lineModel().query(trx).whereIn('id', old.map((l) => l.id)).delete();
      }
      await this.writeLines(version.id, lines, trx);
      const lockVersion = version.lockVersion + 1;
      await this.versionModel().query(trx).patchAndFetchById(version.id, { lockVersion, ...this.forecastFields(settings, base) });
      await this.audit(trx, budgetId, 'forecast_refreshed', { versionNo, baseVersionNo: base.versionNo, ...this.settingsDto(settings), lines: lines.length });
      return { lockVersion };
    });
  }

  // ------------------------------------------------------------ reports

  /**
   * Forecast vs budget: per line, the budget for the whole period, the posted
   * actuals up to the forecast's as-of month (live), the forecast of the
   * months after it, and the projected total (actual + forecast, design §5).
   */
  async forecastVsBudget(budgetId: number, q: ForecastVsBudgetQueryDto) {
    const budget = await this.validator.getBudgetOrThrow(budgetId);
    this.ensureForecastable(budget);
    const versions = await this.versionModel().query().where('budgetId', budgetId).orderBy('versionNo');
    const forecast = q.forecastVersionNo
      ? versions.find((v) => v.versionNo === q.forecastVersionNo)
      : [...versions].reverse().find((v) => v.kind === BudgetVersionKind.Forecast && NOT_CANCELLED(v));
    if (!forecast || forecast.kind !== BudgetVersionKind.Forecast) {
      throw new ServiceError('BUDGET_NO_FORECAST', 'The budget has no forecast yet.', null, 404);
    }
    const base = this.baseVersion(budget, versions, q.baseVersionNo);
    const months = this.months(budget);
    const asOf = forecast.forecastAsOf ? dateOnly(forecast.forecastAsOf) : null;

    const [baseLines, forecastLines] = await Promise.all([this.loadLines(base.id), this.loadLines(forecast.id)]);
    const ledger = asOf && asOf >= months[0] ? await this.ledgerByLine(budget, forecastLines, months[0], asOf) : new Map<string, Record<string, Milli>>();

    // Rows: every line key of the budget and the forecast, plus unbudgeted actuals.
    type Acc = { accountId: number; branchId: number | null; projectId: number | null; budget: Record<string, Milli>; forecast: Record<string, Milli>; actual: Record<string, Milli> };
    const rows = new Map<string, Acc>();
    const rowFor = (accountId: number, branchId: number | null, projectId: number | null) => {
      const key = lineKey(accountId, branchId, projectId);
      if (!rows.has(key)) rows.set(key, { accountId, branchId, projectId, budget: {}, forecast: {}, actual: {} });
      return rows.get(key)!;
    };
    for (const l of baseLines) rowFor(l.accountId, l.branchId, l.projectId).budget = l.amounts;
    for (const l of forecastLines) {
      const r = rowFor(l.accountId, l.branchId, l.projectId);
      r.forecast = l.amounts;
      r.actual = ledger.get(`L${l.id}`) ?? {};
    }
    for (const [key, amounts] of ledger) {
      if (key.startsWith('U')) rowFor(Number(key.slice(1)), null, null).actual = amounts;
    }

    const accounts = await this.accountsFor([...rows.values()].map((r) => r.accountId));
    const direction = this.direction(budget);
    const out = [...rows.values()].map((r) => {
      const account = accounts.get(r.accountId)!;
      const budgetTotal = months.reduce((a, m) => a + (r.budget[m] ?? 0), 0);
      const p = projection(months, asOf, r.actual, r.forecast);
      return {
        account: this.accountDto(account),
        branchId: r.branchId,
        projectId: r.projectId,
        unbudgeted: !baseLines.some((l) => lineKey(l.accountId, l.branchId, l.projectId) === lineKey(r.accountId, r.branchId, r.projectId)),
        _budget: budgetTotal,
        _p: p,
        _months: months.map((m) => ({ month: m, budget: r.budget[m] ?? 0, actual: asOf && m <= asOf ? (r.actual[m] ?? 0) : null, forecast: r.forecast[m] ?? 0 })),
      };
    });
    out.sort((a, b) => String(a.account.code ?? '').localeCompare(String(b.account.code ?? '')) || a.account.name.localeCompare(b.account.name));

    const figures = (budgetTotal: Milli, p: { actualToDate: Milli; remaining: Milli; projected: Milli }, dir: Direction) => {
      const v = variance(budgetTotal, p.projected, dir);
      return {
        budget: fromMilli(budgetTotal),
        actualToDate: fromMilli(p.actualToDate),
        forecastRemaining: fromMilli(p.remaining),
        projected: fromMilli(p.projected),
        variance: fromMilli(v.variance),
        variancePercent: v.variancePercent,
        favorable: v.favorable,
      };
    };
    const sumRows = (list: typeof out, dir: Direction, sign: (r: (typeof out)[number]) => number = () => 1) => {
      const t = list.reduce(
        (acc, r) => ({
          budget: acc.budget + sign(r) * r._budget,
          actualToDate: acc.actualToDate + sign(r) * r._p.actualToDate,
          remaining: acc.remaining + sign(r) * r._p.remaining,
          projected: acc.projected + sign(r) * r._p.projected,
        }),
        { budget: 0, actualToDate: 0, remaining: 0, projected: 0 },
      );
      return {
        ...figures(t.budget, t, dir),
        months: months.map((m, i) => ({
          month: m,
          budget: fromMilli(list.reduce((a, r) => a + sign(r) * r._months[i].budget, 0)),
          actual: asOf && m <= asOf ? fromMilli(list.reduce((a, r) => a + sign(r) * (r._months[i].actual ?? 0), 0)) : null,
          forecast: fromMilli(list.reduce((a, r) => a + sign(r) * r._months[i].forecast, 0)),
        })),
      };
    };
    const roots = [...new Set(out.map((r) => r.account.rootType))];
    const isPl = PL_BUDGET_TYPES.includes(budget.type);
    return {
      budget: toBudgetDto(budget),
      baseVersion: toVersionDto(base),
      forecastVersion: toVersionDto(forecast),
      asOfMonth: asOf,
      months,
      rows: out.map(({ _budget, _p, _months, ...r }) => ({
        ...r,
        ...figures(_budget, _p, direction(r.account.rootType)),
        months: _months.map((x) => ({ month: x.month, budget: fromMilli(x.budget), actual: x.actual === null ? null : fromMilli(x.actual), forecast: fromMilli(x.forecast) })),
      })),
      groups: roots.map((rootType) => ({ rootType, ...sumRows(out.filter((r) => r.account.rootType === rootType), direction(rootType)) })),
      netIncome: isPl
        ? sumRows(
            out.filter((r) => r.account.rootType === 'income' || r.account.rootType === 'expense'),
            'income',
            (r) => (r.account.rootType === 'income' ? 1 : -1),
          )
        : null,
    };
  }

  /**
   * Rolling forecast: the next `months` (default 12) after the as-of month,
   * from actuals only, whatever budget year they fall in. Budget amounts are
   * shown for the months inside this budget's period.
   */
  async rolling(budgetId: number, q: RollingForecastQueryDto) {
    const budget = await this.validator.getBudgetOrThrow(budgetId);
    this.ensureForecastable(budget);
    const versions = await this.versionModel().query().where('budgetId', budgetId).orderBy('versionNo');
    const version = this.baseVersion(budget, versions);
    const asOf = q.asOfMonth ? normalizeMonth(q.asOfMonth) : moment().subtract(1, 'month').format('YYYY-MM-01');
    if (!asOf) throw new ServiceError(ERRORS.INVALID_FORECAST, 'asOfMonth must be a month (YYYY-MM).');
    const method = q.method ?? 'run_rate';
    const runRateMonths = q.runRateMonths ?? DEFAULT_RUN_RATE_MONTHS;
    const ahead = rollingMonths(asOf, q.months ?? 12);
    const history = Array.from({ length: 12 }, (_, i) => addMonths(asOf, i - 11));
    const inPeriod = new Set(this.months(budget));
    const unit = unitFor(currencyDecimals(budget.currencyCode));

    const lines = await this.loadLines(version.id);
    const ledger = await this.ledgerByLine(budget, lines, history[0], asOf);
    const keys = [...lines.map((l) => `L${l.id}`), ...[...ledger.keys()].filter((k) => k.startsWith('U'))];
    const accounts = await this.accountsFor(keys.map((k) => (k.startsWith('U') ? Number(k.slice(1)) : lines.find((l) => `L${l.id}` === k)!.accountId)));
    const direction = this.direction(budget);

    const rows = keys.map((key) => {
      const line = key.startsWith('L') ? lines.find((l) => `L${l.id}` === key)! : null;
      const accountId = line ? line.accountId : Number(key.slice(1));
      const actual = ledger.get(key) ?? {};
      const values = this.forecast({ months: ahead, asOf, actuals: actual, budget: {}, method, runRateMonths, growthPercent: q.growthPercent ?? 0, unit });
      return {
        account: this.accountDto(accounts.get(accountId)!),
        branchId: line?.branchId ?? null,
        projectId: line?.projectId ?? null,
        unbudgeted: !line,
        history: history.map((m) => ({ month: m, actual: actual[m] ?? 0 })),
        months: ahead.map((m, i) => ({ month: m, forecast: values[i], budget: inPeriod.has(m) && line ? (line.amounts[m] ?? 0) : null })),
      };
    });
    const live = rows.filter((r) => !r.unbudgeted || r.history.some((h) => h.actual !== 0) || r.months.some((m) => m.forecast !== 0));
    live.sort((a, b) => String(a.account.code ?? '').localeCompare(String(b.account.code ?? '')) || a.account.name.localeCompare(b.account.name));

    const total = (list: typeof live, sign: (r: (typeof live)[number]) => number = () => 1) => ({
      history: history.map((m, i) => ({ month: m, actual: fromMilli(list.reduce((a, r) => a + sign(r) * r.history[i].actual, 0)) })),
      months: ahead.map((m, i) => ({
        month: m,
        forecast: fromMilli(list.reduce((a, r) => a + sign(r) * r.months[i].forecast, 0)),
        budget: inPeriod.has(m) ? fromMilli(list.reduce((a, r) => a + sign(r) * (r.months[i].budget ?? 0), 0)) : null,
      })),
      forecastTotal: fromMilli(list.reduce((a, r) => a + sign(r) * r.months.reduce((x, m) => x + m.forecast, 0), 0)),
    });
    const isPl = PL_BUDGET_TYPES.includes(budget.type);
    return {
      budget: toBudgetDto(budget),
      version: toVersionDto(version),
      asOfMonth: asOf,
      method,
      runRateMonths,
      growthPercent: q.growthPercent ?? 0,
      historyMonths: history,
      months: ahead,
      rows: live.map((r) => ({
        ...r,
        direction: direction(r.account.rootType),
        history: r.history.map((h) => ({ month: h.month, actual: fromMilli(h.actual) })),
        months: r.months.map((m) => ({ month: m.month, forecast: fromMilli(m.forecast), budget: m.budget === null ? null : fromMilli(m.budget) })),
        forecastTotal: fromMilli(r.months.reduce((a, m) => a + m.forecast, 0)),
      })),
      groups: [...new Set(live.map((r) => r.account.rootType))].map((rootType) => ({ rootType, ...total(live.filter((r) => r.account.rootType === rootType)) })),
      netIncome: isPl
        ? total(
            live.filter((r) => r.account.rootType === 'income' || r.account.rootType === 'expense'),
            (r) => (r.account.rootType === 'income' ? 1 : -1),
          )
        : null,
    };
  }

  // ------------------------------------------------------------ helpers

  private ensureForecastable(budget: Budget) {
    if (!FORECASTABLE_BUDGET_TYPES.includes(budget.type)) {
      throw new ServiceError(ERRORS.NOT_FOR_TYPE, 'Forecasts project movements; a balance sheet budget has none.', { type: budget.type });
    }
  }

  private months(budget: Budget) {
    return periodMonths(dateOnly(budget.startDate), dateOnly(budget.endDate));
  }

  /** The budget the forecast starts from: given, else active, else latest approved, else latest non-forecast. */
  private baseVersion(budget: Budget, versions: BudgetVersion[], versionNo?: number): BudgetVersion {
    if (versionNo) {
      const v = versions.find((x) => x.versionNo === versionNo);
      if (!v) throw new ServiceError(ERRORS.VERSION_NOT_FOUND, 'The budget version was not found.', null, 404);
      return v;
    }
    const plans = versions.filter((v) => v.kind !== BudgetVersionKind.Forecast && NOT_CANCELLED(v));
    const pick =
      versions.find((v) => v.id === budget.activeVersionId) ??
      [...plans].reverse().find((v) => APPROVED_STATUSES.includes(v.status)) ??
      plans[plans.length - 1];
    if (!pick) throw new ServiceError(ERRORS.VERSION_NOT_FOUND, 'The budget has no version to forecast from.', null, 404);
    return pick;
  }

  /** Method and as-of month; as-of defaults to last month and stays between the month before the period and its last month. */
  private settings(budget: Budget, dto: ForecastSettingsDto): Settings {
    const months = this.months(budget);
    const first = addMonths(months[0], -1);
    const last = months[months.length - 1];
    let asOf: string;
    if (dto.asOfMonth) {
      const m = normalizeMonth(dto.asOfMonth);
      if (!m || m < first || m > last) {
        throw new ServiceError(ERRORS.INVALID_FORECAST, `The as-of month must be between ${first.slice(0, 7)} and ${last.slice(0, 7)}.`);
      }
      asOf = m;
    } else {
      const lastMonth = moment().subtract(1, 'month').format('YYYY-MM-01');
      asOf = lastMonth < first ? first : lastMonth > last ? last : lastMonth;
    }
    return {
      method: dto.method ?? 'run_rate',
      asOf,
      runRateMonths: dto.runRateMonths ?? DEFAULT_RUN_RATE_MONTHS,
      growthPercent: dto.growthPercent ?? 0,
    };
  }

  private settingsDto(s: Settings) {
    return { method: s.method, asOfMonth: s.asOf, runRateMonths: s.runRateMonths, growthPercent: s.growthPercent };
  }

  private forecastFields(s: Settings, base: BudgetVersion): Partial<BudgetVersion> {
    return {
      forecastMethod: s.method,
      forecastAsOf: s.asOf,
      forecastParams: JSON.stringify({ runRateMonths: s.runRateMonths, growthPercent: s.growthPercent, baseVersionNo: base.versionNo }),
    };
  }

  private forecast(input: Parameters<typeof forecastLine>[0]): Milli[] {
    try {
      return forecastLine(input);
    } catch (err) {
      if (err instanceof BudgetCalcError) throw new ServiceError(ERRORS.INVALID_FORECAST, err.message, { reason: err.code });
      throw err;
    }
  }

  /** Forecast amounts for every base line, plus a line per account with unbudgeted actuals. */
  private async computeLines(budget: Budget, base: BudgetVersion, s: Settings, trx: Knex.Transaction) {
    const months = this.months(budget);
    const unit = unitFor(currencyDecimals(budget.currencyCode));
    const baseLines = await this.loadLines(base.id, trx);
    // History: a year before the period (growth, seasonal) and the run-rate window; nothing after the as-of month.
    const ledger = await this.ledgerByLine(budget, baseLines, addMonths(months[0], -12), s.asOf, trx);
    const input = (actuals: Record<string, Milli>, budgetAmounts: Record<string, Milli>) =>
      this.forecast({ months, asOf: s.asOf, actuals, budget: budgetAmounts, method: s.method, runRateMonths: s.runRateMonths, growthPercent: s.growthPercent, unit });

    const out = baseLines.map((l) => ({ accountId: l.accountId, branchId: l.branchId, projectId: l.projectId, values: input(ledger.get(`L${l.id}`) ?? {}, l.amounts) }));
    for (const [key, actuals] of ledger) {
      if (!key.startsWith('U')) continue;
      const values = input(actuals, {});
      if (values.some((v) => v !== 0)) out.push({ accountId: Number(key.slice(1)), branchId: null, projectId: null, values });
    }
    return out.map((l) => ({ ...l, amounts: Object.fromEntries(months.map((m, i) => [m, l.values[i]])) }));
  }

  private async writeLines(versionId: number, lines: Array<{ accountId: number; branchId: number | null; projectId: number | null; amounts: Record<string, Milli> }>, trx: Knex.Transaction) {
    const amounts: Array<{ line_id: number; month: string; amount: string }> = [];
    for (const l of lines) {
      const row = await this.lineModel().query(trx).insertAndFetch({
        versionId,
        accountId: l.accountId,
        branchId: l.branchId,
        projectId: l.projectId,
        branchKey: l.branchId ?? 0,
        projectKey: l.projectId ?? 0,
      });
      for (const [month, milli] of Object.entries(l.amounts)) {
        if (milli !== 0) amounts.push({ line_id: row.id, month, amount: fromMilli(milli).toFixed(3) });
      }
    }
    for (let i = 0; i < amounts.length; i += 500) await trx('budget_line_amounts').insert(amounts.slice(i, i + 500));
  }

  private async loadLines(versionId: number, trx?: Knex.Transaction): Promise<PlanLine[]> {
    const lines = await this.lineModel().query(trx).where('versionId', versionId).withGraphFetched('amounts');
    return lines.map((l) => ({
      id: l.id,
      accountId: l.accountId,
      branchId: l.branchId,
      projectId: l.projectId,
      amounts: Object.fromEntries(((l as any).amounts ?? []).map((a: any) => [dateOnly(a.month), toMilli(String(a.amount))])),
    }));
  }

  /**
   * Posted actuals by month from `from` to the end of `to`, in the budget's own
   * branch/project, given to the most specific line (`L<id>`) or, when none
   * matches, to the account's unbudgeted row (`U<accountId>`). CAPEX counts
   * debits only, as in the reports.
   */
  private async ledgerByLine(budget: Budget, lines: PlanLine[], from: string, to: string, trx?: Knex.Transaction) {
    const allowed = await this.accountModel().query(trx).whereIn('accountType', BUDGET_TYPE_ACCOUNT_TYPES[budget.type as BudgetType] ?? []);
    const accounts = new Map(allowed.map((a) => [a.id, a]));
    const cells = await this.actuals.byDimensions({
      accountIds: [...new Set([...accounts.keys(), ...lines.map((l) => l.accountId)])],
      fromDate: from,
      toDate: moment(to).endOf('month').format('YYYY-MM-DD'),
      branchIds: budget.branchId ? [budget.branchId] : undefined,
      projectIds: budget.projectId ? [budget.projectId] : undefined,
    });
    const missing = [...new Set(cells.map((c) => c.accountId).filter((id) => !accounts.has(id)))];
    if (missing.length) for (const a of await this.accountModel().query(trx).whereIn('id', missing)) accounts.set(a.id, a);

    const out = new Map<string, Record<string, Milli>>();
    for (const c of cells) {
      const account = accounts.get(c.accountId);
      if (!account) continue;
      const line = matchLine(lines, c.accountId, c.branchId, c.projectId);
      const key = line ? `L${line.id}` : `U${c.accountId}`;
      const amount = budget.type === BudgetType.Capex ? c.debit : account.accountNormal === 'credit' ? c.credit - c.debit : c.debit - c.credit;
      const series = out.get(key) ?? {};
      series[c.month] = (series[c.month] ?? 0) + amount;
      out.set(key, series);
    }
    return out;
  }

  private async accountsFor(ids: number[]) {
    const unique = [...new Set(ids)];
    const rows = unique.length ? await this.accountModel().query().whereIn('id', unique) : [];
    return new Map(rows.map((a) => [a.id, a]));
  }

  private accountDto(a: Account) {
    return { id: a.id, code: a.code, name: a.name, accountType: a.accountType, rootType: AccountTypesUtils.getType(a.accountType, 'rootType') as string, normal: a.accountNormal };
  }

  /** Income and cash: more is favorable; spending (expense, CAPEX asset): less is. */
  private direction(budget: Budget) {
    return (rootType: string): Direction =>
      budget.type === BudgetType.CashFlow ? 'income' : rootType === 'expense' || rootType === 'asset' ? 'spend' : 'income';
  }

  private audit(trx: Knex.Transaction, budgetId: number, action: string, metadata: Record<string, unknown>) {
    return this.auditLog.record({ action, subject: AbilitySubject.Budget, subjectId: budgetId, metadata, trx });
  }
}
