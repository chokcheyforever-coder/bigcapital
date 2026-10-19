import { BaseModel } from '@/models/Model';

export class BudgetControlPolicy extends BaseModel {
  /** null = the company default. */
  budgetId!: number | null;
  mode!: string;
  /** JSON text: [75, 90]. */
  thresholds!: string;
  periodBasis!: string;
  /** JSON text: ["bill", "expense", "manual_journal"]. */
  transactionTypes!: string;
  createdAt!: Date;
  updatedAt!: Date;

  static get tableName() {
    return 'budget_control_policies';
  }

  get timestamps() {
    return ['createdAt', 'updatedAt'];
  }
}
