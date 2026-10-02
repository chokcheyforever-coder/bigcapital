import { IsOptional, IsString, Length } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

// 103 DiTech: the global interceptor turns query keys into camelCase before
// validation (from_currency -> fromCurrency), and the whitelist then dropped
// the snake_case fields, so every lookup returned base -> base = 1. The API
// still takes from_currency / to_currency.
export class ExchangeRateLatestQueryDto {
  @ApiPropertyOptional({
    name: 'from_currency',
    description: 'The source currency code (ISO 4217)',
    example: 'USD',
  })
  @IsOptional()
  @IsString()
  @Length(3, 3, { message: 'Currency code must be 3 characters (ISO 4217)' })
  fromCurrency?: string;

  @ApiPropertyOptional({
    name: 'to_currency',
    description: 'The target currency code (ISO 4217)',
    example: 'EUR',
  })
  @IsOptional()
  @IsString()
  @Length(3, 3, { message: 'Currency code must be 3 characters (ISO 4217)' })
  toCurrency?: string;
}
