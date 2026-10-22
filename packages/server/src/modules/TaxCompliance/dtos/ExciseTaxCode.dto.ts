import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class EditExciseTaxCodeDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @ApiProperty({ required: false, example: 'Specific Tax – wine and spirits' })
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  @ApiProperty({ required: false, example: 'អាករពិសេស – ស្រា' })
  nameKm?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  @ApiProperty({ required: false, description: 'Rate in percent', example: 35 })
  rate?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  @ApiProperty({ required: false, description: 'Share of the line amount taxed, in percent (20 for a reseller\'s PLT)', example: 100 })
  basePercent?: number;

  @IsOptional()
  @IsInt()
  @ApiProperty({ required: false, description: 'Liability account the tax posts to', example: 42 })
  accountId?: number;

  @IsOptional()
  @IsBoolean()
  @ApiProperty({ required: false, example: true })
  active?: boolean;
}

export class SetExciseTaxCodeItemsDto {
  @IsArray()
  @ArrayMaxSize(5000)
  @IsInt({ each: true })
  @ApiProperty({ type: [Number], description: 'Items charged this tax (replaces the current list)', example: [1, 2] })
  itemIds!: number[];
}
