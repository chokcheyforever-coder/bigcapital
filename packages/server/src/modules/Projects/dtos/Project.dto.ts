import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsInt, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { IsOptional, ToNumber } from '@/common/decorators/Validators';
import { ProjectStatus } from '../Projects.types';

export class CreateProjectDto {
  @ApiProperty({ description: 'Project name', example: 'Phnom Penh office fit-out' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional({ description: 'Unique project code', example: 'PRJ-001' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  code?: string;

  @ApiPropertyOptional({ description: 'Description' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ApiPropertyOptional({ description: 'Customer the project is for', example: 1 })
  @IsOptional()
  @ToNumber()
  @IsInt()
  contactId?: number;

  @ApiPropertyOptional({ description: 'Start date', example: '2026-01-01' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'End date (deadline)', example: '2026-12-31' })
  @IsOptional()
  @IsDateString()
  deadline?: string;

  @ApiPropertyOptional({ enum: ProjectStatus, default: ProjectStatus.Active })
  @IsOptional()
  @IsIn(Object.values(ProjectStatus))
  status?: ProjectStatus;
}

export class EditProjectDto extends CreateProjectDto {}

export class GetProjectsQueryDto {
  @ApiPropertyOptional({ description: 'Search by name or code' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: ['active', 'closed', 'all'], default: 'all' })
  @IsOptional()
  @IsIn(['active', 'closed', 'all'])
  status?: 'active' | 'closed' | 'all';
}
