import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ApiCommonHeaders } from '@/common/decorators/ApiCommonHeaders';
import { RequirePermission } from '@/modules/Roles/RequirePermission.decorator';
import { PermissionGuard } from '@/modules/Roles/Permission.guard';
import { AuthorizationGuard } from '@/modules/Roles/Authorization.guard';
import { AbilitySubject } from '@/modules/Roles/Roles.types';
import { BudgetAction } from './Budgeting.types';
import { BudgetControlService } from './control/BudgetControl.service';
import { BudgetControlAdminService } from './control/BudgetControlAdmin.service';
import {
  AvailabilityQueryDto,
  DecideOverrideDto,
  GetControlEventsQueryDto,
  GetOverridesQueryDto,
  RequestOverrideDto,
  SaveControlPolicyDto,
} from './dtos/BudgetControl.dto';

/**
 * Spending control: policies, override requests, alerts and availability (design §13).
 * Registered before BudgetingController so `budgets/overrides` and `budgets/alerts` never reach `:id`.
 */
@Controller('budgets')
@ApiTags('Budgets')
@ApiCommonHeaders()
@UseGuards(AuthorizationGuard, PermissionGuard)
export class BudgetControlController {
  constructor(
    private readonly control: BudgetControlService,
    private readonly admin: BudgetControlAdminService,
  ) {}

  @Get('settings/policies')
  @RequirePermission(BudgetAction.View, AbilitySubject.Budget)
  @ApiOperation({ summary: 'Spending control policies: the company default and per-budget policies.' })
  getPolicies() {
    return this.admin.getPolicies();
  }

  @Put('settings/policies')
  @RequirePermission(BudgetAction.ConfigurePolicy, AbilitySubject.Budget)
  @ApiOperation({ summary: 'Saves the default policy (no budgetId) or a budget\'s own policy.' })
  savePolicy(@Body() dto: SaveControlPolicyDto) {
    return this.admin.savePolicy(dto);
  }

  @Delete('settings/policies')
  @RequirePermission(BudgetAction.ConfigurePolicy, AbilitySubject.Budget)
  @ApiQuery({ name: 'budgetId', required: false, description: 'Empty removes the default policy' })
  @ApiOperation({ summary: 'Removes a budget\'s own policy (it then follows the default), or the default.' })
  async deletePolicy(@Query('budgetId') budgetId?: string) {
    await this.admin.deletePolicy(budgetId ? Number(budgetId) || null : null);
    return { message: 'The policy has been removed.' };
  }

  @Post('overrides')
  @RequirePermission(BudgetAction.View, AbilitySubject.Budget)
  @ApiOperation({ summary: 'Requests approval to post a draft bill, expense or journal over its budget.' })
  requestOverride(@Body() dto: RequestOverrideDto) {
    return this.admin.requestOverride(dto);
  }

  @Get('overrides')
  @RequirePermission(BudgetAction.View, AbilitySubject.Budget)
  @ApiOperation({ summary: 'Override requests, newest first.' })
  getOverrides(@Query() query: GetOverridesQueryDto) {
    return this.admin.getOverrides(query);
  }

  @Post('overrides/:id/approve')
  @HttpCode(200)
  @RequirePermission(BudgetAction.Approve, AbilitySubject.Budget)
  @ApiOperation({ summary: 'Approves an override request; the document can then be posted.' })
  approveOverride(@Param('id', ParseIntPipe) id: number, @Body() dto: DecideOverrideDto) {
    return this.admin.decideOverride(id, 'approved', dto.comment);
  }

  @Post('overrides/:id/reject')
  @HttpCode(200)
  @RequirePermission(BudgetAction.Approve, AbilitySubject.Budget)
  @ApiOperation({ summary: 'Rejects an override request.' })
  rejectOverride(@Param('id', ParseIntPipe) id: number, @Body() dto: DecideOverrideDto) {
    return this.admin.decideOverride(id, 'rejected', dto.comment);
  }

  @Get('alerts')
  @RequirePermission(BudgetAction.View, AbilitySubject.Budget)
  @ApiOperation({ summary: 'Budget alerts: every threshold a posted document reached, newest first.' })
  getAlerts(@Query() query: GetControlEventsQueryDto) {
    return this.admin.getEvents(query);
  }

  @Get(':id/availability')
  @RequirePermission(BudgetAction.View, AbilitySubject.Budget)
  @ApiOperation({ summary: 'Budget, actual, open commitments (draft bills and expenses) and available per line of the active version.' })
  getAvailability(@Param('id', ParseIntPipe) id: number, @Query() query: AvailabilityQueryDto) {
    return this.control.availability(id, query.month, query.basis);
  }
}
