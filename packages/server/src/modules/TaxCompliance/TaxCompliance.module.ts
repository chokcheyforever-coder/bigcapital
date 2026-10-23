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
import { DocumentTaxesService } from './DocumentTaxes.service';
import { CreditTaxesSubscriber } from './subscribers/CreditTaxes.subscriber';
import { TaxRatesModule } from '../TaxRates/TaxRate.module';

@Module({
  imports: [TenancyModule, TenancyDatabaseModule, AuditLogsModule, ChromiumlyTenancyModule, TaxRatesModule],
  controllers: [TaxComplianceController],
  providers: [TaxProfileService, TaxDocumentPdfService, ExciseTaxService, WithholdingTaxService, DocumentTaxesService, TaxDocumentsSubscriber, CreditTaxesSubscriber, AuthorizationGuard, PermissionGuard],
  exports: [TaxProfileService, TaxDocumentPdfService, ExciseTaxService, WithholdingTaxService, DocumentTaxesService],
})
export class TaxComplianceModule {}
