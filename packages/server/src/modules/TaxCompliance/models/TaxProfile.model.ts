import { BaseModel } from '@/models/Model';

/** The company's tax profile for Cambodian tax documents (a single row, id 1). */
export class TaxProfile extends BaseModel {
  enabled!: boolean;
  tin!: string | null;
  taxpayerSize!: string | null;
  vatRegistered!: boolean;
  companyNameKm!: string | null;
  addressKm!: string | null;
  addressEn!: string | null;
  documentLanguage!: string;
  rateSource!: string;
  gdtRates!: string | null;
  signatoryName!: string | null;
  signatoryTitle!: string | null;
  updatedAt!: Date | null;

  static get tableName() {
    return 'tax_profile';
  }
}
