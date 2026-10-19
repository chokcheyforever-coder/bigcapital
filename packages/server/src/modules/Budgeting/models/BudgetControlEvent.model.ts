import { BaseModel } from '@/models/Model';

export class BudgetControlEvent extends BaseModel {
  budgetId!: number;
  versionId!: number;
  lineId!: number;
  accountId!: number;
  referenceType!: string;
  referenceId!: number;
  periodFrom!: Date | string;
  periodTo!: Date | string;
  budgetAmount!: number | string;
  usedBefore!: number | string;
  documentAmount!: number | string;
  percentAfter!: number | string | null;
  level!: string;
  mode!: string;
  outcome!: string;
  createdBy!: number | null;
  createdAt!: Date | string;

  static get tableName() {
    return 'budget_control_events';
  }
}
