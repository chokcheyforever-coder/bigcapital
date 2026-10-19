import { Inject, Injectable } from '@nestjs/common';
import * as moment from 'moment';
import { TenantModelProxy } from '@/modules/System/models/TenantBaseModel';
import { AccountTypesUtils } from '@/libs/accounts-utils/AccountTypesUtils';
import { AuditLog } from '@/modules/AuditLogs/models/AuditLog.model';
import { AbilitySubject } from '@/modules/Roles/Roles.types';
import { TenantUser } from '@/modules/Tenancy/TenancyModels/models/TenantUser.model';
import { Account } from '@/modules/Accounts/models/Account.model';
import { Budget } from '../models/Budget.model';
import { BudgetVersion } from '../models/BudgetVersion.model';
import { BudgetLine } from '../models/BudgetLine.model';
import { BudgetApprovalStep } from '../models/BudgetApprovalStep.model';
import { BudgetValidator } from '../commands/BudgetValidator.service';
import { BudgetWorkflowService } from '../commands/BudgetWorkflow.service';
import { dateOnly, lineKey } from '../commands/BudgetCommands.service';
import { CompareVersionsQueryDto, GetApprovalsQueryDto, GetBudgetAuditQueryDto } from '../dtos/BudgetWorkflow.dto';
import { fromMilli, Milli, periodMonths, periodTotals, sumTotals, toMilli } from '../calc/budget-calc';
import { ApprovalError, currentStep, ensureCanDecide, IN_REVIEW_STATUSES } from '../workflow/approval';
import { toBudgetDto, toVersionDto } from './BudgetQueries.service';

const pct = (base: Milli, value: Milli) => (base === 0 ? null : Math.round(((value - base) / Math.abs(base)) * 10_000) / 100);

const toStepDto = (s: BudgetApprovalStep, names: Map<number, string>) => ({
  id: s.id,
  submissionNo: s.submissionNo,
  stepOrder: s.stepOrder,
  label: s.label,
  roleId: s.roleId,
  assignedUserId: s.assignedUserId,
  assignedUserName: s.assignedUserId ? names.get(s.assignedUserId) ?? null : null,
  decision: s.decision,
  comment: s.comment,
  decidedBy: s.decidedBy,
  decidedByName: s.decidedBy ? names.get(s.decidedBy) ?? null : null,
  decidedAt: s.decidedAt,
});

@Injectable()
export class BudgetWorkflowQueriesService {
  constructor(
    private readonly validator: BudgetValidator,
    private readonly workflow: BudgetWorkflowService,
    @Inject(Budget.name) private readonly budgetModel: TenantModelProxy<typeof Budget>,
    @Inject(BudgetVersion.name) private readonly versionModel: TenantModelProxy<typeof BudgetVersion>,
    @Inject(BudgetLine.name) private readonly lineModel: TenantModelProxy<typeof BudgetLine>,
    @Inject(BudgetApprovalStep.name) private readonly stepModel: TenantModelProxy<typeof BudgetApprovalStep>,
    @Inject(TenantUser.name) private readonly userModel: TenantModelProxy<typeof TenantUser>,
    @Inject(AuditLog.name) private readonly auditModel: TenantModelProxy<typeof AuditLog>,
    @Inject(Account.name) private readonly accountModel: TenantModelProxy<typeof Account>,
  ) {}

  /** System user id → full name, for the given ids. */
  private async userNames(ids: Array<number | null | undefined>): Promise<Map<number, string>> {
    const unique = [...new Set(ids.filter((id): id is number => !!id))];
    if (unique.length === 0) return new Map();
    const users = await this.userModel().query().whereIn('systemUserId', unique);
    return new Map(users.map((u) => [u.systemUserId, u.fullName || u.email]));
  }

