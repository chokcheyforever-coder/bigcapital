import { Inject, Injectable } from '@nestjs/common';
import { Knex } from 'knex';
import * as moment from 'moment';
import { TenantModelProxy } from '@/modules/System/models/TenantBaseModel';
import { AuditLogService } from '@/modules/AuditLogs/AuditLog.service';
import { AbilitySubject } from '@/modules/Roles/Roles.types';
import { ExchangeRate } from '@/modules/ExchangeRates/lib/ExchangeRate';
import { ExchangeRateServiceType } from '@/modules/ExchangeRates/lib/types';
import { TaxProfile } from './models/TaxProfile.model';
import { SaveTaxProfileDto } from './dtos/TaxProfile.dto';
import { DocumentLanguage, gdtRateFor, RateSource, SellerProfile, TaxpayerSize } from './calc/compliance';

export interface TaxProfileView extends SellerProfile {
  companyNameKm: string | null;
  addressKm: string | null;
  addressEn: string | null;
  documentLanguage: DocumentLanguage;
  rateSource: RateSource;
  gdtRates: Array<{ month: string; rate: number }>;
  signatoryName: string | null;
  signatoryTitle: string | null;
  updatedAt: Date | null;
}

const DEFAULTS: TaxProfileView = {
  enabled: false,
  tin: null,
  taxpayerSize: null,
  vatRegistered: false,
  companyNameKm: null,
  addressKm: null,
  addressEn: null,
  documentLanguage: 'km_en',
  rateSource: 'nbc_daily',
  gdtRates: [],
  signatoryName: null,
  signatoryTitle: null,
  updatedAt: null,
};

@Injectable()
export class TaxProfileService {
  constructor(
    private readonly auditLog: AuditLogService,

    @Inject(TaxProfile.name)
    private readonly taxProfileModel: TenantModelProxy<typeof TaxProfile>,
  ) {}

  async get(trx?: Knex.Transaction): Promise<TaxProfileView> {
    const row = await this.taxProfileModel().query(trx).findById(1);
    if (!row) return { ...DEFAULTS };
    let gdtRates: Array<{ month: string; rate: number }> = [];
    try {
      gdtRates = row.gdtRates ? JSON.parse(row.gdtRates) : [];
    } catch {
      gdtRates = [];
    }
    return {
      enabled: !!row.enabled,
      tin: row.tin,
      taxpayerSize: (row.taxpayerSize as TaxpayerSize) ?? null,
      vatRegistered: !!row.vatRegistered,
      companyNameKm: row.companyNameKm,
      addressKm: row.addressKm,
      addressEn: row.addressEn,
      documentLanguage: (row.documentLanguage as DocumentLanguage) ?? 'km_en',
      rateSource: (row.rateSource as RateSource) ?? 'nbc_daily',
      gdtRates,
      signatoryName: row.signatoryName,
      signatoryTitle: row.signatoryTitle,
      updatedAt: row.updatedAt,
    };
  }

  async save(dto: SaveTaxProfileDto): Promise<TaxProfileView> {
    const before = await this.get();
    const months = new Set<string>();
    const gdtRates = (dto.gdtRates ?? before.gdtRates)
      .filter((r) => !months.has(r.month) && months.add(r.month))
      .sort((a, b) => a.month.localeCompare(b.month));
    const data = {
      enabled: dto.enabled,
      tin: dto.tin?.trim() || null,
      taxpayerSize: dto.taxpayerSize ?? null,
      vatRegistered: dto.vatRegistered,
      companyNameKm: dto.companyNameKm?.trim() || null,
      addressKm: dto.addressKm?.trim() || null,
      addressEn: dto.addressEn?.trim() || null,
      documentLanguage: dto.documentLanguage ?? 'km_en',
      rateSource: dto.rateSource ?? 'nbc_daily',
      gdtRates: JSON.stringify(gdtRates.map((r) => ({ month: r.month, rate: Number(r.rate) }))),
      signatoryName: dto.signatoryName?.trim() || null,
      signatoryTitle: dto.signatoryTitle?.trim() || null,
      updatedAt: moment().toDate(),
    };
    const exists = await this.taxProfileModel().query().findById(1);
    if (exists) await this.taxProfileModel().query().patchAndFetchById(1, data);
    else await this.taxProfileModel().query().insert({ id: 1, ...data });
    await this.auditLog.record({ action: 'edited', subject: AbilitySubject.Preferences, subjectId: 1, metadata: { taxProfile: { before, after: data } } });
    return this.get();
  }

  /**
   * The USD (or other currency) to riel rate for a document dated `date`:
   * the GDT monthly rate of the previous month, or today's NBC daily rate.
   */
  async khrRate(currency: string, date: string, profile: TaxProfileView): Promise<{ rate: number; source: RateSource; date: string } | null> {
    if (!currency || currency.toUpperCase() === 'KHR') return null;
    if (profile.rateSource === 'gdt_monthly') {
      // GDT publishes the USD rate; other currencies need the NBC rate.
      if (currency.toUpperCase() === 'USD') {
        const rate = gdtRateFor(date, profile.gdtRates);
        return rate ? { rate, source: 'gdt_monthly', date } : null;
      }
    }
    try {
      const rate = await new ExchangeRate(ExchangeRateServiceType.MefCambodia).latest(currency.toUpperCase(), 'KHR');
      return rate > 0 ? { rate, source: 'nbc_daily', date: moment().format('YYYY-MM-DD') } : null;
    } catch {
      return null;
    }
  }
}
