import { Inject, Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { Knex } from 'knex';
import * as moment from 'moment';
import { pick } from 'lodash';
import { ServiceError } from '@/modules/Items/ServiceError';
import { UnitOfWork } from '@/modules/Tenancy/TenancyDB/UnitOfWork.service';
import { TenancyContext } from '@/modules/Tenancy/TenancyContext.service';
import { TenantModelProxy } from '@/modules/System/models/TenantBaseModel';
import { AuditLogService } from '@/modules/AuditLogs/AuditLog.service';
import { AbilitySubject } from '@/modules/Roles/Roles.types';
import { Budget } from '../models/Budget.model';
import { BudgetVersion } from '../models/BudgetVersion.model';
import { BudgetLine } from '../models/BudgetLine.model';
import { CreateBudgetDto, EditBudgetDto, SaveBudgetLinesDto } from '../dtos/Budget.dto';
import {
  BudgetVersionKind,
  BudgetVersionStatus,
  DELETABLE_STATUSES,
  ERRORS,
  MAX_BUDGET_MONTHS,
} from '../Budgeting.types';
import { BudgetCalcError, fiscalYearPeriod, MONTH_NAMES, periodMonths, toMilli } from '../calc/budget-calc';
import { BudgetValidator } from './BudgetValidator.service';

const HEADER_FIELDS = ['reference', 'name', 'ownerUserId', 'description', 'notes'] as const;
const MAX_AUDIT_CHANGES = 200;

export const dateOnly = (d: Date | string) => moment(d).format('YYYY-MM-DD');
export const lineKey = (accountId: number, branchId?: number | null, projectId?: number | null) =>
  `${accountId}:${branchId || 0}:${projectId || 0}`;

/** Digits a currency is quoted in (USD 2, JPY 0); never more than the ledger's 3. */
export const currencyDecimals = (currencyCode: string) => {
  try {
    return Math.min(new Intl.NumberFormat('en', { style: 'currency', currency: currencyCode }).resolvedOptions().maximumFractionDigits, 3);
  } catch {
    return 2;
  }
};

/** "2027-01" or "2027-01-01" → "2027-01-01"; anything else is refused by the caller. */
export const normalizeMonth = (key: string): string | null => {
  const m = /^(\d{4})-(\d{2})(?:-01)?$/.exec(key.trim());
  return m && Number(m[2]) >= 1 && Number(m[2]) <= 12 ? `${m[1]}-${m[2]}-01` : null;
};

@Injectable()
export class BudgetCommandsService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly validator: BudgetValidator,
    private readonly auditLog: AuditLogService,
    private readonly tenancyContext: TenancyContext,
    private readonly cls: ClsService,

    @Inject(Budget.name) private readonly budgetModel: TenantModelProxy<typeof Budget>,
    @Inject(BudgetVersion.name) private readonly versionModel: TenantModelProxy<typeof BudgetVersion>,
    @Inject(BudgetLine.name) private readonly lineModel: TenantModelProxy<typeof BudgetLine>,
  ) {}

  private get userId(): number | null {
    return this.cls.get<number>('userId') ?? null;
  }

  // ------------------------------------------------------------ budgets

  async createBudget(dto: CreateBudgetDto): Promise<Budget> {
    const metadata = await this.tenancyContext.getTenantMetadata();
    const period = this.resolvePeriod(dto, metadata.fiscalYear);

    return this.uow.withTransaction(async (trx: Knex.Transaction) => {
      const reference = dto.reference?.trim() || (await this.nextReference(dto.fiscalYear, trx));
      await this.validator.validateReferenceUnique(reference, undefined, trx);
      await this.validator.validateBranches([dto.branchId], trx);
      await this.validator.validateProjects([dto.projectId], trx);

      const budget = await this.budgetModel().query(trx).insertAndFetch({
        reference,
        name: dto.name.trim(),
        type: dto.type,
        fiscalYear: dto.fiscalYear,
        startDate: period.startDate,
        endDate: period.endDate,
        currencyCode: metadata.baseCurrency,
        branchId: dto.branchId ?? null,
        projectId: dto.projectId ?? null,
        ownerUserId: dto.ownerUserId ?? this.userId,
        description: dto.description?.trim() || null,
        notes: dto.notes?.trim() || null,
        createdBy: this.userId,
      });
      await this.versionModel().query(trx).insert({
        budgetId: budget.id,
        versionNo: 1,
        kind: BudgetVersionKind.Original,
        label: 'Original',
        status: BudgetVersionStatus.Draft,
        lockVersion: 0,
        createdBy: this.userId,
      });
      await this.auditLog.record({
        action: 'created',
        subject: AbilitySubject.Budget,
        subjectId: budget.id,
        metadata: { after: pick(budget, ['reference', 'name', 'type', 'fiscalYear', 'startDate', 'endDate', 'currencyCode', 'branchId', 'projectId']) },
        trx,
      });
      return budget;
    });
  }

  editBudget(budgetId: number, dto: EditBudgetDto): Promise<Budget> {
    return this.uow.withTransaction(async (trx: Knex.Transaction) => {
      const old = await this.validator.getBudgetOrThrow(budgetId, trx);
      const reference = dto.reference?.trim() || old.reference;
      if (reference !== old.reference) await this.validator.validateReferenceUnique(reference, budgetId, trx);

      const budget = await this.budgetModel().query(trx).patchAndFetchById(budgetId, {
        reference,
        name: dto.name.trim(),
        ownerUserId: dto.ownerUserId ?? old.ownerUserId,
        description: dto.description === undefined ? old.description : dto.description?.trim() || null,
        notes: dto.notes === undefined ? old.notes : dto.notes?.trim() || null,
      });
      await this.auditLog.record({
        action: 'edited',
        subject: AbilitySubject.Budget,
        subjectId: budgetId,
        metadata: { before: pick(old, HEADER_FIELDS), after: pick(budget, HEADER_FIELDS) },
        trx,
      });
      return budget;
    });
  }

  deleteBudget(budgetId: number): Promise<void> {
    return this.uow.withTransaction(async (trx: Knex.Transaction) => {
      const budget = await this.validator.getBudgetOrThrow(budgetId, trx);
      const versions = await this.versionModel().query(trx).where('budgetId', budgetId);
      const blocking = versions.filter((v) => !DELETABLE_STATUSES.includes(v.status));
      if (blocking.length > 0) {
        throw new ServiceError(ERRORS.BUDGET_NOT_DELETABLE, 'A budget with a submitted, approved or locked version cannot be deleted.', {
          versions: blocking.map((v) => ({ versionNo: v.versionNo, status: v.status })),
        }, 409);
      }
      await this.budgetModel().query(trx).patchAndFetchById(budgetId, { deletedAt: moment().toDate() });
      await this.auditLog.record({
        action: 'deleted',
        subject: AbilitySubject.Budget,
        subjectId: budgetId,
        metadata: { before: pick(budget, ['reference', 'name', 'type', 'fiscalYear']) },
        trx,
      });
    });
  }

  // ------------------------------------------------------------ lines

  /**
   * Adds or updates lines and their monthly amounts in one transaction. Only the
   * months given change (null removes a month); lines not mentioned stay as
   * they are. Refused if the version changed since the caller read it.
   */
  saveLines(budgetId: number, versionNo: number, dto: SaveBudgetLinesDto): Promise<{ lockVersion: number }> {
    return this.uow.withTransaction(async (trx: Knex.Transaction) => {
      const budget = await this.validator.getBudgetOrThrow(budgetId, trx);
      const version = await this.validator.getVersionOrThrow(budgetId, versionNo, trx);
      this.validator.ensureEditable(version);
      this.validator.ensureLockVersion(version, dto.lockVersion);

      const months = new Set(periodMonths(dateOnly(budget.startDate), dateOnly(budget.endDate)));
      const decimals = currencyDecimals(budget.currencyCode);

      // Validate the request before touching anything.
      const seen = new Map<string, number>();
      dto.lines.forEach((line, index) => {
        const key = lineKey(line.accountId, line.branchId, line.projectId);
        if (seen.has(key)) {
          throw new ServiceError(ERRORS.DUPLICATE_LINE, 'The same account, branch and project appear twice.', {
            indexes: [seen.get(key), index],
          });
        }
        seen.set(key, index);
      });
      const parsed = dto.lines.map((line, index) => {
        const amounts = new Map<string, number | null>();
        for (const { month: rawMonth, amount: value } of line.amounts ?? []) {
          const month = normalizeMonth(String(rawMonth ?? ''));
          if (!month || !months.has(month)) {
            throw new ServiceError(ERRORS.MONTH_OUTSIDE_PERIOD, `${rawMonth} is not a month of this budget.`, { index, month: rawMonth });
          }
          if (amounts.has(month)) {
            throw new ServiceError(ERRORS.INVALID_AMOUNT, `${rawMonth} is given twice.`, { index, month: rawMonth, reason: 'DUPLICATE_MONTH' });
          }
          if (value === null || value === undefined || value === '') {
            amounts.set(month, null);
            continue;
          }
          try {
            amounts.set(month, toMilli(value as number | string, decimals));
          } catch (err) {
            if (!(err instanceof BudgetCalcError)) throw err;
            throw new ServiceError(ERRORS.INVALID_AMOUNT, err.message, { index, month: rawMonth, reason: err.code });
          }
        }
        return { line, index, amounts };
      });

      await this.validator.getAccountsOrThrow(budget.type, dto.lines.map((l) => l.accountId), trx);
      await this.validator.validateBranches(dto.lines.map((l) => l.branchId), trx);
      await this.validator.validateProjects(dto.lines.map((l) => l.projectId), trx);

      const existing = await this.lineModel().query(trx).where('versionId', version.id);
      const byKey = new Map(existing.map((l) => [lineKey(l.accountId, l.branchId, l.projectId), l]));
      const removeIds = [...new Set(dto.removeLineIds ?? [])];
      const unknown = removeIds.filter((id) => !existing.some((l) => l.id === id));
      if (unknown.length > 0) {
        throw new ServiceError(ERRORS.LINE_NOT_FOUND, 'Some lines to remove are not in this version.', { lineIds: unknown }, 404);
      }

      // Amounts before the change, for the audit trail.
      const touchedIds = existing.filter((l) => removeIds.includes(l.id) || seen.has(lineKey(l.accountId, l.branchId, l.projectId))).map((l) => l.id);
      const beforeRows = touchedIds.length
        ? await trx('budget_line_amounts').whereIn('line_id', touchedIds).select('line_id', 'month', 'amount')
        : [];
      const before = new Map<string, number>(
        beforeRows.map((r: any) => [`${r.lineId ?? r.line_id}|${dateOnly(r.month)}`, toMilli(String(r.amount))]),
      );

      if (removeIds.length > 0) {
        await trx('budget_line_amounts').whereIn('line_id', removeIds).delete();
        await this.lineModel().query(trx).whereIn('id', removeIds).delete();
      }

      const changes: Array<Record<string, unknown>> = [];
      let added = 0;
      let updated = 0;
      for (const { line, amounts } of parsed) {
        const key = lineKey(line.accountId, line.branchId, line.projectId);
        let target = byKey.get(key);
        if (target && removeIds.includes(target.id)) target = undefined;

        if (!target) {
          target = await this.lineModel().query(trx).insertAndFetch({
            versionId: version.id,
            accountId: line.accountId,
            branchId: line.branchId || null,
            projectId: line.projectId || null,
            branchKey: line.branchId || 0,
            projectKey: line.projectId || 0,
            note: line.note?.trim() || null,
            assumption: line.assumption?.trim() || null,
          });
          added++;
        } else {
          const patch: Partial<BudgetLine> = {};
          if (line.note !== undefined) patch.note = line.note?.trim() || null;
          if (line.assumption !== undefined) patch.assumption = line.assumption?.trim() || null;
          if (Object.keys(patch).length > 0) await this.lineModel().query(trx).patchAndFetchById(target.id, patch);
          updated++;
        }

        const upserts: Array<{ line_id: number; month: string; amount: string }> = [];
        const deletes: string[] = [];
        for (const [month, milli] of amounts) {
          const old = before.get(`${target.id}|${month}`) ?? null;
          if (milli === null) deletes.push(month);
          else upserts.push({ line_id: target.id, month, amount: (milli / 1000).toFixed(3) });
          if (old !== milli && changes.length < MAX_AUDIT_CHANGES) {
            changes.push({
              accountId: line.accountId,
              branchId: line.branchId || null,
              projectId: line.projectId || null,
              month,
              before: old === null ? null : old / 1000,
              after: milli === null ? null : milli / 1000,
            });
          }
        }
        if (deletes.length > 0) await trx('budget_line_amounts').where('line_id', target.id).whereIn('month', deletes).delete();
        if (upserts.length > 0) await trx('budget_line_amounts').insert(upserts).onConflict(['line_id', 'month']).merge(['amount']);
      }

      const lockVersion = version.lockVersion + 1;
      await this.versionModel().query(trx).patchAndFetchById(version.id, { lockVersion });
      await this.auditLog.record({
        action: 'lines_saved',
        subject: AbilitySubject.Budget,
        subjectId: budgetId,
        metadata: {
          versionNo,
          added,
          updated,
          removed: removeIds.length,
          changes,
          changesTruncated: changes.length >= MAX_AUDIT_CHANGES,
        },
        trx,
      });
      return { lockVersion };
    });
  }

  // ------------------------------------------------------------ helpers

  private resolvePeriod(dto: CreateBudgetDto, fiscalYearMonth?: string) {
    const startMonth = Math.max(MONTH_NAMES.indexOf((fiscalYearMonth ?? 'january').toLowerCase()), 0) + 1;
    const fiscal = fiscalYearPeriod(dto.fiscalYear, startMonth);
    if (!dto.startDate && !dto.endDate) return fiscal;

    const start = moment(dto.startDate ?? fiscal.startDate, 'YYYY-MM-DD', true);
    const end = moment(dto.endDate ?? fiscal.endDate, 'YYYY-MM-DD', true);
    const invalid = (message: string) => new ServiceError(ERRORS.INVALID_PERIOD, message);
    if (!start.isValid() || !end.isValid()) throw invalid('The start and end dates must be valid dates.');
    if (start.date() !== 1) throw invalid('A budget starts on the first day of a month.');
    if (!end.isSame(end.clone().endOf('month'), 'day')) throw invalid('A budget ends on the last day of a month.');
    const count = periodMonths(start.format('YYYY-MM-DD'), end.format('YYYY-MM-DD')).length;
    if (!end.isAfter(start) || count < 1 || count > MAX_BUDGET_MONTHS) {
      throw invalid(`A budget covers 1 to ${MAX_BUDGET_MONTHS} months.`);
    }
    return { startDate: start.format('YYYY-MM-DD'), endDate: end.format('YYYY-MM-DD') };
  }

  private async nextReference(fiscalYear: number, trx: Knex.Transaction): Promise<string> {
    const prefix = `BUD-${fiscalYear}-`;
    const rows = await this.budgetModel().query(trx).where('reference', 'like', `${prefix}%`).select('reference');
    const max = rows.reduce((n, r) => Math.max(n, Number(r.reference.slice(prefix.length)) || 0), 0);
    return `${prefix}${String(max + 1).padStart(3, '0')}`;
  }
}
