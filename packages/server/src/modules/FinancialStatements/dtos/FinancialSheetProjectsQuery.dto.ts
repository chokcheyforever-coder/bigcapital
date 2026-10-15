import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsOptional } from 'class-validator';
import { FinancialSheetBranchesQueryDto } from './FinancialSheetBranchesQuery.dto';

/** Branches plus projects: for the reports built from the ledger's project dimension. */
export class FinancialSheetProjectsQueryDto extends FinancialSheetBranchesQueryDto {
  @IsArray()
  @IsOptional()
  @ApiProperty({
    description: 'Filter by projects (only ledger rows tagged with one of them)',
    required: false,
    type: [Number],
  })
  projectsIds: Array<number>;
}
