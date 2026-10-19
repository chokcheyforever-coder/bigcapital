import { BaseModel } from '@/models/Model';

export class BudgetNotification extends BaseModel {
  budgetId!: number | null;
  kind!: string;
  userId!: number;
  email!: string | null;
  subject!: string;
  body!: string;
  link!: string | null;
  status!: string;
  error!: string | null;
  sentAt!: Date | string | null;
  readAt!: Date | string | null;
  createdAt!: Date | string;

  static get tableName() {
    return 'budget_notifications';
  }
}
