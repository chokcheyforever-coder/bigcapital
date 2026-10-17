import { BaseModel } from '@/models/Model';

export class BudgetApprovalRule extends BaseModel {
  minAmount!: number | string;
  maxAmount!: number | string | null;
  /** JSON text: [{ order, roleId, label }]. */
  steps!: string;
  preventSelfApproval!: boolean;
  createdAt!: Date;
  updatedAt!: Date;

  static get tableName() {
    return 'budget_approval_rules';
  }

  get timestamps() {
    return ['createdAt', 'updatedAt'];
  }
}
