import { BaseModel } from '@/models/Model';

export class BudgetOverride extends BaseModel {
  budgetId!: number;
  versionId!: number;
  lineId!: number;
  accountId!: number;
  referenceType!: string;
  referenceId!: number;
  periodFrom!: Date | string;
  periodTo!: Date | string;
  amount!: number | string;
  reason!: string | null;
  status!: string;
  requestedBy!: number | null;
  decidedBy!: number | null;
  decidedAt!: Date | null;
  comment!: string | null;
  createdAt!: Date;
  updatedAt!: Date;

  static get tableName() {
    return 'budget_overrides';
  }

  get timestamps() {
    return ['createdAt', 'updatedAt'];
  }
}
