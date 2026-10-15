import { Model } from 'objection';
import { BaseModel } from '@/models/Model';
import { ProjectStatus } from '../Projects.types';

/**
 * A project: an accounting dimension that documents and journal lines can be
 * tagged with, so income and expenses can be reported (and budgeted) per project.
 */
export class Project extends BaseModel {
  name!: string;
  code!: string | null;
  description!: string | null;
  contactId!: number | null;
  startDate!: Date | string | null;
  deadline!: Date | string | null;
  status!: string | null;
  createdAt!: Date;
  updatedAt!: Date;

  static get tableName() {
    return 'projects';
  }

  get timestamps() {
    return ['createdAt', 'updatedAt'];
  }

  /**
   * Projects created before this module (Express era) may carry other status
   * values; anything but "closed" counts as active.
   */
  get isClosed(): boolean {
    return (this.status ?? '').toLowerCase() === ProjectStatus.Closed;
  }

  static get virtualAttributes() {
    return ['isClosed'];
  }

  static get modifiers() {
    return {
      active(query) {
        query.where((q) => q.whereNull('status').orWhereRaw('LOWER(status) != ?', [ProjectStatus.Closed]));
      },
      closed(query) {
        query.whereRaw('LOWER(status) = ?', [ProjectStatus.Closed]);
      },
      search(query, term: string) {
        query.where((q) => q.where('name', 'like', `%${term}%`).orWhere('code', 'like', `%${term}%`));
      },
    };
  }

  static get relationMappings() {
    const { Customer } = require('../../Customers/models/Customer');

    return {
      customer: {
        relation: Model.BelongsToOneRelation,
        modelClass: Customer,
        join: {
          from: 'projects.contactId',
          to: 'contacts.id',
        },
      },
    };
  }
}
