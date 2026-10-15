import { Module } from '@nestjs/common';
import { TenancyModule } from '../Tenancy/Tenancy.module';
import { TenancyDatabaseModule } from '../Tenancy/TenancyDB/TenancyDB.module';
import { AuditLogsModule } from '../AuditLogs/AuditLogs.module';
import { AuthorizationGuard } from '../Roles/Authorization.guard';
import { PermissionGuard } from '../Roles/Permission.guard';
import { ProjectsController } from './Projects.controller';
import { ProjectCommandsService } from './commands/ProjectCommands.service';
import { ProjectValidator } from './commands/ProjectValidator.service';
import { GetProjectsService } from './queries/GetProjects.service';
import { ProjectTransactionsValidatorSubscriber } from './subscribers/ProjectTransactionsValidator.subscriber';

@Module({
  imports: [TenancyModule, TenancyDatabaseModule, AuditLogsModule],
  controllers: [ProjectsController],
  providers: [
    ProjectCommandsService,
    ProjectValidator,
    GetProjectsService,
    ProjectTransactionsValidatorSubscriber,
    AuthorizationGuard,
    PermissionGuard,
  ],
  exports: [ProjectValidator],
})
export class ProjectsModule {}
