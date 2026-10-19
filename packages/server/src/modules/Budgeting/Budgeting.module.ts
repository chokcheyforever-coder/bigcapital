import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TenancyModule } from '../Tenancy/Tenancy.module';
import { TenancyDatabaseModule } from '../Tenancy/TenancyDB/TenancyDB.module';
import { AuditLogsModule } from '../AuditLogs/AuditLogs.module';
import { BillsModule } from '../Bills/Bills.module';
import { ExpensesModule } from '../Expenses/Expenses.module';
import { AuthorizationGuard } from '../Roles/Authorization.guard';
import { PermissionGuard } from '../Roles/Permission.guard';
import { BudgetingController } from './Budgeting.controller';
import { BudgetReportsController } from './BudgetReports.controller';
import { BudgetWorkflowController } from './BudgetWorkflow.controller';
import { BudgetControlController } from './BudgetControl.controller';
import { BudgetForecastController } from './BudgetForecast.controller';
import { BudgetForecastService } from './queries/BudgetForecast.service';
import { BudgetDashboardService } from './queries/BudgetDashboard.service';
import { BudgetNotificationService, BUDGET_NOTIFICATIONS_QUEUE } from './notifications/BudgetNotification.service';
import { BudgetNotificationsProcessor } from './notifications/BudgetNotifications.processor';
import { MailModule } from '../Mail/Mail.module';
import { BudgetControlService } from './control/BudgetControl.service';
import { BudgetControlAdminService } from './control/BudgetControlAdmin.service';
import { BudgetControlSubscriber } from './control/BudgetControl.subscriber';
import { BudgetDocumentLedgerService } from './control/BudgetDocumentLedger.service';
import { BudgetWorkflowService } from './commands/BudgetWorkflow.service';
import { BudgetWorkflowQueriesService } from './queries/BudgetWorkflowQueries.service';
import { BudgetReportsService } from './queries/BudgetReports.service';
import { BudgetCommandsService } from './commands/BudgetCommands.service';
import { BudgetValidator } from './commands/BudgetValidator.service';
import { BudgetQueriesService } from './queries/BudgetQueries.service';
import { BudgetActualsService } from './queries/BudgetActuals.service';
import { BudgetPrefillService } from './queries/BudgetPrefill.service';
import { BudgetSheetService } from './commands/BudgetSheet.service';

/** Budget planning & control (DiTech, docs/ditech/budgeting). */
@Module({
  imports: [
    TenancyModule,
    TenancyDatabaseModule,
    AuditLogsModule,
    BillsModule,
    ExpensesModule,
    MailModule,
    BullModule.registerQueue({ name: BUDGET_NOTIFICATIONS_QUEUE }),
  ],
  // Fixed paths first: `budgets/reports/...`, `budgets/approvals`, `budgets/dashboard`… must not reach the `:id` routes.
  controllers: [BudgetReportsController, BudgetWorkflowController, BudgetControlController, BudgetForecastController, BudgetingController],
  providers: [
    BudgetCommandsService,
    BudgetValidator,
    BudgetQueriesService,
    BudgetActualsService,
    BudgetPrefillService,
    BudgetSheetService,
    BudgetReportsService,
    BudgetWorkflowService,
    BudgetWorkflowQueriesService,
    BudgetDocumentLedgerService,
    BudgetControlService,
    BudgetControlAdminService,
    BudgetControlSubscriber,
    BudgetForecastService,
    BudgetDashboardService,
    BudgetNotificationService,
    BudgetNotificationsProcessor,
    AuthorizationGuard,
    PermissionGuard,
  ],
  exports: [BudgetQueriesService, BudgetActualsService, BudgetReportsService],
})
export class BudgetingModule {}