  /** Every submission of a version with its steps and decisions; `canDecide` is for the current user. */
  async getVersionApprovals(budgetId: number, versionNo: number) {
    await this.validator.getBudgetOrThrow(budgetId);
    const version = await this.validator.getVersionOrThrow(budgetId, versionNo);
    const steps = await this.stepModel().query().where('versionId', version.id).orderBy([{ column: 'submissionNo', order: 'desc' }, 'stepOrder']);
    const names = await this.userNames([version.submittedBy, version.approvedBy, version.lockedBy, ...steps.flatMap((s) => [s.decidedBy, s.assignedUserId])]);
    const current = steps.filter((s) => s.submissionNo === version.submissionNo);

    const waiting = IN_REVIEW_STATUSES.includes(version.status) ? (currentStep(current) as BudgetApprovalStep | null) : null;
    let canDecide = false;
    let reason: string | null = null;
    if (waiting) {
      try {
        ensureCanDecide(current, await this.workflow.getActor(), version.submittedBy, !!current[0]?.preventSelfApproval);
        canDecide = true;
      } catch (err) {
        if (!(err instanceof ApprovalError)) throw err;
        reason = err.code;
      }
    }
    const submissions = [...new Set(steps.map((s) => s.submissionNo))].map((no) => ({
      submissionNo: no,
      steps: steps.filter((s) => s.submissionNo === no).map((s) => toStepDto(s, names)),
    }));
    return {
      version: {
        ...toVersionDto(version),
        submittedByName: version.submittedBy ? names.get(version.submittedBy) ?? null : null,
        approvedByName: version.approvedBy ? names.get(version.approvedBy) ?? null : null,
        lockedByName: version.lockedBy ? names.get(version.lockedBy) ?? null : null,
      },
      currentStep: waiting ? toStepDto(waiting, names) : null,
      canDecide,
      cannotDecideReason: reason,
      preventSelfApproval: current.length ? !!current[0].preventSelfApproval : null,
      submissions,
    };
  }

  /**
   * Approval status report: versions in review (or every submitted version) with
   * the step they wait on and for how long. `mine` keeps the ones the current
   * user can decide now.
   */
  async getApprovals(query: GetApprovalsQueryDto) {
    const versionsQuery = this.versionModel()
      .query()
      .join('budgets', 'budgets.id', 'budget_versions.budgetId')
      .whereNull('budgets.deletedAt')
      .select('budget_versions.*')
      .orderBy('budget_versions.submittedAt', 'desc');
    if (query.status === 'all') versionsQuery.where('budget_versions.submissionNo', '>', 0);
    else versionsQuery.whereIn('budget_versions.status', IN_REVIEW_STATUSES);
    const versions = await versionsQuery;
    if (versions.length === 0) return { data: [] };

    const budgets = await this.budgetModel().query().whereIn('id', [...new Set(versions.map((v) => v.budgetId))]);
    const steps = await this.stepModel().query().whereIn('versionId', versions.map((v) => v.id));
    const totals = await this.versionGross(versions.map((v) => v.id));
    const actor = await this.workflow.getActor();
    const names = await this.userNames([...versions.map((v) => v.submittedBy), ...steps.map((s) => s.assignedUserId)]);

    const rows = versions.map((v) => {
      const budget = budgets.find((b) => b.id === v.budgetId)!;
      const current = steps.filter((s) => s.versionId === v.id && s.submissionNo === v.submissionNo).sort((a, b) => a.stepOrder - b.stepOrder);
      const inReview = IN_REVIEW_STATUSES.includes(v.status);
      const waiting = inReview ? (currentStep(current) as BudgetApprovalStep | null) : null;
      let canDecide = false;
      if (waiting) {
        try {
          ensureCanDecide(current, actor, v.submittedBy, !!current[0]?.preventSelfApproval);
          canDecide = true;
        } catch (err) {
          if (!(err instanceof ApprovalError)) throw err;
        }
      }
      const since = waiting ? [...current].reverse().find((s) => s.decidedAt)?.decidedAt ?? v.submittedAt : null;
      return {
        budget: { id: budget.id, reference: budget.reference, name: budget.name, type: budget.type, fiscalYear: budget.fiscalYear },
        version: toVersionDto(v),
        grossAmount: fromMilli(totals.get(v.id) ?? 0),
        submittedBy: v.submittedBy,
        submittedByName: v.submittedBy ? names.get(v.submittedBy) ?? null : null,
        stepsTotal: current.length,
        stepsApproved: current.filter((s) => s.decision === 'approved').length,
        waitingStep: waiting ? toStepDto(waiting, names) : null,
        waitingDays: since ? moment().diff(moment(since), 'days') : null,
        canDecide,
      };
    });
    return { data: query.mine ? rows.filter((r) => r.canDecide) : rows };
  }

