import { ApiProperty } from '@nestjs/swagger';
import { applyDecorators } from '@nestjs/common';
import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';

export class EditWhtCodeDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @ApiProperty({ required: false, example: 'Rent of movable and immovable property' })
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  @ApiProperty({ required: false, example: 'ថ្លៃឈ្នួលទ្រព្យ' })
  nameKm?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  @ApiProperty({ required: false, description: 'Rate in percent', example: 10 })
  rate?: number;

  @IsOptional()
  @IsInt()
  @ApiProperty({ required: false, description: 'Liability account the tax posts to', example: 42 })
  accountId?: number;

  @IsOptional()
  @IsBoolean()
  @ApiProperty({ required: false, example: true })
  active?: boolean;
}

/** The withholding tax code of a bill or expense: omitted = the vendor's usual code, null = none. */
export const WhtCodeIdField = () =>
  applyDecorators(
    ApiProperty({ required: false, nullable: true, description: '103 DiTech: withholding tax code (omit for the vendor\'s usual code, null for none)', example: 4 }),
    ValidateIf((_, value) => value !== null && value !== undefined),
    IsInt(),
  );
