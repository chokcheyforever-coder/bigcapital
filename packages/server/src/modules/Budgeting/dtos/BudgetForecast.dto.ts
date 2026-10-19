import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { IsOptional, ToNumber } from '@/common/decorators/Validators';
import { FORECAST_METHODS, ForecastMethod } from '../calc/forecast';

const MONTH = /^\d{4}-\d{2}(-01)?$/;
const toBool = ({ value }: { value: unknown }) => value === true || value === 'true' || value === '1';

/** Shared by creating and refreshing a forecast (design §15). */
export class ForecastSettingsDto {
  @ApiPropertyOptional({ enum: FORECAST_METHODS, default: 'run_rate' })
  @IsOptional()
  @IsIn(FORECAST_METHODS)
  method?: ForecastMethod;

  @ApiPropertyOptional({ description: 'Last month with actuals (YYYY-MM); defaults to last month, kept inside the budget period', example: '2027-03' })
  @IsOptional()
  @IsString()
  @Matches(MONTH)
  asOfMonth?: string;

  @ApiPropertyOptional({ description: 'Months averaged by run_rate and seasonal', default: 3 })
  @IsOptional()
  @ToNumber()
  @IsInt()
  @Min(1)
  @Max(12)
  runRateMonths?: number;

  @ApiPropertyOptional({ description: 'growth: change on the same month last year, in percent', example: 5 })
  @IsOptional()
  @ToNumber()
  @IsNumber()
  @Min(-100)
  @Max(1000)
  growthPercent?: number;
}

export class CreateForecastDto extends ForecastSettingsDto {
  @ApiPropertyOptional({ example: 'Forecast after Q1' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;

  @ApiPropertyOptional({ description: 'Budget version the forecast starts from (lines, and amounts for the budget method); defaults to the active version' })
  @IsOptional()
  @ToNumber()
  @IsInt()
  baseVersionNo?: number;
}

export class RefreshForecastDto extends ForecastSettingsDto {
  @ApiProperty({ description: 'Version lock (the forecast is overwritten; refused if someone saved it since)' })
  @ToNumber()
  @IsInt()
  lockVersion: number;
}

export class ForecastVsBudgetQueryDto {
  @ApiPropertyOptional({ description: 'Forecast version; defaults to the latest forecast' })
  @IsOptional()
  @ToNumber()
  @IsInt()
  forecastVersionNo?: number;

  @ApiPropertyOptional({ description: 'Budget version to compare with; defaults to the active version' })
  @IsOptional()
  @ToNumber()
  @IsInt()
  baseVersionNo?: number;
}

export class RollingForecastQueryDto {
  @ApiPropertyOptional({ enum: ['run_rate', 'growth', 'seasonal'], default: 'run_rate' })
  @IsOptional()
  @IsIn(['run_rate', 'growth', 'seasonal'])
  method?: Exclude<ForecastMethod, 'budget'>;

  @ApiPropertyOptional({ description: 'Last month with actuals (YYYY-MM); defaults to last month' })
  @IsOptional()
  @IsString()
  @Matches(MONTH)
  asOfMonth?: string;

  @ApiPropertyOptional({ default: 12, description: '1 to 12 months ahead' })
  @IsOptional()
  @ToNumber()
  @IsInt()
  @Min(1)
  @Max(12)
  months?: number;

  @ApiPropertyOptional({ default: 3 })
  @IsOptional()
  @ToNumber()
  @IsInt()
  @Min(1)
  @Max(12)
  runRateMonths?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @ToNumber()
  @IsNumber()
  @Min(-100)
  @Max(1000)
  growthPercent?: number;
}

export class BudgetDashboardQueryDto {
  @ApiPropertyOptional({ description: 'Budget to show; defaults to the latest budget with an active version' })
  @IsOptional()
  @ToNumber()
  @IsInt()
  budgetId?: number;

  @ApiPropertyOptional({ description: 'Year to date up to this month (YYYY-MM); defaults to last month, kept inside the budget period' })
  @IsOptional()
  @IsString()
  @Matches(MONTH)
  asOfMonth?: string;
}

export class GetNotificationsQueryDto {
  @ApiPropertyOptional({ description: 'Only the ones I have not read' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  unread?: boolean;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @ToNumber()
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 30 })
  @IsOptional()
  @ToNumber()
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class MarkNotificationsReadDto {
  @ApiPropertyOptional({ description: 'Notifications to mark read; leave out to mark all of mine read' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsInt({ each: true })
  ids?: number[];
}

export const ALERT_LEVELS = ['off', 'exceeded', 'warning'] as const;

export class SaveNotificationSettingsDto {
  @ApiProperty({ description: 'Send budget notifications by email (they always show in the app)' })
  @IsBoolean()
  email: boolean;

  @ApiProperty({ enum: ALERT_LEVELS, description: 'Tell the budget owner about spending: never, when a line is exceeded, or from the warning threshold' })
  @IsIn(ALERT_LEVELS)
  alertLevel: (typeof ALERT_LEVELS)[number];
}
