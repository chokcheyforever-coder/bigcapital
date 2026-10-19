import { Inject, Logger, Scope } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { ClsService, UseCls } from 'nestjs-cls';
import { Knex } from 'knex';
import * as moment from 'moment';
import { TenantModelProxy } from '@/modules/System/models/TenantBaseModel';
import { SystemKnexConnection } from '@/modules/System/SystemDB/SystemDB.constants';
import { Mail } from '@/modules/Mail/Mail';
import { MailTransporter } from '@/modules/Mail/MailTransporter.service';
import { BudgetNotification } from '../models/BudgetNotification.model';
import { escapeHtml } from '../workflow/recipients';
import { BUDGET_NOTIFICATIONS_QUEUE, BudgetNotificationService } from './BudgetNotification.service';

const BATCH = 100;

/**
 * Emails pending budget notifications of one company (design §15). Each row
 * is claimed (pending → sending) before it is sent, so two jobs never send the
 * same one. With email turned off the rows are marked skipped; they stay in
 * the in-app list either way.
 */
@Processor({ name: BUDGET_NOTIFICATIONS_QUEUE, scope: Scope.REQUEST })
export class BudgetNotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(BudgetNotificationsProcessor.name);

  constructor(
    private readonly cls: ClsService,
    private readonly config: ConfigService,
    private readonly mail: MailTransporter,
    private readonly notifications: BudgetNotificationService,
    @Inject(SystemKnexConnection) private readonly systemKnex: Knex,
    @Inject(BudgetNotification.name) private readonly notificationModel: TenantModelProxy<typeof BudgetNotification>,
  ) {
    super();
  }

  @UseCls()
  async process(job: Job<{ organizationId: string; userId: number | null }>) {
    this.cls.set('organizationId', job.data.organizationId);
    this.cls.set('userId', job.data.userId);

    const settings = await this.notifications.getSettings();
    const pending = await this.notificationModel().query().where('status', 'pending').orderBy('id').limit(BATCH);
    if (pending.length === 0) return;
    const origin = await this.origin(job.data.organizationId);

    for (const n of pending) {
      const claimed = await this.notificationModel().query().where({ id: n.id, status: 'pending' }).patch({ status: 'sending' });
      if (!claimed) continue;
      if (!settings.email || !n.email) {
        await this.notificationModel().query().findById(n.id).patch({ status: 'skipped', error: !n.email ? 'No email address.' : null });
        continue;
      }
      try {
        const url = n.link ? `${origin}${n.link}` : origin;
        const mail = new Mail()
          .setTo(n.email)
          .setSubject(n.subject)
          .setContent(
            `<p>${escapeHtml(n.body)}</p>` +
              (url ? `<p><a href="${escapeHtml(url)}">Open in 103 DiTech Cloud Accounting</a></p>` : '') +
              `<p style="color:#888;font-size:12px">You get this because of your role in the company's budgets. An administrator can turn budget emails off in Budgets › Settings.</p>`,
          );
        await this.mail.send(mail);
        await this.notificationModel().query().findById(n.id).patch({ status: 'sent', sentAt: moment().toDate(), error: null });
      } catch (err: any) {
        this.logger.warn(`budget notification ${n.id} not sent: ${err?.message}`);
        await this.notificationModel().query().findById(n.id).patch({ status: 'failed', error: String(err?.message ?? err).slice(0, 1000) });
      }
    }
    // More than one batch waiting: carry on in another job.
    if (pending.length === BATCH) await this.notifications.scheduleSend();
  }

  /** The company's own address (its pinned 103 DiTech host), else the server's base URL. */
  private async origin(organizationId: string): Promise<string> {
    try {
      const row = await this.systemKnex('ditech_policies as p')
        .join('tenants as t', 't.id', 'p.tenant_id')
        .where('t.organization_id', organizationId)
        .first('p.pinned_host');
      const host = row?.pinnedHost ?? row?.pinned_host;
      if (host) return `https://${host}`;
    } catch {
      // No DiTech policy table (plain BigCapital): use the base URL.
    }
    return String(this.config.get('app.baseUrl') ?? '').replace(/\/$/, '');
  }
}
