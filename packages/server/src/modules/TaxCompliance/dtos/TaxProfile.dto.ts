import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsNumber, IsString, Matches, MaxLength, Min, ValidateNested } from 'class-validator';
import { IsOptional, ToNumber } from '@/common/decorators/Validators';
import { parseBoolean } from '@/utils/parse-boolean';

export class GdtRateDto {
  @ApiProperty({ example: '2026-09' })
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  month: string;

  @ApiProperty({ example: 4105 })
  @ToNumber()
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0.000001)
  rate: number;
}

export class SaveTaxProfileDto {
  @ApiProperty({ description: 'Print Cambodian tax documents (VAT / commercial invoices, KHR amounts, Khmer labels) and check them before issue' })
  @Transform(({ value }) => parseBoolean(value, false))
  @IsBoolean()
  enabled: boolean;

  @ApiPropertyOptional({ example: 'K001-123456789' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  tin?: string | null;

  @ApiPropertyOptional({ enum: ['small', 'medium', 'large'] })
  @IsOptional()
  @IsIn(['small', 'medium', 'large'])
  taxpayerSize?: 'small' | 'medium' | 'large' | null;

  @ApiProperty()
  @Transform(({ value }) => parseBoolean(value, false))
  @IsBoolean()
  vatRegistered: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  companyNameKm?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  addressKm?: string | null;

  @ApiPropertyOptional({ description: 'English address as printed (empty = the organization address)' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  addressEn?: string | null;

  @ApiPropertyOptional({ enum: ['km_en', 'km', 'en'], default: 'km_en' })
  @IsOptional()
  @IsIn(['km_en', 'km', 'en'])
  documentLanguage?: 'km_en' | 'km' | 'en';

  @ApiPropertyOptional({ enum: ['nbc_daily', 'gdt_monthly'], default: 'nbc_daily' })
  @IsOptional()
  @IsIn(['nbc_daily', 'gdt_monthly'])
  rateSource?: 'nbc_daily' | 'gdt_monthly';

  @ApiPropertyOptional({ type: [GdtRateDto], description: 'GDT monthly USD/KHR rates; a document uses the previous month' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(240)
  @ValidateNested({ each: true })
  @Type(() => GdtRateDto)
  gdtRates?: GdtRateDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  signatoryName?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  signatoryTitle?: string | null;
}
