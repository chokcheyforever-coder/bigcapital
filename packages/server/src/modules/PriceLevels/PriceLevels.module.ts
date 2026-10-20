import { Module } from '@nestjs/common';
import { TenancyModule } from '../Tenancy/Tenancy.module';
import { TenancyDatabaseModule } from '../Tenancy/TenancyDB/TenancyDB.module';
import { AuditLogsModule } from '../AuditLogs/AuditLogs.module';
import { AuthorizationGuard } from '../Roles/Authorization.guard';
import { PermissionGuard } from '../Roles/Permission.guard';
import { PriceLevelsController } from './PriceLevels.controller';
import { PriceLevelCommandsService } from './commands/PriceLevelCommands.service';
import { PriceLevelValidator } from './commands/PriceLevelValidator.service';
import { PriceLevelQueriesService } from './queries/PriceLevelQueries.service';
import { PriceLevelDocumentsSubscriber } from './subscribers/PriceLevelDocuments.subscriber';

@Module({
  imports: [TenancyModule, TenancyDatabaseModule, AuditLogsModule],
  controllers: [PriceLevelsController],
  providers: [
    PriceLevelCommandsService,
    PriceLevelValidator,
    PriceLevelQueriesService,
    PriceLevelDocumentsSubscriber,
    AuthorizationGuard,
    PermissionGuard,
  ],
  exports: [PriceLevelQueriesService],
})
export class PriceLevelsModule {}
