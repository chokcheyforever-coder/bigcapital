import { Inject, Injectable } from '@nestjs/common';
import { Knex } from 'knex';
import { ServiceError } from '@/modules/Items/ServiceError';
import { TenantModelProxy } from '@/modules/System/models/TenantBaseModel';
import { Account } from '@/modules/Accounts/models/Account.model';
import { Branch } from '@/modules/Branches/models/Branch.model';
import { Project } from '@/modules/Projects/models/Project.model';
import { Budget } from '../models/Budget.model';
import { BudgetVersion } from '../models/BudgetVersion.model';
import { BUDGET_TYPE_ACCOUNT_TYPES, BudgetType, EDITABLE_STATUSES, ERRORS } from '../Budgeting.types';

const notFound = (type: string, message: string) => new ServiceError(type, message, null, 404);

@Injectable()
export class BudgetValidator {
  constructor(
    @Inject(Budget.name) private readonly budgetModel: TenantModelProxy<typeof Budget>,
    @Inject(BudgetVersion.name) private readonly versionModel: TenantModelProxy<typeof BudgetVersion>,
    @Inject(Account.name) private readonly accountModel: TenantModelProxy<typeof Account>,
    @Inject(Branch.name) private readonly branchModel: TenantModelProxy<typeof Branch>,
    @Inject(Project.name) private readonly projectModel: TenantModelProxy<typeof Project>,
  ) {}

  async getBudgetOrThrow(budgetId: number, trx?: Knex.Transaction): Promise<Budget> {
    const budget = await this.budgetModel().query(trx).modify('notDeleted').findById(budgetId);
    if (!budget) throw notFound(ERRORS.BUDGET_NOT_FOUND, 'The budget was not found.');
    return budget;
  }

  /** The version row, locked for update when inside a transaction. */
  async getVersionOrThrow(budgetId: number, versionNo: number, trx?: Knex.Transaction): Promise<BudgetVersion> {
    const query = this.versionModel().query(trx).where({ budgetId, versionNo }).first();
    if (trx) query.forUpdate();
    const version = await query;
    if (!version) throw notFound(ERRORS.VERSION_NOT_FOUND, 'The budget version was not found.');
    return version;
  }

  ensureEditable(version: BudgetVersion) {
    if (!EDITABLE_STATUSES.includes(version.status)) {
      throw new ServiceError(
        ERRORS.VERSION_NOT_EDITABLE,
        `A ${version.status} version cannot be changed; create a revision instead.`,
        { status: version.status },
        409,
      );
    }
  }

  ensureLockVersion(version: BudgetVersion, lockVersion: number) {
    if (version.lockVersion !== lockVersion) {
      throw new ServiceError(
        ERRORS.VERSION_CHANGED,
        'Someone else saved this budget since you opened it. Reload and apply your changes again.',
        { lockVersion: version.lockVersion },
        409,
      );
    }
  }

  async validateReferenceUnique(reference: string, exceptId?: number, trx?: Knex.Transaction) {
    const query = this.budgetModel().query(trx).where('reference', reference);
    if (exceptId) query.whereNot('id', exceptId);
    if (await query.first()) {
      throw new ServiceError(ERRORS.REFERENCE_EXISTS, 'Another budget already uses this reference.');
    }
  }

  async validateBranches(ids: Array<number | null | undefined>, trx?: Knex.Transaction) {
    const unique = [...new Set(ids.filter((id): id is number => !!id))];
    if (unique.length === 0) return;
    const found = await this.branchModel().query(trx).whereIn('id', unique);
    if (found.length !== unique.length) {
      throw new ServiceError(ERRORS.BRANCH_NOT_FOUND, 'The branch was not found.', {
        branchesIds: unique.filter((id) => !found.some((b) => b.id === id)),
      });
    }
  }

  async validateProjects(ids: Array<number | null | undefined>, trx?: Knex.Transaction) {
    const unique = [...new Set(ids.filter((id): id is number => !!id))];
    if (unique.length === 0) return;
    const found = await this.projectModel().query(trx).whereIn('id', unique);
    if (found.length !== unique.length) {
      throw new ServiceError(ERRORS.PROJECT_NOT_FOUND, 'The project was not found.', {
        projectsIds: unique.filter((id) => !found.some((p) => p.id === id)),
      });
    }
  }

  /** Accounts must exist and fit the budget type (e.g. no bank accounts in a P&L budget). */
  async getAccountsOrThrow(type: string, accountIds: number[], trx?: Knex.Transaction): Promise<Map<number, Account>> {
    const unique = [...new Set(accountIds)];
    const accounts = unique.length ? await this.accountModel().query(trx).whereIn('id', unique) : [];
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const missing = unique.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      throw new ServiceError(ERRORS.ACCOUNT_NOT_FOUND, 'The account was not found.', { accountsIds: missing });
    }
    const allowed = BUDGET_TYPE_ACCOUNT_TYPES[type as BudgetType] ?? [];
    const wrong = accounts.filter((a) => !allowed.includes(a.accountType));
    if (wrong.length > 0) {
      throw new ServiceError(ERRORS.ACCOUNT_NOT_ALLOWED, 'These accounts do not belong in this type of budget.', {
        accountsIds: wrong.map((a) => a.id),
        allowedAccountTypes: allowed,
      });
    }
    return byId;
  }
}
