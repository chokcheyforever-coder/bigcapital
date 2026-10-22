import { Module } from '@nestjs/common';
import { TenancyModule } from '../Tenancy/Tenancy.module';
import { TenancyDatabaseModule } from '../Tenancy/TenancyDB/TenancyDB.module';
import { AuditLogsModule } from '../AuditLogs/AuditLogs.module';
import { AuthorizationGuard } from '../Roles/Authorization.guard';
import { PermissionGuard } from '../Roles/Permission.guard';
import { TaxComplianceController } from './TaxCompliance.controller';
import { TaxProfileService } from './TaxProfile.service';
import { TaxDocumentPdfService } from './TaxDocumentPdf.service';
import { ExciseTaxService } from './ExciseTax.service';
import { WithholdingTaxService } from './WithholdingTax.service';
import { ChromiumlyTenancyModule } from '../ChromiumlyTenancy/ChromiumlyTenancy.module';
import { TaxDocumentsSubscriber } from './subscribers/TaxDocuments.subscriber';

@Module({
  imports: [TenancyModule, TenancyDatabaseModule, AuditLogsModule, ChromiumlyTenancyModule],
  controllers: [TaxComplianceController],
  providers: [TaxProfileService, TaxDocumentPdfService, ExciseTaxService, WithholdingTaxService, TaxDocumentsSubscriber, AuthorizationGuard, PermissionGuard],
  exports: [TaxProfileService, TaxDocumentPdfService, ExciseTaxService, WithholdingTaxService],
})
export class TaxComplianceModule {}
