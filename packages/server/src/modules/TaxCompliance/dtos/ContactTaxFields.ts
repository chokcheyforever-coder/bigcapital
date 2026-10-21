import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsString, MaxLength } from 'class-validator';
import { IsOptional } from '@/common/decorators/Validators';
import { parseBoolean } from '@/utils/parse-boolean';

// 103 DiTech: Cambodian tax fields of customers and vendors.
export const TaxNumberField = () =>
  applyDecorators(ApiProperty({ description: 'TIN (VATTIN)', required: false, nullable: true, example: 'K001-123456789' }), IsOptional(), IsString(), MaxLength(40));

export const RegisteredTaxpayerField = () =>
  applyDecorators(
    ApiProperty({ description: 'Registered taxpayer (gets VAT invoices)', required: false }),
    IsOptional(),
    Transform(({ value }) => parseBoolean(value, false)),
    IsBoolean(),
  );

export const KhmerNameField = () =>
  applyDecorators(ApiProperty({ description: 'Name in Khmer', required: false, nullable: true }), IsOptional(), IsString(), MaxLength(255));

export const KhmerAddressField = () =>
  applyDecorators(ApiProperty({ description: 'Billing address in Khmer', required: false, nullable: true }), IsOptional(), IsString(), MaxLength(1000));
