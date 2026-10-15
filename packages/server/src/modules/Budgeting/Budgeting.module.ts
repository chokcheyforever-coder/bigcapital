import { Module } from '@nestjs/common';
import { TenancyModule } from '../Tenancy/Tenancy.module';
import { TenancyDatabaseModule } from '../Tenancy/TenancyDB/TenancyDB.module';
import { AuditLogsModule } from '../AuditLogs/AuditLogs.module';
import { AuthorizationGuard } from '../Roles/Authorization.guard';
import { PermissionGuard } from '../Roles/Permission.guard';
import { BudgetingController } from './Budgeting.controller';
import { BudgetCommandsService } from './commands/BudgetCommands.service';
import { BudgetValidator } from './commands/BudgetValidator.service';
import { BudgetQueriesService } from './queries/BudgetQueries.service';

/** Budget planning & control (DiTech, docs/ditech/budgeting). */
@Module({
  imports: [TenancyModule, TenancyDatabaseModule, AuditLogsModule],
  controllers: [BudgetingController],
  providers: [BudgetCommandsService, BudgetValidator, BudgetQueriesService, AuthorizationGuard, PermissionGuard],
  exports: [BudgetQueriesService],
})
export class BudgetingModule {}
