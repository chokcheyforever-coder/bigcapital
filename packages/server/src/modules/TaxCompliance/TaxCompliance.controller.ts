import { Body, Controller, Get, Put, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import * as moment from 'moment';
import { ApiCommonHeaders } from '@/common/decorators/ApiCommonHeaders';
import { RequirePermission } from '@/modules/Roles/RequirePermission.decorator';
import { PermissionGuard } from '@/modules/Roles/Permission.guard';
import { AuthorizationGuard } from '@/modules/Roles/Authorization.guard';
import { AbilitySubject } from '@/modules/Roles/Roles.types';
import { PreferencesAction } from '@/modules/Settings/Settings.types';
import { SaveTaxProfileDto } from './dtos/TaxProfile.dto';
import { TaxProfileService } from './TaxProfile.service';

@Controller('tax-compliance')
@ApiTags('Tax compliance')
@ApiCommonHeaders()
@UseGuards(AuthorizationGuard, PermissionGuard)
export class TaxComplianceController {
  constructor(private readonly profiles: TaxProfileService) {}

  /** Anyone preparing documents needs to know whether tax documents are on. */
  @Get('profile')
  @ApiOperation({ summary: 'Retrieves the company tax profile (Cambodian tax documents).' })
  getProfile() {
    return this.profiles.get();
  }

  @Put('profile')
  @RequirePermission(PreferencesAction.Mutate, AbilitySubject.Preferences)
  @ApiOperation({ summary: 'Saves the company tax profile.' })
  saveProfile(@Body() dto: SaveTaxProfileDto) {
    return this.profiles.save(dto);
  }

  @Get('khr-rate')
  @ApiQuery({ name: 'currency', required: false, example: 'USD' })
  @ApiQuery({ name: 'date', required: false, example: '2026-10-21' })
  @ApiOperation({ summary: 'The riel rate a document of this currency and date would print.' })
  async khrRate(@Query('currency') currency?: string, @Query('date') date?: string) {
    const profile = await this.profiles.get();
    const day = /^\d{4}-\d{2}-\d{2}$/.test(date ?? '') ? date! : moment().format('YYYY-MM-DD');
    return (await this.profiles.khrRate(currency || 'USD', day, profile)) ?? { rate: null };
  }
}
