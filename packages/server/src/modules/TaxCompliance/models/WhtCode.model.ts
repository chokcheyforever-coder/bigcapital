import { BaseModel } from '@/models/Model';

export type WhtPaymentType = 'service' | 'rent' | 'interest' | 'royalty' | 'non_resident' | 'other';

/** A withholding tax rate by payment type, with the liability account it posts to. */
export class WhtCode extends BaseModel {
  code!: string;
  name!: string;
  nameKm!: string | null;
  paymentType!: WhtPaymentType;
  rate!: number;
  accountId!: number | null;
  active!: boolean;

  static get tableName() {
    return 'wht_codes';
  }

  get timestamps() {
    return ['createdAt', 'updatedAt'];
  }
}
