import { BaseModel } from '@/models/Model';

export class BudgetApprovalStep extends BaseModel {
  versionId!: number;
  submissionNo!: number;
  stepOrder!: number;
  label!: string;
  roleId!: number | null;
  assignedUserId!: number | null;
  delegatedFromUserId!: number | null;
  preventSelfApproval!: boolean;
  decision!: string;
  comment!: string | null;
  decidedBy!: number | null;
  decidedAt!: Date | null;
  createdAt!: Date;
  updatedAt!: Date;

  static get tableName() {
    return 'budget_approval_steps';
  }

  get timestamps() {
    return ['createdAt', 'updatedAt'];
  }
}
