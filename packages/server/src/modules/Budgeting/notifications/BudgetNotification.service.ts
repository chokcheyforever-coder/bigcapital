import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ClsService } from 'nestjs-cls';
import { Knex } from 'knex';
import * as moment from 'moment';
import { TenantModelProxy } from '@/modules/System/models/TenantBaseModel';
import { AbilitySubject } from '@/modules/Roles/Roles.types';
import { getAbilityForRole } from '@/modules/Roles/TenantAbilities';
import { TenantUser } from '@/modules/Tenancy/TenancyModels/models/TenantUser.model';
import { Budget } from '../models/Budget.model';
import { BudgetVersion } from '../models/BudgetVersion.model';
import { BudgetNotification } from '../models/BudgetNotification.model';
import { BudgetSetting } from '../models/BudgetSetting.model';
import { BudgetOverride } from '../models/BudgetOverride.model';
import { BudgetAction } from '../Budgeting.types';
import { AlertLevel, approvers, Candidate, interested, StepTarget, stepDeciders } from '../workflow/recipients';
import { GetNotificationsQueryDto, SaveNotificationSettingsDto } from '../dtos/BudgetForecast.dto';

export const BUDGET_NOTIFICATIONS_QUEUE = 'budget-notifications';
export const SEND_BUDGET_NOTIFICATIONS_JOB = 'send-budget-notifications';
/** Long enough for the change's transaction to commit; rows of a rolled-back change never exist. */
const SEND_DELAY_MS = 5_000;

export interface NotificationSettings {
  email: boolean;
  alertLevel: AlertLevel;
}

const DEFAULT_SETTINGS: NotificationSettings = { email: true, alertLevel: 'exceeded' };
const SETTINGS_KEY = 'notifications';

