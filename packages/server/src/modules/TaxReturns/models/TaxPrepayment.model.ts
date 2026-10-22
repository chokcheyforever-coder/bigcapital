import { BaseModel } from '@/models/Model';

/** The 1% prepayment of tax on income posted for a month. */
export class TaxPrepayment extends BaseModel {
  month!: string;
  turnover!: number;
  rate!: number;
  amount!: number;
  manualJournalId!: number | null;

  static get tableName() {
    return 'tax_prepayments';
  }

  get timestamps() {
    return ['createdAt', 'updatedAt'];
  }
}
