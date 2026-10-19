import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsNotEmpty, IsNumber, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { IsOptional, ToNumber } from '@/common/decorators/Validators';
import { CONTROL_MODES, CONTROLLED_TYPES, ControlledType, ControlMode, PERIOD_BASES, PeriodBasis } from '../calc/control';

export class SaveControlPolicyDto {
  @ApiPropertyOptional({ description: 'Budget the policy is for; empty = the company default', nullable: true })
  @IsOptional()
  @ToNumber()
  @IsInt()
  budgetId?: number | null;

  @ApiProperty({ enum: CONTROL_MODES, description: 'off, inform (warn only), warn_approve (needs an approved override), block' })
  @IsIn(CONTROL_MODES)
  mode: ControlMode;

  @ApiPropertyOptional({ type: [Number], example: [75, 90], description: 'Alert at these % of budget used' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsNumber({}, { each: true })
  @Min(1, { each: true })
  @Max(100, { each: true })
  thresholds?: number[];

  @ApiPropertyOptional({ enum: PERIOD_BASES, default: 'month' })
  @IsOptional()
  @IsIn(PERIOD_BASES)
  periodBasis?: PeriodBasis;

  @ApiPropertyOptional({ enum: CONTROLLED_TYPES, isArray: true, default: CONTROLLED_TYPES })
  @IsOptional()
  @IsArray()
  @IsIn(CONTROLLED_TYPES, { each: true })
  transactionTypes?: ControlledType[];
}

export class RequestOverrideDto {
  @ApiProperty({ enum: CONTROLLED_TYPES })
  @IsIn(CONTROLLED_TYPES)
  referenceType: ControlledType;

  @ApiProperty({ description: 'Id of the draft bill, expense or manual journal' })
  @ToNumber()
  @IsInt()
  referenceId: number;

  @ApiProperty({ description: 'Why the document must go over budget' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(1000)
  reason: string;
}

export class DecideOverrideDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

export class GetOverridesQueryDto {
  @ApiPropertyOptional({ enum: ['pending', 'approved', 'rejected', 'cancelled'] })
  @IsOptional()
  @IsIn(['pending', 'approved', 'rejected', 'cancelled'])
  status?: string;

  @ApiPropertyOptional({ enum: CONTROLLED_TYPES })
  @IsOptional()
  @IsIn(CONTROLLED_TYPES)
  referenceType?: ControlledType;

  @ApiPropertyOptional()
  @IsOptional()
  @ToNumber()
  @IsInt()
  referenceId?: number;
}

export class GetControlEventsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @ToNumber()
  @IsInt()
  budgetId?: number;

  @ApiPropertyOptional({ enum: ['info', 'warning', 'exceeded'] })
  @IsOptional()
  @IsIn(['info', 'warning', 'exceeded'])
  level?: string;

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

export class AvailabilityQueryDto {
  @ApiPropertyOptional({ example: '2027-06', description: 'Month the period is anchored on; defaults to this month (inside the budget)' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}(-01)?$/)
  month?: string;

  @ApiPropertyOptional({ enum: PERIOD_BASES, description: 'Defaults to the policy\'s basis, else year' })
  @IsOptional()
  @IsIn(PERIOD_BASES)
  basis?: PeriodBasis;
}