const money = (n: number | string, currency: string) =>
  `${currency} ${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface Draft {
  kind: string;
  budgetId: number | null;
  userIds: number[];
  subject: string;
  body: string;
  link: string | null;
}

/**
 * Budget notifications (design §15). Each one is written in the same
 * transaction as the change it reports, so a change that rolls back never
 * notifies anyone. They form the in-app list, and a queued job emails the
 * pending ones a few seconds later (BudgetNotificationsProcessor).
 */
@Injectable()
export class BudgetNotificationService {
  private readonly logger = new Logger(BudgetNotificationService.name);

  constructor(
    private readonly cls: ClsService,
    @InjectQueue(BUDGET_NOTIFICATIONS_QUEUE) private readonly queue: Queue,
    @Inject(BudgetNotification.name) private readonly notificationModel: TenantModelProxy<typeof BudgetNotification>,
    @Inject(BudgetSetting.name) private readonly settingModel: TenantModelProxy<typeof BudgetSetting>,
    @Inject(TenantUser.name) private readonly userModel: TenantModelProxy<typeof TenantUser>,
  ) {}

  private get userId(): number | null {
    return this.cls.get<number>('userId') ?? null;
  }

  // ------------------------------------------------------------ settings

  async getSettings(trx?: Knex.Transaction): Promise<NotificationSettings> {
    const row = await this.settingModel().query(trx).findById(SETTINGS_KEY);
    return { ...DEFAULT_SETTINGS, ...(row ? JSON.parse(row.value) : {}) };
  }

  async saveSettings(dto: SaveNotificationSettingsDto): Promise<NotificationSettings> {
    const value = JSON.stringify({ email: dto.email, alertLevel: dto.alertLevel });
    await this.settingModel()
      .knex()('budget_settings')
      .insert({ key: SETTINGS_KEY, value, updated_at: moment().toDate() })
      .onConflict('key')
      .merge(['value', 'updated_at']);
    return this.getSettings();
  }

  // ------------------------------------------------------------ in-app list

  async list(q: GetNotificationsQueryDto) {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 30;
    const query = this.notificationModel().query().where('userId', this.userId).orderBy('id', 'desc');
    if (q.unread) query.whereNull('readAt');
    const { results, total } = await query.page(page - 1, pageSize);
    const unread = await this.notificationModel().query().where('userId', this.userId).whereNull('readAt').resultSize();
    return {
      data: results.map((n) => ({
        id: n.id,
        kind: n.kind,
        budgetId: n.budgetId,
        subject: n.subject,
        body: n.body,
        link: n.link,
        emailStatus: n.status,
        readAt: n.readAt,
        createdAt: n.createdAt,
      })),
      unread,
      pagination: { page, pageSize, total },
    };
  }

  async markRead(ids?: number[]) {
    const query = this.notificationModel().query().where('userId', this.userId).whereNull('readAt');
    if (ids?.length) query.whereIn('id', ids);
    const updated = await query.patch({ readAt: moment().toDate() });
    return { updated };
  }

  // ------------------------------------------------------------ events

  /** A version waits on `step`: tell whoever can decide it. */
  async versionWaiting(trx: Knex.Transaction, budget: Budget, version: BudgetVersion, step: StepTarget & { label: string; stepOrder: number }, stepsTotal: number, exclude: number[]) {
    const users = await this.candidates(trx);
    const who = await this.nameOf(version.submittedBy, trx);
    await this.add(trx, {
      kind: 'approval_waiting',
      budgetId: budget.id,
      userIds: stepDeciders(users, step, exclude),
      subject: `Budget waiting for your approval: ${budget.name} v${version.versionNo}`,
      body: `${who} submitted ${budget.name} (${budget.reference}) version ${version.versionNo} for approval. It waits on step ${step.stepOrder} of ${stepsTotal}: ${step.label}.`,
      link: `/budgets/${budget.id}`,
    });
  }

  /** The last step approved, or a step rejected: tell the submitter and the budget owner. */
  async versionDecided(trx: Knex.Transaction, budget: Budget, version: BudgetVersion, decision: 'approved' | 'rejected', comment: string | null) {
    const who = await this.nameOf(this.userId, trx);
    const approved = decision === 'approved';
    await this.add(trx, {
      kind: approved ? 'version_approved' : 'version_rejected',
      budgetId: budget.id,
      userIds: interested([version.submittedBy, budget.ownerUserId], [this.userId]),
      subject: `Budget ${approved ? 'approved' : 'rejected'}: ${budget.name} v${version.versionNo}`,
      body: approved
        ? `${who} gave the last approval to ${budget.name} (${budget.reference}) version ${version.versionNo}. It is now the active version.`
        : `${who} rejected ${budget.name} (${budget.reference}) version ${version.versionNo}: ${comment ?? ''}. You can change it and submit it again.`,
      link: `/budgets/${budget.id}`,
    });
  }

  async stepDelegated(trx: Knex.Transaction, budget: Budget, version: BudgetVersion, toUserId: number, comment: string | null) {
    const who = await this.nameOf(this.userId, trx);
    await this.add(trx, {
      kind: 'approval_delegated',
      budgetId: budget.id,
      userIds: [toUserId],
      subject: `Budget approval handed to you: ${budget.name} v${version.versionNo}`,
      body: `${who} asked you to decide the approval of ${budget.name} (${budget.reference}) version ${version.versionNo}.${comment ? ` Note: ${comment}` : ''}`,
      link: `/budgets/${budget.id}`,
    });
  }

  async overrideRequested(trx: Knex.Transaction, budgets: Budget[], overrides: BudgetOverride[], documentLabel: string, reason: string, exclude: number[]) {
    const users = await this.candidates(trx);
    const who = await this.nameOf(this.userId, trx);
    for (const budget of budgets) {
      const total = overrides.filter((o) => o.budgetId === budget.id).reduce((a, o) => a + Number(o.amount), 0);
      await this.add(trx, {
        kind: 'override_requested',
        budgetId: budget.id,
        userIds: approvers(users, exclude),
        subject: `Over-budget approval requested: ${documentLabel}`,
        body: `${who} asks to post ${documentLabel}, which goes ${money(total, budget.currencyCode)} over ${budget.name} (${budget.reference}). Reason: ${reason}`,
        link: '/budgets/approvals?tab=overrides',
      });
    }
  }

  async overrideDecided(trx: Knex.Transaction, budget: Budget | null, override: BudgetOverride, documentLabel: string) {
    const who = await this.nameOf(this.userId, trx);
    const approved = override.status === 'approved';
    await this.add(trx, {
      kind: approved ? 'override_approved' : 'override_rejected',
      budgetId: override.budgetId,
      userIds: interested([override.requestedBy], [this.userId]),
      subject: `Over-budget request ${approved ? 'approved' : 'rejected'}: ${documentLabel}`,
      body: approved
        ? `${who} approved posting ${documentLabel} over ${budget?.name ?? 'its budget'}. You can post it now.`
        : `${who} rejected posting ${documentLabel} over ${budget?.name ?? 'its budget'}.${override.comment ? ` Note: ${override.comment}` : ''}`,
      link: '/budgets/approvals?tab=overrides',
    });
  }

  /** A posted document reached a threshold: tell the budget owner, at the level the company chose. */
  async spendingAlert(trx: Knex.Transaction, budget: Budget, level: string, documentLabel: string, percentAfter: number | null, accountName: string) {
    if (!budget.ownerUserId) return;
    const exceeded = level === 'exceeded';
    await this.add(trx, {
      kind: 'budget_alert',
      budgetId: budget.id,
      userIds: interested([budget.ownerUserId], [this.userId]),
      subject: `${exceeded ? 'Budget exceeded' : 'Budget warning'}: ${budget.name}, ${accountName}`,
      body: `${documentLabel} brought ${accountName} in ${budget.name} (${budget.reference}) to ${percentAfter === null ? 'n/a' : `${percentAfter}%`} of its budget.`,
      link: `/budgets/${budget.id}/reports?report=expense-utilization`,
    });
  }

  // ------------------------------------------------------------ helpers

  /** Writes one notification per recipient (inside the change's transaction) and schedules the emails. */
  private async add(trx: Knex.Transaction, draft: Draft) {
    const ids = [...new Set(draft.userIds)];
    if (ids.length === 0) return;
    const users = await this.userModel().query(trx).whereIn('systemUserId', ids);
    const now = moment().toDate();
    for (const userId of ids) {
      await this.notificationModel().query(trx).insert({
        budgetId: draft.budgetId,
        kind: draft.kind,
        userId,
        email: users.find((u) => u.systemUserId === userId)?.email ?? null,
        subject: draft.subject.slice(0, 255),
        body: draft.body,
        link: draft.link,
        status: 'pending',
        createdAt: now,
      });
    }
    await this.scheduleSend();
  }

  /** Queues the email job; failures to queue only delay the emails (rows stay pending). */
  async scheduleSend() {
    const organizationId = this.cls.get<string>('organizationId');
    if (!organizationId) return;
    try {
      await this.queue.add(
        SEND_BUDGET_NOTIFICATIONS_JOB,
        { organizationId, userId: this.userId },
        { delay: SEND_DELAY_MS, removeOnComplete: true, removeOnFail: 100, attempts: 3, backoff: { type: 'exponential', delay: 30_000 } },
      );
    } catch (err: any) {
      this.logger.warn(`could not queue budget notifications: ${err?.message}`);
    }
  }

  private async candidates(trx: Knex.Transaction): Promise<Candidate[]> {
    const users = await this.userModel().query(trx).whereNotNull('systemUserId').withGraphFetched('role.permissions');
    return users.map((u) => ({
      userId: u.systemUserId,
      roleId: u.roleId ?? null,
      active: !!u.active,
      isAdmin: u.role?.slug === 'admin',
      canApprove: u.role ? getAbilityForRole(u.role).can(BudgetAction.Approve, AbilitySubject.Budget) : false,
    }));
  }

  private async nameOf(systemUserId: number | null, trx?: Knex.Transaction): Promise<string> {
    if (!systemUserId) return 'Someone';
    const u = await this.userModel().query(trx).findOne('systemUserId', systemUserId);
    return u ? `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email : 'Someone';
  }
}
