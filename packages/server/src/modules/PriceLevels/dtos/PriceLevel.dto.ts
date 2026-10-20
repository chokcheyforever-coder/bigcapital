import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
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
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsOptional, ToNumber } from '@/common/decorators/Validators';
import { parseBoolean } from '@/utils/parse-boolean';
import { PRICE_LEVEL_METHODS, PRICE_LEVEL_TYPES, PriceLevelMethod, PriceLevelType, Rounding, ROUNDINGS } from '../PriceLevels.types';

export class PriceLevelItemDto {
  @ApiProperty()
  @ToNumber()
  @IsInt()
  itemId: number;

  @ApiPropertyOptional({ description: 'Quantity from which this price applies (quantity break); default 1', example: 10 })
  @IsOptional()
  @ToNumber()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  minQuantity?: number;

  @ApiProperty({ example: 8 })
  @ToNumber()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  price: number;
}

export class CreatePriceLevelDto {
  @ApiProperty({ example: 'Wholesale' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(120)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiProperty({ enum: PRICE_LEVEL_TYPES, description: 'sales (customers) or purchase (vendors)' })
  @IsIn(PRICE_LEVEL_TYPES)
  type: PriceLevelType;

  @ApiProperty({ enum: PRICE_LEVEL_METHODS })
  @IsIn(PRICE_LEVEL_METHODS)
  method: PriceLevelMethod;

  @ApiPropertyOptional({ description: 'Percentage method: +15 marks the normal price up 15%, -10 marks it down 10%', example: -15 })
  @IsOptional()
  @ToNumber()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(-100)
  @Max(1000)
  percentage?: number | null;

  @ApiPropertyOptional({ description: 'Currency of per-item prices; empty = base currency', example: 'USD' })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  currencyCode?: string | null;

  @ApiPropertyOptional({ enum: ROUNDINGS, description: 'Rounding of percentage prices', default: 'none' })
  @IsOptional()
  @IsIn(ROUNDINGS)
  rounding?: Rounding;

  @ApiPropertyOptional({ example: '2026-11-01' })
  @IsOptional()
  @IsDateString()
  validFrom?: string | null;

  @ApiPropertyOptional({ example: '2026-11-30' })
  @IsOptional()
  @IsDateString()
  validTo?: string | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @Transform(({ value }) => parseBoolean(value, true))
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ description: 'Percentage method: only items in these categories (empty = all items)', type: [Number] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsInt({ each: true })
  categoryIds?: number[];

  @ApiPropertyOptional({ type: [PriceLevelItemDto], description: 'Per-item method: the item prices and quantity breaks (replaces all)' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => PriceLevelItemDto)
  items?: PriceLevelItemDto[];
}

export class EditPriceLevelDto extends CreatePriceLevelDto {}

export class GetPriceLevelsQueryDto {
  @ApiPropertyOptional({ enum: PRICE_LEVEL_TYPES })
  @IsOptional()
  @IsIn(PRICE_LEVEL_TYPES)
  type?: PriceLevelType;

  @ApiPropertyOptional({ description: 'true: active only (default); false: inactive only; all: both' })
  @IsOptional()
  @IsIn(['true', 'false', 'all'])
  active?: 'true' | 'false' | 'all';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;
}

export class ResolvePriceLineDto {
  @ApiProperty()
  @ToNumber()
  @IsInt()
  itemId: number;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @ToNumber()
  @IsNumber()
  @Min(0)
  quantity?: number;
}

export class ResolvePricesDto {
  @ApiPropertyOptional({ description: 'The price level to use; when left out, the contact\'s default price level' })
  @IsOptional()
  @ToNumber()
  @IsInt()
  priceLevelId?: number | null;

  @ApiPropertyOptional({ description: 'Customer or vendor whose default price level applies' })
  @IsOptional()
  @ToNumber()
  @IsInt()
  contactId?: number | null;

  @ApiProperty({ enum: PRICE_LEVEL_TYPES, description: 'sales: sell prices, purchase: cost prices' })
  @IsIn(PRICE_LEVEL_TYPES)
  type: PriceLevelType;

  @ApiPropertyOptional({ description: 'Document date (YYYY-MM-DD); default today' })
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiProperty({ type: [ResolvePriceLineDto] })
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ResolvePriceLineDto)
  lines: ResolvePriceLineDto[];
}

export class AssignPriceLevelDto {
  @ApiProperty({ type: [Number], description: 'Customers (sales level) or vendors (purchase level) to give this default price level' })
  @IsArray()
  @ArrayMaxSize(1000)
  @IsInt({ each: true })
  contactIds: number[];
}
