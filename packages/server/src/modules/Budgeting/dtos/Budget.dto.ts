import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { castArray } from 'lodash';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsOptional, ToNumber } from '@/common/decorators/Validators';
import { BudgetType } from '../Budgeting.types';

export class CreateBudgetDto {
  @ApiProperty({ example: 'Operating budget 2027' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(120)
  name: string;

  @ApiPropertyOptional({ description: 'Unique reference; generated (BUD-2027-001) when left out', example: 'BUD-2027-001' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  reference?: string;

  @ApiProperty({ enum: BudgetType })
  @IsIn(Object.values(BudgetType))
  type: BudgetType;

  @ApiProperty({ description: 'Fiscal year (the calendar year it starts in)', example: 2027 })
  @ToNumber()
  @IsInt()
  @Min(2000)
  @Max(2100)
  fiscalYear: number;

  @ApiPropertyOptional({ description: 'Defaults to the start of the fiscal year', example: '2027-01-01' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'Defaults to the end of the fiscal year', example: '2027-12-31' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ description: 'Branch the whole budget is for' })
  @IsOptional()
  @ToNumber()
  @IsInt()
  branchId?: number;

  @ApiPropertyOptional({ description: 'Project the whole budget is for' })
  @IsOptional()
  @ToNumber()
  @IsInt()
  projectId?: number;

  @ApiPropertyOptional({ description: 'User responsible for the budget' })
  @IsOptional()
  @ToNumber()
  @IsInt()
  ownerUserId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;
}

/** Type, period, currency and scope are fixed once created; edit the rest. */
export class EditBudgetDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @MaxLength(120)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  reference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @ToNumber()
  @IsInt()
  ownerUserId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;
}

export class GetBudgetsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @ToNumber()
  @IsInt()
  fiscalYear?: number;

  @ApiPropertyOptional({ enum: BudgetType })
  @IsOptional()
  @IsIn(Object.values(BudgetType))
  type?: BudgetType;

  @ApiPropertyOptional({ description: 'Search by name or reference' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @ToNumber()
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @ToNumber()
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;
}

/** One month of a line. Month keys can't be object keys: request keys are camel-cased. */
export class BudgetMonthAmountDto {
  @ApiProperty({ description: 'YYYY-MM or YYYY-MM-01', example: '2027-01' })
  @IsString()
  month: string;

  @ApiPropertyOptional({ description: 'Amount; null removes the month', example: 1250.5, nullable: true })
  // Kept by the whitelist; parsed and checked against the currency in the service.
  @IsOptional()
  amount: number | string | null;
}

export class SaveBudgetLineDto {
  @ApiProperty()
  @ToNumber()
  @IsInt()
  accountId: number;

  @ApiPropertyOptional()
  @IsOptional()
  @ToNumber()
  @IsInt()
  branchId?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @ToNumber()
  @IsInt()
  projectId?: number | null;

  @ApiPropertyOptional({ description: 'null clears the note' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string | null;

  @ApiPropertyOptional({ description: 'null clears the assumption' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  assumption?: string | null;

  @ApiPropertyOptional({
    type: [BudgetMonthAmountDto],
    description: 'Only the months given change; an amount of null removes that month.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(24)
  @ValidateNested({ each: true })
  @Type(() => BudgetMonthAmountDto)
  amounts?: BudgetMonthAmountDto[];
}

export class SaveBudgetLinesDto {
  @ApiProperty({ description: 'The version\'s lock_version as last read; refused (409) if it changed since' })
  @ToNumber()
  @IsInt()
  @Min(0)
  lockVersion: number;

  @ApiProperty({ type: [SaveBudgetLineDto] })
  @IsArray()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => SaveBudgetLineDto)
  lines: SaveBudgetLineDto[];

  @ApiPropertyOptional({ type: [Number], description: 'Lines to delete' })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  removeLineIds?: number[];
}

export const ALLOCATION_METHODS = ['equal', 'percentage', 'seasonal', 'growth'] as const;
export type AllocationMethod = (typeof ALLOCATION_METHODS)[number];

export class AllocateBudgetDto {
  @ApiProperty({ enum: ALLOCATION_METHODS })
  @IsIn(ALLOCATION_METHODS as unknown as string[])
  method: AllocationMethod;

  @ApiPropertyOptional({ description: 'Amount to spread (equal, percentage, seasonal)' })
  @IsOptional()
  amount?: number | string;

  @ApiPropertyOptional({ type: [Number], description: 'One per month: percentages (must add up to 100) or seasonal weights' })
  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  values?: number[];

  @ApiPropertyOptional({ type: [BudgetMonthAmountDto], description: 'growth: the monthly amounts to grow' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(24)
  @ValidateNested({ each: true })
  @Type(() => BudgetMonthAmountDto)
  baseAmounts?: BudgetMonthAmountDto[];

  @ApiPropertyOptional({ description: 'growth: percentage, e.g. 5 or -10' })
  @IsOptional()
  @IsNumber()
  growthPercent?: number;
}

export const PREFILL_SOURCES = ['actuals', 'budget'] as const;

export class PrefillBudgetDto {
  @ApiProperty({ enum: PREFILL_SOURCES, description: 'Posted actuals of an earlier period, or another budget version' })
  @IsIn(PREFILL_SOURCES as unknown as string[])
  source: (typeof PREFILL_SOURCES)[number];

  @ApiPropertyOptional({ description: 'actuals: how many years back (1 = the same months last year)', default: 1 })
  @IsOptional()
  @ToNumber()
  @IsInt()
  @Min(1)
  @Max(10)
  yearsBack?: number;

  @ApiPropertyOptional({ enum: ['none', 'branch', 'project'], description: 'actuals: keep branches or projects on separate lines', default: 'none' })
  @IsOptional()
  @IsIn(['none', 'branch', 'project'])
  splitBy?: 'none' | 'branch' | 'project';

  @ApiPropertyOptional({ description: 'budget: the budget to copy from' })
  @IsOptional()
  @ToNumber()
  @IsInt()
  sourceBudgetId?: number;

  @ApiPropertyOptional({ description: 'budget: its version (default: the latest)' })
  @IsOptional()
  @ToNumber()
  @IsInt()
  sourceVersionNo?: number;

  @ApiPropertyOptional({ description: 'Growth (or reduction, negative) applied to every month', example: 5 })
  @IsOptional()
  @IsNumber()
  @Min(-100)
  @Max(1000)
  growthPercent?: number;

  @ApiPropertyOptional({ type: [Number], description: 'Only these accounts (default: every account the budget type allows)' })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  accountIds?: number[];
}

// ---------------------------------------------------------------- reports (Phase 4)

export const BUDGET_REPORTS = [
  'budget-vs-actual',
  'monthly-variance',
  'branch',
  'project',
  'revenue-achievement',
  'expense-utilization',
  'capex',
  'exceptions',
] as const;
export type BudgetReportName = (typeof BUDGET_REPORTS)[number];

// A single id arrives as a plain string (`branchesIds=5`), several as an array.
const toIdList = ({ value }: { value: unknown }) =>
  value === undefined || value === null || value === ''
    ? undefined
    : castArray(value).filter((v) => v !== '').map(Number);

export class BudgetReportQueryDto {
  @ApiProperty({ description: 'Budget to compare with the ledger' })
  @ToNumber()
  @IsInt()
  budgetId: number;

  @ApiPropertyOptional({ description: 'Version number; defaults to the active version, else the latest approved or locked, else the latest' })
  @IsOptional()
  @ToNumber()
  @IsInt()
  @Min(1)
  versionNo?: number;

  @ApiPropertyOptional({ description: 'First month (YYYY-MM); defaults to the budget start', example: '2027-01' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}(-01)?$/)
  fromMonth?: string;

  @ApiPropertyOptional({ description: 'Last month (YYYY-MM); defaults to the budget end', example: '2027-06' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}(-01)?$/)
  toMonth?: string;

  @ApiPropertyOptional({ type: [Number], description: 'Only ledger rows and budget lines of these branches' })
  @IsOptional()
  @Transform(toIdList)
  @IsArray()
  @IsInt({ each: true })
  branchesIds?: number[];

  @ApiPropertyOptional({ type: [Number], description: 'Only ledger rows and budget lines of these projects' })
  @IsOptional()
  @Transform(toIdList)
  @IsArray()
  @IsInt({ each: true })
  projectsIds?: number[];

  @ApiPropertyOptional({ enum: ['total', 'quarter', 'month'], default: 'total', description: 'Period columns (monthly-variance is always by month)' })
  @IsOptional()
  @IsIn(['total', 'quarter', 'month'])
  columns?: 'total' | 'quarter' | 'month';

  @ApiPropertyOptional({ default: 10, description: 'Exceptions: unfavorable variance of at least this % of budget' })
  @IsOptional()
  @ToNumber()
  @IsNumber()
  @Min(0)
  @Max(1000)
  thresholdPercent?: number;

  @ApiPropertyOptional({ default: 90, description: 'Expense utilization: "near" from this % of budget' })
  @IsOptional()
  @ToNumber()
  @IsNumber()
  @Min(0)
  @Max(100)
  nearPercent?: number;

  @ApiPropertyOptional({ default: true, description: 'Include accounts with actuals but no budget line' })
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : value === true || value === 'true' || value === '1'))
  @IsBoolean()
  includeUnbudgeted?: boolean;
}
