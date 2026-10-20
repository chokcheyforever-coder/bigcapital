import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { IsInt } from 'class-validator';
import { IsOptional, ToNumber } from '@/common/decorators/Validators';

/** The `priceLevelId` of a customer, vendor or sales/purchase document (DiTech price levels). */
export const PriceLevelIdField = () =>
  applyDecorators(
    ApiProperty({ description: 'Price level (DiTech); null clears it', required: false, nullable: true, example: 1 }),
    IsOptional(),
    ToNumber(),
    IsInt(),
  );
