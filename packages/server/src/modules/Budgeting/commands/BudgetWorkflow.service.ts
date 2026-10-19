import { Inject, Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { Knex } from 'knex';
import * as moment from 'moment';
import { ServiceError } from '@/modules/Items/ServiceError';
import { UnitOfWork } from '@/modules/Tenancy/TenancyDB/UnitOfWork.service';
import { TenantModelProxy } from '@/modules/System/models/TenantBaseModel';
import { AuditLogService } from '@/modules/AuditLogs/AuditLog.service';
import { AbilitySubject } from '@/modules/Roles/Roles.types';
import { getAbilityForRole } from '@/modules/Roles/TenantAbilities';
import { TenantUser } from '@/modules/Tenancy/TenancyModels/models/TenantUser.model';
import { Budget } from '../models/Budget.model';
import { BudgetVersion } from '../models/BudgetVersion.model';
import { BudgetLine } from '../models/BudgetLine.model';
import { BudgetApprovalRule } from '../models/BudgetApprovalRule.model';
import { BudgetApprovalStep } from '../models/BudgetApprovalStep.model';
import { BudgetAction, BudgetVersionKind, BudgetVersionStatus, ERRORS, isBalanceBudget } from '../Budgeting.types';
import { fromMilli, toMilli } from '../calc/budget-calc';
import {
  Actor,
  APPROVED_STATUSES,
  ApprovalError,
  ApprovalRule,
  ensureCanDecide,
  ensureCanRevise,
  ensureCancellable,
  ensureInReview,
  ensureLockable,
  ensureSubmittable,
  ensureUnlockable,
  grossAmount,
  pickRule,
  statusAfterApproval,
  stepsFor,
  validateRules,
} from '../workflow/approval';
import {
  CreateRevisionDto,
  CreateScenarioDto,
  DelegateStepDto,
  SaveApprovalRulesDto,
} from '../dtos/BudgetWorkflow.dto';
import { BudgetValidator } from './BudgetValidator.service';
import { BudgetNotificationService } from '../notifications/BudgetNotification.service';
import { dateOnly } from './BudgetCommands.service';

/** Turns a workflow refusal into the API's error shape. */
const asServiceError = (err: unknown) =>
  err instanceof ApprovalError ? new ServiceError(err.code, err.message, null, err.status) : err;

export const parseRule = (row: BudgetApprovalRule): ApprovalRule => ({
  id: row.id,
  minAmount: toMilli(String(row.minAmount)),
  maxAmount: row.maxAmount === null || row.maxAmount === undefined ? null : toMilli(String(row.maxAmount)),
  steps: JSON.parse(row.steps || '[]'),
  preventSelfApproval: !!row.preventSelfApproval,
});

/** Rule as the API shows it: amounts in currency units. */
export const toRuleDto = (rule: ApprovalRule) => ({
  id: rule.id,
  minAmount: fromMilli(rule.minAmount),
  maxAmount: rule.maxAmount === null ? null : fromMilli(rule.maxAmount),
  steps: rule.steps,
  preventSelfApproval: rule.preventSelfApproval,
});

/**
 * Approval workflow, versions and revisions (design §12). Every change locks
 * the version row first (`getVersionOrThrow` in a transaction), so two
 * approvers deciding at once are serialized.
 */
@Injectable()
export class BudgetWorkflowService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly validator: BudgetValidator,
    private readonly auditLog: AuditLogService,
    private readonly cls: ClsService,
    private readonly notifier: BudgetNotificationService,

    @Inject(Budget.name) private readonly budgetModel: TenantModelProxy<typeof Budget>,
    @Inject(BudgetVersion.name) private readonly versionModel: TenantModelProxy<typeof BudgetVersion>,
    @Inject(BudgetLine.name) private readonly lineModel: TenantModelProxy<typeof BudgetLine>,
    @Inject(BudgetApprovalRule.name) private readonly ruleModel: TenantModelProxy<typeof BudgetApprovalRule>,
    @Inject(BudgetApprovalStep.name) private readonly stepModel: TenantModelProxy<typeof BudgetApprovalStep>,
    @Inject(TenantUser.name) private readonly userModel: TenantModelProxy<typeof TenantUser>,
  ) {}

  private get userId(): number {
    return this.cls.get<number>('userId');
  }

  /** The current user's role, for step checks. */
  async getActor(trx?: Knex.Transaction): Promise<Actor> {
    const user = await this.userModel().query(trx).findOne('systemUserId', this.userId).withGraphFetched('role');
    return { userId: this.userId, roleId: user?.roleId ?? null, isAdmin: user?.role?.slug === 'admin' };
  }

  private run<T>(work: (trx: Knex.Transaction) => Promise<T>): Promise<T> {
    return this.uow.withTransaction(async (trx: Knex.Transaction) => {
      try {
        return await work(trx);
      } catch (err) {
        throw asServiceError(err);
      }
    });
  }

  private audit(trx: Knex.Transaction, budgetId: number, action: string, metadata: Record<string, unknown>) {
    return this.auditLog.record({ action, subject: AbilitySubject.Budget, subjectId: budgetId, metadata, trx });
  }

  // ------------------------------------------------------------ rules

  async getRules() {
    const rows = await this.ruleModel().query().orderBy('minAmount');
    return rows.map(parseRule).map(toRuleDto);
  }

  saveRules(dto: SaveApprovalRulesDto) {
    return this.run(async (trx) => {
      const rules: ApprovalRule[] = dto.rules.map((r) => ({
        id: null,
        minAmount: toMilli(r.minAmount),
        maxAmount: r.maxAmount === null || r.maxAmount === undefined ? null : toMilli(r.maxAmount),
        steps: r.steps.map((s) => ({ order: s.order, roleId: s.roleId ?? null, label: s.label.trim() })),
        preventSelfApproval: r.preventSelfApproval ?? true,
      }));
      validateRules(rules);
      const roleIds = [...new Set(rules.flatMap((r) => r.steps.map((s) => s.roleId)).filter((id): id is number => id !== null))];
      if (roleIds.length > 0) {
        const found = await trx('roles').whereIn('id', roleIds).select('id');
        const missing = roleIds.filter((id) => !found.some((r: any) => r.id === id));
        if (missing.length > 0) throw new ServiceError('BUDGET_ROLE_NOT_FOUND', 'A step names a role that does not exist.', { roleIds: missing });
      }
      const before = (await this.ruleModel().query(trx)).map(parseRule);
      await this.ruleModel().query(trx).delete();
      for (const rule of rules) {
        await this.ruleModel().query(trx).insert({
          minAmount: fromMilli(rule.minAmount).toFixed(3),
          maxAmount: rule.maxAmount === null ? null : fromMilli(rule.maxAmount).toFixed(3),
          steps: JSON.stringify(rule.steps),
          preventSelfApproval: rule.preventSelfApproval,
        });
      }
      await this.auditLog.record({
        action: 'approval_rules_saved',
        subject: AbilitySubject.Budget,
        subjectId: null,
        metadata: { before: before.map(toRuleDto), after: rules.map(toRuleDto) },
        trx,
      });
      return (await this.ruleModel().query(trx).orderBy('minAmount')).map(parseRule).map(toRuleDto);
    });
  }

  // ------------------------------------------------------------ approval

  submit(budgetId: number, versionNo: number, comment?: string) {
    return this.run(async (trx) => {
      const budget = await this.validator.getBudgetOrThrow(budgetId, trx);
      const version = await this.validator.getVersionOrThrow(budgetId, versionNo, trx);
      const amounts = await trx('budget_line_amounts')
        .join('budget_lines', 'budget_lines.id', 'budget_line_amounts.line_id')
        .where('budget_lines.version_id', version.id)
        // A balance sheet version is sized by its closing balances (design §15).
        .modify((q) => (isBalanceBudget(budget.type) ? q.where('budget_line_amounts.month', `${dateOnly(budget.endDate).slice(0, 7)}-01`) : q))
        .select('budget_line_amounts.amount');
      const lineCount = await this.lineModel().query(trx).where('versionId', version.id).resultSize();
      ensureSubmittable(version, lineCount);

      const gross = grossAmount(amounts.map((a: any) => toMilli(String(a.amount))));
      const rule = pickRule((await this.ruleModel().query(trx)).map(parseRule), gross);
      const submissionNo = (version.submissionNo ?? 0) + 1;
      const steps = stepsFor(rule);
      for (const s of steps) {
        await this.stepModel().query(trx).insert({
          versionId: version.id,
          submissionNo,
          stepOrder: s.order,
          label: s.label,
          roleId: s.roleId,
          preventSelfApproval: rule.preventSelfApproval,
          decision: 'pending',
        });
      }
      const submitted = await this.versionModel().query(trx).patchAndFetchById(version.id, {
        status: BudgetVersionStatus.Submitted,
        submissionNo,
        submittedAt: moment().toDate(),
        submittedBy: this.userId,
        lockVersion: version.lockVersion + 1,
      });
      await this.notifier.versionWaiting(
        trx,
        budget,
        submitted,
        { ...steps[0], stepOrder: steps[0].order, assignedUserId: null },
        steps.length,
        rule.preventSelfApproval ? [this.userId] : [],
      );
      await this.audit(trx, budgetId, 'submitted', {
        versionNo,
        submissionNo,
        grossAmount: fromMilli(gross),
        ruleId: rule.id,
        steps: rule.steps.length,
        comment: comment?.trim() || null,
      });
    });
  }

  approve(budgetId: number, versionNo: number, comment?: string) {
    return this.run(async (trx) => {
      const budget = await this.validator.getBudgetOrThrow(budgetId, trx);
      const version = await this.validator.getVersionOrThrow(budgetId, versionNo, trx);
      ensureInReview(version, 'approved');
      const steps = await this.currentSteps(version, trx);
      const step = ensureCanDecide(steps, await this.getActor(trx), version.submittedBy, !!steps[0]?.preventSelfApproval);
      const status = statusAfterApproval(steps);

      await this.stepModel().query(trx).patchAndFetchById((step as BudgetApprovalStep).id, {
        decision: 'approved',
        comment: comment?.trim() || null,
        decidedBy: this.userId,
        decidedAt: moment().toDate(),
      });
      const patch: Partial<BudgetVersion> = { status, lockVersion: version.lockVersion + 1 };
      if (status === BudgetVersionStatus.Approved) {
        patch.approvedAt = moment().toDate();
        patch.approvedBy = this.userId;
      }
      const saved = await this.versionModel().query(trx).patchAndFetchById(version.id, patch);
      if (status === BudgetVersionStatus.Approved) {
        await this.budgetModel().query(trx).patchAndFetchById(budgetId, { activeVersionId: version.id });
        await this.notifier.versionDecided(trx, budget, saved, 'approved', comment?.trim() || null);
      } else {
        const next = steps.filter((s) => s.decision === 'pending' && s.id !== (step as BudgetApprovalStep).id).sort((a, b) => a.stepOrder - b.stepOrder)[0];
        if (next) {
          const prevent = !!steps[0]?.preventSelfApproval;
          const decided = [...steps.filter((s) => s.decision === 'approved').map((s) => s.decidedBy), this.userId];
          await this.notifier.versionWaiting(trx, budget, saved, next, steps.length, prevent ? [saved.submittedBy, ...decided].filter((id): id is number => !!id) : []);
        }
      }
      await this.audit(trx, budgetId, status === BudgetVersionStatus.Approved ? 'approved' : 'step_approved', {
        versionNo,
        submissionNo: version.submissionNo,
        step: step.stepOrder,
        comment: comment?.trim() || null,
        previousActiveVersionId: status === BudgetVersionStatus.Approved ? budget.activeVersionId : undefined,
      });
    });
  }

  reject(budgetId: number, versionNo: number, comment: string) {
    return this.run(async (trx) => {
      const budget = await this.validator.getBudgetOrThrow(budgetId, trx);
      const version = await this.validator.getVersionOrThrow(budgetId, versionNo, trx);
      ensureInReview(version, 'rejected');
      const steps = await this.currentSteps(version, trx);
      const step = ensureCanDecide(steps, await this.getActor(trx), version.submittedBy, !!steps[0]?.preventSelfApproval);

      await this.stepModel().query(trx).patchAndFetchById((step as BudgetApprovalStep).id, {
        decision: 'rejected',
        comment: comment.trim(),
        decidedBy: this.userId,
        decidedAt: moment().toDate(),
      });
      await this.closePendingSteps(version, trx);
      const saved = await this.versionModel().query(trx).patchAndFetchById(version.id, {
        status: BudgetVersionStatus.Rejected,
        lockVersion: version.lockVersion + 1,
      });
      await this.notifier.versionDecided(trx, budget, saved, 'rejected', comment.trim());
      await this.audit(trx, budgetId, 'rejected', { versionNo, submissionNo: version.submissionNo, step: step.stepOrder, comment: comment.trim() });
    });
  }

  /** Hands the current step to another user who can approve budgets. */
  delegate(budgetId: number, versionNo: number, dto: DelegateStepDto) {
    return this.run(async (trx) => {
      const budget = await this.validator.getBudgetOrThrow(budgetId, trx);
      const version = await this.validator.getVersionOrThrow(budgetId, versionNo, trx);
      ensureInReview(version, 'delegated');
      const steps = await this.currentSteps(version, trx);
      // Only someone who could decide the step may hand it on.
      const step = ensureCanDecide(steps, await this.getActor(trx), null, false) as BudgetApprovalStep;

      const delegate = await this.userModel().query(trx).findById(dto.userId).withGraphFetched('role.permissions');
      if (!delegate || !delegate.active || !delegate.systemUserId) {
        throw new ServiceError('BUDGET_DELEGATE_NOT_FOUND', 'The user was not found or is inactive.', null, 404);
      }
      if (!getAbilityForRole(delegate.role).can(BudgetAction.Approve, AbilitySubject.Budget)) {
        throw new ServiceError('BUDGET_DELEGATE_CANNOT_APPROVE', 'The user does not have permission to approve budgets.');
      }
      if (step.preventSelfApproval && delegate.systemUserId === version.submittedBy) {
        throw new ServiceError('BUDGET_SELF_APPROVAL', 'The step cannot be delegated to the person who submitted it.', null, 403);
      }
      await this.stepModel().query(trx).patchAndFetchById(step.id, {
        assignedUserId: delegate.systemUserId,
        delegatedFromUserId: this.userId,
      });
      await this.notifier.stepDelegated(trx, budget, version, delegate.systemUserId, dto.comment?.trim() || null);
      await this.audit(trx, budgetId, 'step_delegated', {
        versionNo,
        submissionNo: version.submissionNo,
        step: step.stepOrder,
        toUserId: delegate.systemUserId,
        comment: dto.comment?.trim() || null,
      });
    });
  }

  /** The submitter (or anyone with Submit) takes a version back to draft. */
  withdraw(budgetId: number, versionNo: number) {
    return this.run(async (trx) => {
      await this.validator.getBudgetOrThrow(budgetId, trx);
      const version = await this.validator.getVersionOrThrow(budgetId, versionNo, trx);
      ensureInReview(version, 'withdrawn');
      await this.closePendingSteps(version, trx);
      await this.versionModel().query(trx).patchAndFetchById(version.id, {
        status: BudgetVersionStatus.Draft,
        lockVersion: version.lockVersion + 1,
      });
      await this.audit(trx, budgetId, 'withdrawn', { versionNo, submissionNo: version.submissionNo });
    });
  }

  cancel(budgetId: number, versionNo: number) {
    return this.run(async (trx) => {
      await this.validator.getBudgetOrThrow(budgetId, trx);
      const version = await this.validator.getVersionOrThrow(budgetId, versionNo, trx);
      ensureCancellable(version);
      await this.versionModel().query(trx).patchAndFetchById(version.id, {
        status: BudgetVersionStatus.Cancelled,
        lockVersion: version.lockVersion + 1,
      });
      await this.audit(trx, budgetId, 'cancelled', { versionNo });
    });
  }

  lock(budgetId: number, versionNo: number) {
    return this.run(async (trx) => {
      await this.validator.getBudgetOrThrow(budgetId, trx);
      const version = await this.validator.getVersionOrThrow(budgetId, versionNo, trx);
      ensureLockable(version);
      await this.versionModel().query(trx).patchAndFetchById(version.id, {
        status: BudgetVersionStatus.Locked,
        lockedAt: moment().toDate(),
        lockedBy: this.userId,
        lockVersion: version.lockVersion + 1,
      });
      await this.audit(trx, budgetId, 'locked', { versionNo });
    });
  }

  unlock(budgetId: number, versionNo: number) {
    return this.run(async (trx) => {
      await this.validator.getBudgetOrThrow(budgetId, trx);
      const version = await this.validator.getVersionOrThrow(budgetId, versionNo, trx);
      ensureUnlockable(version);
      await this.versionModel().query(trx).patchAndFetchById(version.id, {
        status: BudgetVersionStatus.Approved,
        lockedAt: null,
        lockedBy: null,
        lockVersion: version.lockVersion + 1,
      });
      await this.audit(trx, budgetId, 'unlocked', { versionNo });
    });
  }

  // ------------------------------------------------------------ versions

  createRevision(budgetId: number, dto: CreateRevisionDto): Promise<BudgetVersion> {
    return this.run(async (trx) => {
      const budget = await this.lockBudget(budgetId, trx);
      const versions = await this.versionModel().query(trx).where('budgetId', budgetId).orderBy('versionNo');
      const source = this.pickSource(budget, versions, dto.sourceVersionNo);
      ensureCanRevise(source, versions);

      const revisionNo = versions.filter((v) => v.kind === BudgetVersionKind.Revision).length + 1;
      const version = await this.copyVersion(source, versions, {
        kind: BudgetVersionKind.Revision,
        label: dto.label?.trim() || `Revision ${revisionNo}`,
        revisionReason: dto.reason.trim(),
      }, trx);
      await this.audit(trx, budgetId, 'revision_created', { versionNo: version.versionNo, sourceVersionNo: source.versionNo, reason: dto.reason.trim() });
      return version;
    });
  }

  createScenario(budgetId: number, dto: CreateScenarioDto): Promise<BudgetVersion> {
    return this.run(async (trx) => {
      const budget = await this.lockBudget(budgetId, trx);
      const versions = await this.versionModel().query(trx).where('budgetId', budgetId).orderBy('versionNo');
      const source = this.pickSource(budget, versions, dto.sourceVersionNo);
      const version = await this.copyVersion(source, versions, {
        kind: BudgetVersionKind.Scenario,
        scenario: dto.scenario,
        label: dto.label.trim(),
      }, trx);
      await this.audit(trx, budgetId, 'scenario_created', { versionNo: version.versionNo, sourceVersionNo: source.versionNo, scenario: dto.scenario });
      return version;
    });
  }

  // ------------------------------------------------------------ helpers

  /** Serializes version numbering for one budget. */
  private async lockBudget(budgetId: number, trx: Knex.Transaction): Promise<Budget> {
    const budget = await this.budgetModel().query(trx).modify('notDeleted').findById(budgetId).forUpdate();
    if (!budget) throw new ServiceError(ERRORS.BUDGET_NOT_FOUND, 'The budget was not found.', null, 404);
    return budget;
  }

  private pickSource(budget: Budget, versions: BudgetVersion[], versionNo?: number): BudgetVersion {
    const source = versionNo
      ? versions.find((v) => v.versionNo === versionNo)
      : versions.find((v) => v.id === budget.activeVersionId) ??
        [...versions].reverse().find((v) => APPROVED_STATUSES.includes(v.status)) ??
        versions[versions.length - 1];
    if (!source) throw new ServiceError(ERRORS.VERSION_NOT_FOUND, 'The budget version was not found.', null, 404);
    return source;
  }

  /** New draft version with a copy of the source's lines and monthly amounts (two set-based inserts). */
  private async copyVersion(
    source: BudgetVersion,
    versions: BudgetVersion[],
    fields: Partial<BudgetVersion>,
    trx: Knex.Transaction,
  ): Promise<BudgetVersion> {
    const versionNo = Math.max(...versions.map((v) => v.versionNo)) + 1;
    const version = await this.versionModel().query(trx).insertAndFetch({
      budgetId: source.budgetId,
      versionNo,
      sourceVersionId: source.id,
      status: BudgetVersionStatus.Draft,
      lockVersion: 0,
      submissionNo: 0,
      createdBy: this.userId,
      ...fields,
    });
    // Raw SQL bypasses the identifier mapper: tenant tables and columns are UPPER_SNAKE.
    await trx.raw(
      `INSERT INTO BUDGET_LINES (VERSION_ID, ACCOUNT_ID, BRANCH_ID, PROJECT_ID, BRANCH_KEY, PROJECT_KEY, NOTE, ASSUMPTION, CREATED_AT, UPDATED_AT)
       SELECT ?, ACCOUNT_ID, BRANCH_ID, PROJECT_ID, BRANCH_KEY, PROJECT_KEY, NOTE, ASSUMPTION, NOW(), NOW()
       FROM BUDGET_LINES WHERE VERSION_ID = ?`,
      [version.id, source.id],
    );
    await trx.raw(
      `INSERT INTO BUDGET_LINE_AMOUNTS (LINE_ID, MONTH, AMOUNT)
       SELECT NL.ID, A.MONTH, A.AMOUNT
       FROM BUDGET_LINE_AMOUNTS A
       JOIN BUDGET_LINES OL ON OL.ID = A.LINE_ID
       JOIN BUDGET_LINES NL ON NL.VERSION_ID = ? AND NL.ACCOUNT_ID = OL.ACCOUNT_ID
         AND NL.BRANCH_KEY = OL.BRANCH_KEY AND NL.PROJECT_KEY = OL.PROJECT_KEY
       WHERE OL.VERSION_ID = ?`,
      [version.id, source.id],
    );
    return version;
  }

  private async currentSteps(version: BudgetVersion, trx: Knex.Transaction): Promise<BudgetApprovalStep[]> {
    return await this.stepModel()
      .query(trx)
      .where({ versionId: version.id, submissionNo: version.submissionNo })
      .orderBy('stepOrder')
      .forUpdate();
  }

  private closePendingSteps(version: BudgetVersion, trx: Knex.Transaction) {
    return this.stepModel()
      .query(trx)
      .where({ versionId: version.id, submissionNo: version.submissionNo, decision: 'pending' })
      .patch({ decision: 'cancelled' });
  }
}

