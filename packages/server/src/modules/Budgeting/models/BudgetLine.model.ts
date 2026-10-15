import { Model } from 'objection';
import { BaseModel } from '@/models/Model';

export class BudgetLine extends BaseModel {
  versionId!: number;
  accountId!: number;
  branchId!: number | null;
  projectId!: number | null;
  branchKey!: number;
  projectKey!: number;
  note!: string | null;
  assumption!: string | null;
  createdAt!: Date;
  updatedAt!: Date;

  static get tableName() {
    return 'budget_lines';
  }

  get timestamps() {
    return ['createdAt', 'updatedAt'];
  }

  static get relationMappings() {
    const { BudgetLineAmount } = require('./BudgetLineAmount.model');
    const { Account } = require('../../Accounts/models/Account.model');
    return {
      amounts: {
        relation: Model.HasManyRelation,
        modelClass: BudgetLineAmount,
        join: { from: 'budget_lines.id', to: 'budget_line_amounts.lineId' },
      },
      account: {
        relation: Model.BelongsToOneRelation,
        modelClass: Account,
        join: { from: 'budget_lines.accountId', to: 'accounts.id' },
      },
    };
  }
}
