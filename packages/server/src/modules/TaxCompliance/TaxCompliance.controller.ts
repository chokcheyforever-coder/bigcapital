import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { renderCreditNotePaperTemplateHtml, renderInvoicePaperTemplateHtml, renderReceiptPaperTemplateHtml } from '@bigcapital/pdf-templates';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import * as moment from 'moment';
import { ApiCommonHeaders } from '@/common/decorators/ApiCommonHeaders';
import { RequirePermission } from '@/modules/Roles/RequirePermission.decorator';
import { PermissionGuard } from '@/modules/Roles/Permission.guard';
import { AuthorizationGuard } from '@/modules/Roles/Authorization.guard';
import { AbilitySubject } from '@/modules/Roles/Roles.types';
import { PreferencesAction } from '@/modules/Settings/Settings.types';
import { SaveTaxProfileDto } from './dtos/TaxProfile.dto';
import { DocumentPreviewDto } from './dtos/DocumentPreview.dto';
import { TaxProfileService } from './TaxProfile.service';
import { TaxDocumentPdfService } from './TaxDocumentPdf.service';
import { ExciseTaxService } from './ExciseTax.service';
import { EditExciseTaxCodeDto, SetExciseTaxCodeItemsDto } from './dtos/ExciseTaxCode.dto';

@Controller('tax-compliance')
@ApiTags('Tax compliance')
@ApiCommonHeaders()
@UseGuards(AuthorizationGuard, PermissionGuard)
export class TaxComplianceController {
  constructor(
    private readonly profiles: TaxProfileService,
    private readonly documents: TaxDocumentPdfService,
    private readonly excise: ExciseTaxService,
  ) {}

  /** Anyone preparing documents needs to know whether tax documents are on. */
  @Get('profile')
  @ApiOperation({ summary: 'Retrieves the company tax profile (Cambodian tax documents).' })
  getProfile() {
    return this.profiles.get();
  }

  @Put('profile')
  @RequirePermission(PreferencesAction.Mutate, AbilitySubject.Preferences)
  @ApiOperation({ summary: 'Saves the company tax profile.' })
  saveProfile(@Body() dto: SaveTaxProfileDto) {
    return this.profiles.save(dto);
  }

  @Get('khr-rate')
  @ApiQuery({ name: 'currency', required: false, example: 'USD' })
  @ApiQuery({ name: 'date', required: false, example: '2026-10-21' })
  @ApiOperation({ summary: 'The riel rate a document of this currency and date would print.' })
  async khrRate(@Query('currency') currency?: string, @Query('date') date?: string) {
    const profile = await this.profiles.get();
    const day = /^\d{4}-\d{2}-\d{2}$/.test(date ?? '') ? date! : moment().format('YYYY-MM-DD');
    return (await this.profiles.khrRate(currency || 'USD', day, profile)) ?? { rate: null };
  }

  /** Sample tax document block for the invoice designer's preview (empty when the profile is off). */
  @Get('sample')
  @ApiOperation({ summary: 'A sample tax document block in the company language, with today\'s riel rate.' })
  async sample() {
    return (await this.documents.sample()) ?? {};
  }

  /**
   * The designer's live preview: the invoice template rendered by the same
   * code as the PDF, with sample lines and, when tax documents are on, a sample
   * tax block. The webapp shows it in a frame.
   */
  @Post('preview/:document')
  @HttpCode(200)
  @ApiOperation({ summary: 'Renders a document preview (HTML) from branding attributes being edited: invoice, receipt or credit-note.' })
  async preview(@Param('document') document: string, @Body() dto: DocumentPreviewDto) {
    const renderers: Record<string, (props: any) => string> = {
      invoice: renderInvoicePaperTemplateHtml,
      receipt: renderReceiptPaperTemplateHtml,
      'credit-note': renderCreditNotePaperTemplateHtml,
    };
    const render = renderers[document];
    if (!render) throw new BadRequestException('document must be invoice, receipt or credit-note');
    const compliance = await this.documents.sample(document as 'invoice' | 'receipt' | 'credit-note');
    const { compliance: _ignored, ...attributes } = dto.attributes ?? {};
    return { htmlContent: render({ ...attributes, ...(compliance ? { compliance } : {}) } as any) };
  }

  /** What a document's PDF prints as a tax document (empty when the profile is off). */
  @Get('documents/:type/:id')
  @ApiOperation({ summary: 'The tax document block (title, TINs, riel amounts) of an invoice, receipt or credit note.' })
  async document(@Param('type') type: string, @Param('id', ParseIntPipe) id: number, @Query('total') total?: string, @Query('tax') tax?: string) {
    const types: Record<string, 'SaleInvoice' | 'SaleReceipt' | 'CreditNote'> = { 'sale-invoices': 'SaleInvoice', 'sale-receipts': 'SaleReceipt', 'credit-notes': 'CreditNote' };
    if (!types[type]) throw new BadRequestException('type must be sale-invoices, sale-receipts or credit-notes');
    const out = await this.documents.explain(types[type], id, { total: Number(total ?? 0), tax: Number(tax ?? 0) });
    return out.attributes ?? { reason: out.reason };
  }

  /** Specific Tax, Accommodation Tax and PLT codes with their items (created on first use). */
  @Get('excise-codes')
  @ApiOperation({ summary: 'Lists the taxes charged before VAT (Specific Tax, Accommodation Tax, Public Lighting Tax) and their items.' })
  exciseCodes() {
    return this.excise.list();
  }

  @Put('excise-codes/:id')
  @RequirePermission(PreferencesAction.Mutate, AbilitySubject.Preferences)
  @ApiOperation({ summary: 'Edits a tax code: rate, base percentage, payable account, active.' })
  editExciseCode(@Param('id', ParseIntPipe) id: number, @Body() dto: EditExciseTaxCodeDto) {
    return this.excise.edit(id, dto);
  }

  @Put('excise-codes/:id/items')
  @RequirePermission(PreferencesAction.Mutate, AbilitySubject.Preferences)
  @ApiOperation({ summary: 'Sets the items charged this tax (replaces the list).' })
  setExciseCodeItems(@Param('id', ParseIntPipe) id: number, @Body() dto: SetExciseTaxCodeItemsDto) {
    return this.excise.setItems(id, dto.itemIds);
  }
}
