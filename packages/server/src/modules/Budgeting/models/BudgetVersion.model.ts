import { Model } from 'objection';
import { BaseModel } from '@/models/Model';

export class BudgetVersion extends BaseModel {
  budgetId!: number;
  versionNo!: number;
  kind!: string;
  scenario!: string | null;
  label!: string | null;
  sourceVersionId!: number | null;
  revisionReason!: string | null;
  status!: string;
  submittedAt!: Date | null;
  submittedBy!: number | null;
  approvedAt!: Date | null;
  approvedBy!: number | null;
  lockedAt!: Date | null;
  lockedBy!: number | null;
  lockVersion!: number;
  submissionNo!: number;
  createdBy!: number | null;
  createdAt!: Date;
  updatedAt!: Date;

  static get tableName() {
    return 'budget_versions';
  }

  get timestamps() {
    return ['createdAt', 'updatedAt'];
  }

  static get relationMappings() {
    const { Budget } = require('./Budget.model');
    const { BudgetLine } = require('./BudgetLine.model');
    return {
      budget: {
        relation: Model.BelongsToOneRelation,
        modelClass: Budget,
        join: { from: 'budget_versions.budgetId', to: 'budgets.id' },
      },
      lines: {
        relation: Model.HasManyRelation,
        modelClass: BudgetLine,
        join: { from: 'budget_versions.id', to: 'budget_lines.versionId' },
      },
    };
  }
}
