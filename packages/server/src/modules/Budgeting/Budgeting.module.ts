import { Module } from '@nestjs/common';
import { TenancyModule } from '../Tenancy/Tenancy.module';
import { TenancyDatabaseModule } from '../Tenancy/TenancyDB/TenancyDB.module';
import { AuditLogsModule } from '../AuditLogs/AuditLogs.module';
import { AuthorizationGuard } from '../Roles/Authorization.guard';
import { PermissionGuard } from '../Roles/Permission.guard';
import { BudgetingController } from './Budgeting.controller';
import { BudgetReportsController } from './BudgetReports.controller';
import { BudgetReportsService } from './queries/BudgetReports.service';
import { BudgetCommandsService } from './commands/BudgetCommands.service';
import { BudgetValidator } from './commands/BudgetValidator.service';
import { BudgetQueriesService } from './queries/BudgetQueries.service';
import { BudgetActualsService } from './queries/BudgetActuals.service';
import { BudgetPrefillService } from './queries/BudgetPrefill.service';
import { BudgetSheetService } from './commands/BudgetSheet.service';

/** Budget planning & control (DiTech, docs/ditech/budgeting). */
@Module({
  imports: [TenancyModule, TenancyDatabaseModule, AuditLogsModule],
  // Reports first: `budgets/reports/...` must not reach the `:id` routes.
  controllers: [BudgetReportsController, BudgetingController],
  providers: [
    BudgetCommandsService,
    BudgetValidator,
    BudgetQueriesService,
    BudgetActualsService,
    BudgetPrefillService,
    BudgetSheetService,
    BudgetReportsService,
    AuthorizationGuard,
    PermissionGuard,
  ],
  exports: [BudgetQueriesService, BudgetActualsService, BudgetReportsService],
})
export class BudgetingModule {}
