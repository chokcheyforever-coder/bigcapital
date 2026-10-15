import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsString,
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
