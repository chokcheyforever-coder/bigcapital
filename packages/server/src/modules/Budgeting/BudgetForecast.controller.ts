import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiCommonHeaders } from '@/common/decorators/ApiCommonHeaders';
import { RequirePermission } from '@/modules/Roles/RequirePermission.decorator';
import { PermissionGuard } from '@/modules/Roles/Permission.guard';
import { AuthorizationGuard } from '@/modules/Roles/Authorization.guard';
import { AbilitySubject } from '@/modules/Roles/Roles.types';
import { BudgetAction } from './Budgeting.types';
import { BudgetForecastService } from './queries/BudgetForecast.service';
import { BudgetDashboardService } from './queries/BudgetDashboard.service';
import { BudgetQueriesService } from './queries/BudgetQueries.service';
import { BudgetNotificationService } from './notifications/BudgetNotification.service';
import {
  BudgetDashboardQueryDto,
  CreateForecastDto,
  ForecastVsBudgetQueryDto,
  GetNotificationsQueryDto,
  MarkNotificationsReadDto,
  RefreshForecastDto,
  RollingForecastQueryDto,
  SaveNotificationSettingsDto,
} from './dtos/BudgetForecast.dto';

/**
 * Forecasts, dashboard and notifications (design §15).
 * Registered before BudgetingController so `budgets/dashboard` and `budgets/notifications` never reach `:id`.
 */
@Controller('budgets')
@ApiTags('Budgets')
@ApiCommonHeaders()
@UseGuards(AuthorizationGuard, PermissionGuard)
export class BudgetForecastController {
  constructor(
    private readonly forecasts: BudgetForecastService,
    private readonly dashboardService: BudgetDashboardService,
    private readonly queries: BudgetQueriesService,
    private readonly notifications: BudgetNotificationService,
  ) {}

  @Get('dashboard')
  @RequirePermission(BudgetAction.View, AbilitySubject.Budget)
  @ApiOperation({ summary: 'Budget dashboard: KPIs, months, worst variances and projection, all taken from the budget reports.' })
  dashboard(@Query() query: BudgetDashboardQueryDto) {
    return this.dashboardService.dashboard(query);
  }

  @Get('notifications')
  @RequirePermission(BudgetAction.View, AbilitySubject.Budget)
  @ApiOperation({ summary: 'My budget notifications, newest first (unread=true: only unread).' })
  getNotifications(@Query() query: GetNotificationsQueryDto) {
    return this.notifications.list(query);
  }

  @Post('notifications/read')
  @HttpCode(200)
  @RequirePermission(BudgetAction.View, AbilitySubject.Budget)
  @ApiOperation({ summary: 'Marks some (ids) or all of my budget notifications read.' })
  markRead(@Body() dto: MarkNotificationsReadDto) {
    return this.notifications.markRead(dto.ids);
  }

  @Get('settings/notifications')
  @RequirePermission(BudgetAction.View, AbilitySubject.Budget)
  @ApiOperation({ summary: 'Company settings for budget emails and spending alerts.' })
  getNotificationSettings() {
    return this.notifications.getSettings();
  }

  @Put('settings/notifications')
  @RequirePermission(BudgetAction.ConfigurePolicy, AbilitySubject.Budget)
  @ApiOperation({ summary: 'Turns budget emails on or off and sets the spending alert level.' })
  saveNotificationSettings(@Body() dto: SaveNotificationSettingsDto) {
    return this.notifications.saveSettings(dto);
  }

  @Post(':id/forecasts')
  @RequirePermission(BudgetAction.Revise, AbilitySubject.Budget)
  @ApiOperation({ summary: 'Creates a forecast version: actuals up to the as-of month, then the chosen method.' })
  async createForecast(@Param('id', ParseIntPipe) id: number, @Body() dto: CreateForecastDto) {
    const version = await this.forecasts.createForecast(id, dto);
    return { versionNo: version.versionNo, version: await this.queries.getVersion(id, version.versionNo) };
  }

  @Post(':id/versions/:versionNo/forecast/refresh')
  @HttpCode(200)
  @RequirePermission(BudgetAction.EditDraft, AbilitySubject.Budget)
  @ApiOperation({ summary: 'Recomputes a draft forecast with current actuals, keeping its settings unless new ones are given. Replaces its amounts.' })
  async refreshForecast(@Param('id', ParseIntPipe) id: number, @Param('versionNo', ParseIntPipe) versionNo: number, @Body() dto: RefreshForecastDto) {
    await this.forecasts.refreshForecast(id, versionNo, dto);
    return this.queries.getVersion(id, versionNo);
  }

  @Get(':id/forecast-vs-budget')
  @RequirePermission(BudgetAction.View, AbilitySubject.Budget)
  @ApiOperation({ summary: 'Forecast vs budget: budget, actual to date, remaining forecast and projected total per line.' })
  forecastVsBudget(@Param('id', ParseIntPipe) id: number, @Query() query: ForecastVsBudgetQueryDto) {
    return this.forecasts.forecastVsBudget(id, query);
  }

  @Get(':id/rolling-forecast')
  @RequirePermission(BudgetAction.View, AbilitySubject.Budget)
  @ApiOperation({ summary: 'Rolling forecast: the next 12 months after the as-of month, from actuals.' })
  rolling(@Param('id', ParseIntPipe) id: number, @Query() query: RollingForecastQueryDto) {
    return this.forecasts.rolling(id, query);
  }
}
