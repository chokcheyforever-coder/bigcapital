import { BaseModel } from '@/models/Model';
import type { ExciseTaxKind } from '@bigcapital/pdf-templates';

/**
 * A tax charged before VAT on sales lines (Specific Tax, Accommodation Tax,
 * Public Lighting Tax), with the liability account it posts to.
 */
export class ExciseTaxCode extends BaseModel {
  kind!: ExciseTaxKind;
  code!: string;
  name!: string;
  nameKm!: string | null;
  rate!: number;
  basePercent!: number;
  accountId!: number | null;
  active!: boolean;

  static get tableName() {
    return 'excise_tax_codes';
  }

  get timestamps() {
    return ['createdAt', 'updatedAt'];
  }
}
