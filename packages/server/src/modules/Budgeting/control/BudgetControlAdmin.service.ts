import { Inject, Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { Knex } from 'knex';
import * as moment from 'moment';
import { ServiceError } from '@/modules/Items/ServiceError';
import { UnitOfWork } from '@/modules/Tenancy/TenancyDB/UnitOfWork.service';
import { TenantModelProxy } from '@/modules/System/models/TenantBaseModel';
import { AuditLogService } from '@/modules/AuditLogs/AuditLog.service';
import { AbilitySubject } from '@/modules/Roles/Roles.types';
import { Budget } from '../models/Budget.model';
import { BudgetControlPolicy } from '../models/BudgetControlPolicy.model';
import { BudgetOverride } from '../models/BudgetOverride.model';
import { BudgetControlEvent } from '../models/BudgetControlEvent.model';
import { BudgetApprovalRule } from '../models/BudgetApprovalRule.model';
import { fromMilli, toMilli } from '../calc/budget-calc';
import { CONTROLLED_TYPES, ControlledType, LEDGER_REFERENCE, normalizeThresholds } from '../calc/control';
import { pickRule } from '../workflow/approval';
import { CONTROLLABLE_BUDGET_TYPES, ERRORS } from '../Budgeting.types';
import { parseRule } from '../commands/BudgetWorkflow.service';
import { dateOnly } from '../commands/BudgetCommands.service';
import {
  GetControlEventsQueryDto,
  GetOverridesQueryDto,
  RequestOverrideDto,
  SaveControlPolicyDto,
} from '../dtos/BudgetControl.dto';
import { BudgetControlService, parsePolicy, Policy, toCheckDto } from './BudgetControl.service';
import { BudgetDocumentLedgerService } from './BudgetDocumentLedger.service';
import { BudgetNotificationService } from '../notifications/BudgetNotification.service';

const TYPE_BY_REFERENCE = Object.fromEntries(Object.entries(LEDGER_REFERENCE).map(([k, v]) => [v, k])) as Record<string, ControlledType>;

const toPolicyDto = (p: Policy) => p;

const toOverrideDto = (o: BudgetOverride, budget?: Budget) => ({
  id: o.id,
  budgetId: o.budgetId,
  budgetReference: budget?.reference ?? null,
  budgetName: budget?.name ?? null,
  versionId: o.versionId,
  lineId: o.lineId,
  accountId: o.accountId,
  referenceType: TYPE_BY_REFERENCE[o.referenceType] ?? o.referenceType,
  referenceId: o.referenceId,
  periodFrom: dateOnly(o.periodFrom),
  periodTo: dateOnly(o.periodTo),
  amount: Number(o.amount),
  reason: o.reason,
  status: o.status,
  requestedBy: o.requestedBy,
  decidedBy: o.decidedBy,
  decidedAt: o.decidedAt,
  comment: o.comment,
  createdAt: o.createdAt,
});

/** Policies, override requests and the alerts log (design §13). */
@Injectable()
export class BudgetControlAdminService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly control: BudgetControlService,
    private readonly documents: BudgetDocumentLedgerService,
    private readonly auditLog: AuditLogService,
    private readonly cls: ClsService,
    private readonly notifier: BudgetNotificationService,
    @Inject(Budget.name) private readonly budgetModel: TenantModelProxy<typeof Budget>,
    @Inject(BudgetControlPolicy.name) private readonly policyModel: TenantModelProxy<typeof BudgetControlPolicy>,
    @Inject(BudgetOverride.name) private readonly overrideModel: TenantModelProxy<typeof BudgetOverride>,
    @Inject(BudgetControlEvent.name) private readonly eventModel: TenantModelProxy<typeof BudgetControlEvent>,
    @Inject(BudgetApprovalRule.name) private readonly ruleModel: TenantModelProxy<typeof BudgetApprovalRule>,
  ) {}

  private get userId(): number {
    return this.cls.get<number>('userId');
  }

  // ------------------------------------------------------------ policies

  async getPolicies() {
    const policies = await this.control.policies();
    return {
      default: policies.find((p) => p.budgetId === null) ?? null,
      budgets: policies.filter((p) => p.budgetId !== null).map(toPolicyDto),
    };
  }

  savePolicy(dto: SaveControlPolicyDto) {
    return this.uow.withTransaction(async (trx: Knex.Transaction) => {
      const budgetId = dto.budgetId ?? null;
      if (budgetId) {
        const budget = await this.budgetModel().query(trx).modify('notDeleted').findById(budgetId);
        if (!budget) throw new ServiceError('BUDGET_NOT_FOUND', 'The budget was not found.', null, 404);
        if (!CONTROLLABLE_BUDGET_TYPES.includes(budget.type)) {
          throw new ServiceError(ERRORS.NOT_FOR_TYPE, 'Spending control applies to P&L, expense and CAPEX budgets only.', { type: budget.type });
        }
      }
      let thresholds: number[];
      try {
        thresholds = normalizeThresholds(dto.thresholds);
      } catch (err) {
        throw new ServiceError('BUDGET_INVALID_POLICY', (err as Error).message);
      }
      const types = [...new Set(dto.transactionTypes ?? CONTROLLED_TYPES)];
      const row = {
        budgetId,
        mode: dto.mode,
        thresholds: JSON.stringify(thresholds),
        periodBasis: dto.periodBasis ?? 'month',
        transactionTypes: JSON.stringify(types),
      };
      const existing = await this.policyModel()
        .query(trx)
        .modify((q) => (budgetId ? q.where('budgetId', budgetId) : q.whereNull('budgetId')))
        .forUpdate()
        .first();
      const before = existing ? parsePolicy(existing) : null;
      const saved = existing
        ? await this.policyModel().query(trx).patchAndFetchById(existing.id, row)
        : await this.policyModel().query(trx).insertAndFetch(row);
      await this.auditLog.record({
        action: 'control_policy_saved',
        subject: AbilitySubject.Budget,
        subjectId: budgetId,
        metadata: { before, after: parsePolicy(saved) },
        trx,
      });
      return parsePolicy(saved);
    });
  }

  /** Removes a budget's own policy (it then follows the default) or, with null, the default. */
  deletePolicy(budgetId: number | null) {
    return this.uow.withTransaction(async (trx: Knex.Transaction) => {
      const existing = await this.policyModel()
        .query(trx)
        .modify((q) => (budgetId ? q.where('budgetId', budgetId) : q.whereNull('budgetId')))
        .first();
      if (!existing) throw new ServiceError('BUDGET_POLICY_NOT_FOUND', 'There is no policy to remove.', null, 404);
      await this.policyModel().query(trx).deleteById(existing.id);
      await this.auditLog.record({
        action: 'control_policy_removed',
        subject: AbilitySubject.Budget,
        subjectId: budgetId,
        metadata: { before: parsePolicy(existing) },
        trx,
      });
    });
  }

  // ------------------------------------------------------------ overrides

  /**
   * Asks to post a draft document over its budget: one pending override per
   * budget line it would exceed under a `warn_approve` policy.
   */
  requestOverride(dto: RequestOverrideDto) {
    return this.uow.withTransaction(async (trx: Knex.Transaction) => {
      const posted = await this.documents.isPosted(dto.referenceType, dto.referenceId, trx);
      if (posted === null) throw new ServiceError('BUDGET_DOCUMENT_NOT_FOUND', 'The document was not found.', null, 404);
      if (posted) throw new ServiceError('BUDGET_OVERRIDE_NOT_NEEDED', 'The document is already posted.');

      const checks = (await this.control.check(dto.referenceType, dto.referenceId, trx, false)).filter(
        (c) => c.level === 'exceeded' && c.mode === 'warn_approve',
      );
      if (checks.length === 0) {
        throw new ServiceError('BUDGET_OVERRIDE_NOT_NEEDED', 'The document stays within its budgets, or no budget needs an approval for it.');
      }
      const referenceType = LEDGER_REFERENCE[dto.referenceType];
      await this.overrideModel()
        .query(trx)
        .where({ referenceType, referenceId: dto.referenceId, status: 'pending' })
        .patch({ status: 'cancelled' });
      const created: BudgetOverride[] = [];
      for (const c of checks) {
        created.push(
          await this.overrideModel().query(trx).insertAndFetch({
            budgetId: c.budgetId,
            versionId: c.versionId,
            lineId: c.lineId,
            accountId: c.accountId,
            referenceType,
            referenceId: dto.referenceId,
            periodFrom: c.periodFrom,
            periodTo: c.periodTo,
            amount: fromMilli(c.excess).toFixed(3),
            reason: dto.reason.trim(),
            status: 'pending',
            requestedBy: this.userId,
          }),
        );
        await this.auditLog.record({
          action: 'override_requested',
          subject: AbilitySubject.Budget,
          subjectId: c.budgetId,
          metadata: { referenceType: dto.referenceType, referenceId: dto.referenceId, lineId: c.lineId, amount: fromMilli(c.excess), reason: dto.reason.trim() },
          trx,
        });
      }
      // Approvers hear about it; the requester too when the rule for that amount lets them decide it.
      const budgets = await this.budgetModel().query(trx).whereIn('id', [...new Set(created.map((o) => o.budgetId))]);
      const total = created.reduce((a, o) => a + toMilli(String(o.amount)), 0);
      const rule = pickRule((await this.ruleModel().query(trx)).map(parseRule), total);
      const label = await this.documents.label(dto.referenceType, dto.referenceId, trx);
      await this.notifier.overrideRequested(trx, budgets, created, label, dto.reason.trim(), rule.preventSelfApproval ? [this.userId] : []);
      return { overrides: created.map((o) => toOverrideDto(o)), checks: checks.map(toCheckDto) };
    });
  }

  async getOverrides(query: GetOverridesQueryDto) {
    const q = this.overrideModel().query().orderBy('id', 'desc').limit(500);
    if (query.status) q.where('status', query.status);
    if (query.referenceType) q.where('referenceType', LEDGER_REFERENCE[query.referenceType]);
    if (query.referenceId) q.where('referenceId', query.referenceId);
    const rows = await q;
    const budgets = rows.length ? await this.budgetModel().query().whereIn('id', [...new Set(rows.map((r) => r.budgetId))]) : [];
    return { data: rows.map((r) => toOverrideDto(r, budgets.find((b) => b.id === r.budgetId))) };
  }

  decideOverride(id: number, decision: 'approved' | 'rejected', comment?: string) {
    return this.uow.withTransaction(async (trx: Knex.Transaction) => {
      const override = await this.overrideModel().query(trx).findById(id).forUpdate();
      if (!override) throw new ServiceError('BUDGET_OVERRIDE_NOT_FOUND', 'The override request was not found.', null, 404);
      if (override.status !== 'pending') {
        throw new ServiceError('BUDGET_INVALID_STATUS', `A ${override.status} override cannot be ${decision}.`, null, 409);
      }
      // Same self-approval setting as the approval rule for that amount.
      const rules = (await this.ruleModel().query(trx)).map(parseRule);
      const rule = pickRule(rules, toMilli(String(override.amount)));
      if (rule.preventSelfApproval && override.requestedBy === this.userId) {
        throw new ServiceError('BUDGET_SELF_APPROVAL', 'You requested this override, so someone else must decide it.', null, 403);
      }
      const saved = await this.overrideModel().query(trx).patchAndFetchById(id, {
        status: decision,
        decidedBy: this.userId,
        decidedAt: moment().toDate(),
        comment: comment?.trim() || null,
      });
      await this.auditLog.record({
        action: decision === 'approved' ? 'override_approved' : 'override_rejected',
        subject: AbilitySubject.Budget,
        subjectId: override.budgetId,
        metadata: { overrideId: id, referenceType: override.referenceType, referenceId: override.referenceId, amount: Number(override.amount), comment: comment?.trim() || null },
        trx,
      });
      const budget = await this.budgetModel().query(trx).findById(override.budgetId);
      const type = TYPE_BY_REFERENCE[override.referenceType];
      const label = type ? await this.documents.label(type, override.referenceId, trx) : `${override.referenceType} #${override.referenceId}`;
      await this.notifier.overrideDecided(trx, budget ?? null, saved, label);
      return toOverrideDto(saved);
    });
  }

  // ------------------------------------------------------------ alerts

  async getEvents(query: GetControlEventsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const q = this.eventModel().query().orderBy('id', 'desc');
    if (query.budgetId) q.where('budgetId', query.budgetId);
    if (query.level) q.where('level', query.level);
    const { results, total } = await q.page(page - 1, pageSize);
    return {
      data: results.map((e) => ({
        id: e.id,
        budgetId: e.budgetId,
        lineId: e.lineId,
        accountId: e.accountId,
        referenceType: TYPE_BY_REFERENCE[e.referenceType] ?? e.referenceType,
        referenceId: e.referenceId,
        periodFrom: dateOnly(e.periodFrom),
        periodTo: dateOnly(e.periodTo),
        budget: Number(e.budgetAmount),
        usedBefore: Number(e.usedBefore),
        document: Number(e.documentAmount),
        percentAfter: e.percentAfter === null ? null : Number(e.percentAfter),
        level: e.level,
        mode: e.mode,
        outcome: e.outcome,
        createdBy: e.createdBy,
        createdAt: e.createdAt,
      })),
      pagination: { page, pageSize, total },
    };
  }
}