  /** Line-by-line comparison of two versions, e.g. original vs revised. */
  async compareVersions(budgetId: number, query: CompareVersionsQueryDto) {
    const budget = await this.validator.getBudgetOrThrow(budgetId);
    const versions = await this.versionModel().query().where('budgetId', budgetId).orderBy('versionNo');
    const baseNo = query.baseVersionNo ?? 1;
    const compareNo =
      query.versionNo ?? versions.find((v) => v.id === budget.activeVersionId)?.versionNo ?? versions[versions.length - 1].versionNo;
    const base = await this.validator.getVersionOrThrow(budgetId, baseNo);
    const compare = await this.validator.getVersionOrThrow(budgetId, compareNo);
    const months = periodMonths(dateOnly(budget.startDate), dateOnly(budget.endDate));

    const load = async (version: BudgetVersion) => {
      const lines = await this.lineModel().query().where('versionId', version.id).withGraphFetched('amounts');
      return new Map(
        lines.map((line) => {
          const amounts: Record<string, Milli> = {};
          for (const a of (line as any).amounts ?? []) amounts[dateOnly(a.month)] = toMilli(String(a.amount));
          return [lineKey(line.accountId, line.branchId, line.projectId), { line, totals: periodTotals(amounts, months) }];
        }),
      );
    };
    const [baseLines, compareLines] = await Promise.all([load(base), load(compare)]);
    const keys = [...new Set([...baseLines.keys(), ...compareLines.keys()])];
    const accountIds = [...new Set(keys.map((k) => Number(k.split(':')[0])))];
    const accounts = accountIds.length ? await this.accountModel().query().whereIn('id', accountIds) : [];
    const empty = periodTotals({}, months);

    const lines = keys
      .map((key) => {
        const b = baseLines.get(key);
        const c = compareLines.get(key);
        const line = (c ?? b)!.line;
        const account = accounts.find((a) => a.id === line.accountId)!;
        const bt = b?.totals ?? empty;
        const ct = c?.totals ?? empty;
        return {
          accountId: line.accountId,
          account: { id: account.id, code: account.code, name: account.name, rootType: AccountTypesUtils.getType(account.accountType, 'rootType') },
          branchId: line.branchId,
          projectId: line.projectId,
          change: !b ? 'added' : !c ? 'removed' : bt.total === ct.total && months.every((m) => bt.months[m] === ct.months[m]) ? 'unchanged' : 'changed',
          base: { months: Object.fromEntries(months.map((m) => [m, fromMilli(bt.months[m] ?? 0)])), total: fromMilli(bt.total) },
          compare: { months: Object.fromEntries(months.map((m) => [m, fromMilli(ct.months[m] ?? 0)])), total: fromMilli(ct.total) },
          difference: fromMilli(ct.total - bt.total),
          differencePercent: pct(bt.total, ct.total),
        };
      })
      .sort((x, y) => String(x.account.code ?? '').localeCompare(String(y.account.code ?? '')));

    const baseTotal = sumTotals([...baseLines.values()].map((l) => l.totals), months).total;
    const compareTotal = sumTotals([...compareLines.values()].map((l) => l.totals), months).total;
    return {
      budget: toBudgetDto(budget),
      base: toVersionDto(base),
      compare: toVersionDto(compare),
      months,
      lines,
      totals: {
        base: fromMilli(baseTotal),
        compare: fromMilli(compareTotal),
        difference: fromMilli(compareTotal - baseTotal),
        differencePercent: pct(baseTotal, compareTotal),
      },
    };
  }

  /** Audit history of one budget, newest first. */
  async getAudit(budgetId: number, query: GetBudgetAuditQueryDto) {
    await this.validator.getBudgetOrThrow(budgetId);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const { results, total } = await this.auditModel()
      .query()
      .where({ subject: AbilitySubject.Budget, subjectId: budgetId })
      .orderBy('id', 'desc')
      .page(page - 1, pageSize);
    const names = await this.userNames(results.map((r) => r.userId));
    return {
      data: results.map((r) => ({
        id: r.id,
        action: r.action,
        userId: r.userId,
        userName: r.userId ? names.get(r.userId) ?? null : null,
        metadata: r.metadata,
        createdAt: r.createdAt,
      })),
      pagination: { page, pageSize, total },
    };
  }

  private async versionGross(versionIds: number[]): Promise<Map<number, Milli>> {
    if (versionIds.length === 0) return new Map();
    const rows = await this.lineModel()
      .query()
      .join('budget_line_amounts', 'budget_line_amounts.lineId', 'budget_lines.id')
      .whereIn('budget_lines.versionId', versionIds)
      .groupBy('budget_lines.versionId')
      .select('budget_lines.versionId', this.lineModel().knex().raw('SUM(ABS(??)) AS ??', ['budget_line_amounts.amount', 'total']));
    return new Map(rows.map((r: any) => [r.versionId, toMilli(Number(r.total).toFixed(3))]));
  }
}
