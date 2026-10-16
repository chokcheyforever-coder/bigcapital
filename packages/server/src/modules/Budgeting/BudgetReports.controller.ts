import { Controller, Get, NotFoundException, Param, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiCommonHeaders } from '@/common/decorators/ApiCommonHeaders';
import { RequirePermission } from '@/modules/Roles/RequirePermission.decorator';
import { PermissionGuard } from '@/modules/Roles/Permission.guard';
import { AuthorizationGuard } from '@/modules/Roles/Authorization.guard';
import { AbilitySubject } from '@/modules/Roles/Roles.types';
import { BUDGET_REPORTS, BudgetReportName, BudgetReportQueryDto } from './dtos/Budget.dto';
import { BudgetReportsService } from './queries/BudgetReports.service';
import { BudgetAction } from './Budgeting.types';

const reportName = (name: string): BudgetReportName => {
  if (!(BUDGET_REPORTS as readonly string[]).includes(name)) {
    throw new NotFoundException(`Unknown budget report "${name}". Reports: ${BUDGET_REPORTS.join(', ')}.`);
  }
  return name as BudgetReportName;
};

/** Budget vs actual reports (DiTech Phase 4). Registered before BudgetingController so `reports` is never read as a budget id. */
@Controller('budgets/reports')
@ApiTags('Budgets')
@ApiCommonHeaders()
@UseGuards(AuthorizationGuard, PermissionGuard)
export class BudgetReportsController {
  constructor(private readonly reports: BudgetReportsService) {}

  @Get(':report')
  @RequirePermission(BudgetAction.View, AbilitySubject.Budget)
  @ApiParam({ name: 'report', enum: BUDGET_REPORTS })
  @ApiOperation({
    summary:
      'Budget vs actual report: budget, posted actuals (P&L rules), variance, variance %, used % per line and period, with group totals, net income and a General Ledger drill-down per row.',
  })
  @ApiResponse({ status: 404, description: 'Unknown report, budget or version.' })
  getReport(@Param('report') report: string, @Query() query: BudgetReportQueryDto) {
    return this.reports.report(reportName(report), query);
  }

  @Get(':report/export')
  @RequirePermission(BudgetAction.View, AbilitySubject.Budget)
  @ApiParam({ name: 'report', enum: BUDGET_REPORTS })
  @ApiQuery({ name: 'format', enum: ['xlsx', 'csv'], required: false })
  @ApiOperation({ summary: 'Downloads a budget report as Excel or CSV.' })
  async exportReport(
    @Param('report') report: string,
    @Query() query: BudgetReportQueryDto,
    @Query('format') format: string,
    @Res() res: Response,
  ) {
    const file = await this.reports.exportReport(reportName(report), query, format === 'csv' ? 'csv' : 'xlsx');
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename.replace(/[^\w.-]/g, '_')}"`);
    res.send(file.body);
  }
}
