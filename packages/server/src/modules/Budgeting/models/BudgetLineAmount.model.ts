import { BaseModel } from '@/models/Model';

export class BudgetLineAmount extends BaseModel {
  lineId!: number;
  month!: Date | string;
  /** decimal(13,3); the driver may return it as a string. */
  amount!: number | string;

  static get tableName() {
    return 'budget_line_amounts';
  }

  static get idColumn() {
    return ['lineId', 'month'];
  }
}
