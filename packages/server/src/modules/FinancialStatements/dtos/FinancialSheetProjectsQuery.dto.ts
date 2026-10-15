import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsArray, IsInt, IsOptional } from 'class-validator';
import { castArray } from 'lodash';
import { FinancialSheetBranchesQueryDto } from './FinancialSheetBranchesQuery.dto';

/** Branches plus projects: for the reports built from the ledger's project dimension. */
export class FinancialSheetProjectsQueryDto extends FinancialSheetBranchesQueryDto {
  // A single id arrives as a plain string (`projectsIds=5`), several as an array.
  @Transform(({ value }) =>
    value === undefined || value === null || value === ''
      ? undefined
      : castArray(value).filter((v) => v !== '').map(Number),
  )
  @IsArray()
  @IsInt({ each: true })
  @IsOptional()
  @ApiProperty({
    description: 'Filter by projects (only ledger rows tagged with one of them)',
    required: false,
    type: [Number],
  })
  projectsIds: Array<number>;
}
