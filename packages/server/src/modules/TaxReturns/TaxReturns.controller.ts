import { BadRequestException, Controller, Get, HttpCode, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { ApiCommonHeaders } from '@/common/decorators/ApiCommonHeaders';
import { RequirePermission } from '@/modules/Roles/RequirePermission.decorator';
import { PermissionGuard } from '@/modules/Roles/Permission.guard';
import { AuthorizationGuard } from '@/modules/Roles/Authorization.guard';
import { AbilitySubject } from '@/modules/Roles/Roles.types';
import { PreferencesAction } from '@/modules/Settings/Settings.types';
import { TaxReturnsService } from './TaxReturns.service';

const month = (value: string) => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value ?? '')) throw new BadRequestException('month must be YYYY-MM');
  return value;
};

/** 103 DiTech part C3: monthly VAT books, return worksheet and the 1% prepayment. */
@Controller('tax-compliance')
@ApiTags('Tax compliance')
@ApiCommonHeaders()
@UseGuards(AuthorizationGuard, PermissionGuard)
export class TaxReturnsController {
  constructor(private readonly returns: TaxReturnsService) {}

  @Get('vat-books/:book')
  @ApiQuery({ name: 'month', required: true, example: '2026-10' })
  @ApiOperation({ summary: 'The sales or purchase VAT book of a month (GDT e-VAT layout).' })
  async book(@Param('book') book: string, @Query('month') m: string) {
    if (book === 'sales') return this.returns.salesBook(month(m));
    if (book === 'purchases') return this.returns.purchaseBook(month(m));
    throw new BadRequestException('book must be sales or purchases');
  }

  @Get('vat-books-export')
  @ApiQuery({ name: 'month', required: true, example: '2026-10' })
  @ApiOperation({ summary: 'Both VAT books of a month as an Excel workbook.' })
  async export(@Query('month') m: string, @Res() res: Response) {
    const { body, filename } = await this.returns.booksWorkbook(month(m));
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Length': body.length,
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    res.send(body);
  }

  @Get('returns/worksheet')
  @ApiQuery({ name: 'month', required: true, example: '2026-10' })
  @ApiOperation({ summary: 'The monthly return worksheet: VAT, withholding, prepayment, Specific Tax, PLT, Accommodation Tax.' })
  worksheet(@Query('month') m: string) {
    return this.returns.worksheet(month(m));
  }

  @Post('returns/prepayment')
  @HttpCode(200)
  @RequirePermission(PreferencesAction.Mutate, AbilitySubject.Preferences)
  @ApiQuery({ name: 'month', required: true, example: '2026-10' })
  @ApiOperation({ summary: 'Posts the 1% prepayment of tax on income for the month (once).' })
  prepayment(@Query('month') m: string) {
    return this.returns.postPrepayment(month(m));
  }
}
