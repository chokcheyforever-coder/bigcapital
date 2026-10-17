import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
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

const MAX_AMOUNT = 9_999_999_999;

export class WorkflowCommentDto {
  @ApiPropertyOptional({ description: 'Shown in the approval history' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

export class RejectVersionDto {
  @ApiProperty({ description: 'Why the version is rejected (required)' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(1000)
  comment: string;
}

export class DelegateStepDto {
  @ApiProperty({ description: 'Tenant user id (from GET /users) who decides the current step instead' })
  @ToNumber()
  @IsInt()
  userId: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

export class CreateRevisionDto {
  @ApiProperty({ description: 'Why the approved budget is being revised' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(1000)
  reason: string;

  @ApiPropertyOptional({ description: 'Version to copy; defaults to the active version' })
  @IsOptional()
  @ToNumber()
  @IsInt()
  sourceVersionNo?: number;

  @ApiPropertyOptional({ example: 'Mid-year revision' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;
}

export const SCENARIOS = ['base', 'best', 'worst', 'custom'] as const;

export class CreateScenarioDto {
  @ApiProperty({ enum: SCENARIOS })
  @IsIn(SCENARIOS)
  scenario: (typeof SCENARIOS)[number];

  @ApiProperty({ example: 'Worst case: sales −15%' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(120)
  label: string;

  @ApiPropertyOptional({ description: 'Version to copy; defaults to the active version, else the latest' })
  @IsOptional()
  @ToNumber()
  @IsInt()
  sourceVersionNo?: number;
}

export class ApprovalRuleStepDto {
  @ApiProperty({ example: 1 })
  @ToNumber()
  @IsInt()
  @Min(1)
  @Max(5)
  order: number;

  @ApiPropertyOptional({ description: 'Role that decides this step; empty = anyone with Budget Approve', nullable: true })
  @IsOptional()
  @ToNumber()
  @IsInt()
  roleId?: number | null;

  @ApiProperty({ example: 'Finance manager' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(80)
  label: string;
}

export class ApprovalRuleDto {
  @ApiProperty({ description: 'Gross version amount from (inclusive)', example: 0 })
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(MAX_AMOUNT)
  minAmount: number;

  @ApiPropertyOptional({ description: 'Up to (exclusive); empty = no limit', nullable: true })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(MAX_AMOUNT)
  maxAmount?: number | null;

  @ApiProperty({ type: [ApprovalRuleStepDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => ApprovalRuleStepDto)
  steps: ApprovalRuleStepDto[];

  @ApiPropertyOptional({ default: true, description: 'The submitter may not approve, and one person may not approve two steps' })
  @IsOptional()
  @IsBoolean()
  preventSelfApproval?: boolean;
}

export class SaveApprovalRulesDto {
  @ApiProperty({ type: [ApprovalRuleDto], description: 'Replaces all rules; ranges must not overlap' })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ApprovalRuleDto)
  rules: ApprovalRuleDto[];
}

export class GetApprovalsQueryDto {
  @ApiPropertyOptional({ description: 'Only versions waiting for a step I can decide' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  mine?: boolean;

  @ApiPropertyOptional({ enum: ['in_review', 'all'], default: 'in_review' })
  @IsOptional()
  @IsIn(['in_review', 'all'])
  status?: 'in_review' | 'all';
}

export class CompareVersionsQueryDto {
  @ApiPropertyOptional({ description: 'Defaults to 1 (the original)' })
  @IsOptional()
  @ToNumber()
  @IsInt()
  baseVersionNo?: number;

  @ApiPropertyOptional({ description: 'Defaults to the active version, else the latest' })
  @IsOptional()
  @ToNumber()
  @IsInt()
  versionNo?: number;
}

export class GetBudgetAuditQueryDto {
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
