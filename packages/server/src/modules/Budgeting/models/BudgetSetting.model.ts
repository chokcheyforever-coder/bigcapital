import { BaseModel } from '@/models/Model';

export class BudgetSetting extends BaseModel {
  key!: string;
  value!: string;
  updatedAt!: Date | string;

  static get tableName() {
    return 'budget_settings';
  }

  static get idColumn() {
    return 'key';
  }
}
