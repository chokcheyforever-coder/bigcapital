import { Module } from '@nestjs/common';
import { TenancyModule } from '../Tenancy/Tenancy.module';
import { TenancyDatabaseModule } from '../Tenancy/TenancyDB/TenancyDB.module';
import { TaxComplianceModule } from '../TaxCompliance/TaxCompliance.module';
import { ManualJournalsModule } from '../ManualJournals/ManualJournals.module';
import { AuthorizationGuard } from '../Roles/Authorization.guard';
import { PermissionGuard } from '../Roles/Permission.guard';
import { TaxReturnsController } from './TaxReturns.controller';
import { TaxReturnsService } from './TaxReturns.service';

/** 103 DiTech part C3: monthly tax returns (VAT books, worksheet, prepayment). */
@Module({
  imports: [TenancyModule, TenancyDatabaseModule, TaxComplianceModule, ManualJournalsModule],
  controllers: [TaxReturnsController],
  providers: [TaxReturnsService, AuthorizationGuard, PermissionGuard],
})
export class TaxReturnsModule {}
