import { Inject, Injectable } from '@nestjs/common';
import { Knex } from 'knex';
import { ServiceError } from '@/modules/Items/ServiceError';
import { TenantModelProxy } from '@/modules/System/models/TenantBaseModel';
import { Customer } from '@/modules/Customers/models/Customer';
import { TENANCY_DB_CONNECTION } from '@/modules/Tenancy/TenancyDB/TenancyDB.constants';
import { Project } from '../models/Project.model';
import { ERRORS } from '../Projects.types';

/** Tables whose rows can point at a project (all columns are `project_id`). */
export const PROJECT_USAGE_TABLES = [
  'accounts_transactions',
  'sales_invoices',
  'sales_receipts',
  'credit_notes',
  'bills',
  'vendor_credits',
  'expense_transaction_categories',
  'manual_journals_entries',
];

@Injectable()
export class ProjectValidator {
  constructor(
    @Inject(Project.name)
    private readonly projectModel: TenantModelProxy<typeof Project>,

    @Inject(Customer.name)
    private readonly customerModel: TenantModelProxy<typeof Customer>,

    @Inject(TENANCY_DB_CONNECTION)
    private readonly tenantKnex: () => Knex,
  ) {}

  async getOrThrow(projectId: number, trx?: Knex.Transaction): Promise<Project> {
    const project = await this.projectModel().query(trx).findById(projectId);
    if (!project) {
      throw new ServiceError(ERRORS.PROJECT_NOT_FOUND, 'The project was not found.', null, 404);
    }
    return project;
  }

  async validateCodeUnique(code: string | undefined | null, exceptId?: number, trx?: Knex.Transaction) {
    if (!code) return;
    const query = this.projectModel().query(trx).where('code', code);
    if (exceptId) query.whereNot('id', exceptId);
    if (await query.first()) {
      throw new ServiceError(ERRORS.PROJECT_CODE_EXISTS, 'Another project already uses this code.');
    }
  }

  async validateCustomer(contactId: number | undefined | null, trx?: Knex.Transaction) {
    if (!contactId) return;
    const customer = await this.customerModel()
      .query(trx)
      .findById(contactId)
      .where('contactService', 'customer');
    if (!customer) {
      throw new ServiceError(ERRORS.CUSTOMER_NOT_FOUND, 'The customer was not found.');
    }
  }

  /**
   * A document or journal line may only use an existing, active project.
   * Editing a document that already uses a project that was closed since is
   * still allowed, so closing a project never blocks fixing its old documents.
   */
  async validateTransactionProjects(
    projectsIds: Array<number | null | undefined>,
    allowedClosedIds: Array<number | null | undefined> = [],
    trx?: Knex.Transaction,
  ) {
    const ids = [...new Set(projectsIds.filter((id): id is number => !!id))];
    if (ids.length === 0) return;

    const projects = await this.projectModel().query(trx).whereIn('id', ids);
    const found = new Map(projects.map((p) => [p.id, p]));
    const missing = ids.filter((id) => !found.has(id));
    if (missing.length > 0) {
      throw new ServiceError(ERRORS.PROJECT_NOT_FOUND, 'The project was not found.', { projectsIds: missing });
    }
    const closed = projects.filter((p) => p.isClosed && !allowedClosedIds.includes(p.id));
    if (closed.length > 0) {
      throw new ServiceError(ERRORS.PROJECT_CLOSED, 'The project is closed.', { projectsIds: closed.map((p) => p.id) });
    }
  }

  async validateNotUsed(projectId: number, trx?: Knex.Transaction) {
    const knex = trx ?? this.tenantKnex();
    for (const table of PROJECT_USAGE_TABLES) {
      const row = await knex(table).where('project_id', projectId).first('id');
      if (row) {
        throw new ServiceError(ERRORS.PROJECT_HAS_TRANSACTIONS, 'The project is used by transactions; close it instead of deleting it.');
      }
    }
  }
}
