import { Model } from 'objection';
import { BaseModel } from '@/models/Model';

export class Budget extends BaseModel {
  reference!: string;
  name!: string;
  type!: string;
  fiscalYear!: number;
  startDate!: Date | string;
  endDate!: Date | string;
  currencyCode!: string;
  branchId!: number | null;
  projectId!: number | null;
  ownerUserId!: number | null;
  description!: string | null;
  notes!: string | null;
  activeVersionId!: number | null;
  createdBy!: number | null;
  createdAt!: Date;
  updatedAt!: Date;
  deletedAt!: Date | null;

  static get tableName() {
    return 'budgets';
  }

  get timestamps() {
    return ['createdAt', 'updatedAt'];
  }

  static get modifiers() {
    return {
      notDeleted(query) {
        query.whereNull('budgets.deletedAt');
      },
    };
  }

  static get relationMappings() {
    const { BudgetVersion } = require('./BudgetVersion.model');
    return {
      versions: {
        relation: Model.HasManyRelation,
        modelClass: BudgetVersion,
        join: { from: 'budgets.id', to: 'budget_versions.budgetId' },
      },
    };
  }
}
