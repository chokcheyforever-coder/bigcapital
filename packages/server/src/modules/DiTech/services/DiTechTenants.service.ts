import { randomBytes } from 'crypto';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Knex } from 'knex';
import { ConfigService } from '@nestjs/config';
import { sanitizeDatabaseName } from '@/utils/sanitize-database-name';
import * as moment from 'moment';
import { SystemKnexConnection } from '../../System/SystemDB/SystemDB.constants';
import { TenantRepository } from '../../System/repositories/Tenant.repository';
import { hashPassword } from '../../Auth/Auth.utils';
import {
  OrganizationBuildQueue,
  OrganizationBuildQueueJob,
  OrganizationBuildQueueJobPayload,
} from '../../Organization/Organization.types';
import { transformBuildDto } from '../../Organization/Organization.utils';
import { DeleteWorkspaceQueue } from '../../ee/Workspaces/Workspaces.types';
import { DiTechPolicy } from '../DiTech.types';
import { DiTechPolicyService } from './DiTechPolicy.service';

export interface CreateTenantInput {
  owner: { email: string; first_name: string; last_name: string };
  organization: {
    name: string;
    location: string;
    base_currency: string;
    timezone: string;
    fiscal_year: string;
    language: string;
    date_format?: string;
  };
  policy: DiTechPolicy;
}

export interface TenantState {
  organization_id: string;
  tenant_id: number;
  owner_user_id: number;
  build_status: 'pending' | 'building' | 'built';
  build_job_id: string | null;
  built_at: string | null;
}

// Note: the system knex maps identifiers (see SystemDB.module.ts), so result
// rows come back camelCase (built_at -> builtAt) while queries may use snake_case.

/**
 * Provisioning operations for the control plane. Reuses BigCapital's own
 * tenant creation, organization build queue and workspace deletion job.
 */
@Injectable()
export class DiTechTenantsService {
  constructor(
    @Inject(SystemKnexConnection)
    private readonly systemKnex: Knex,
    private readonly config: ConfigService,
    private readonly tenantRepository: TenantRepository,
    private readonly policies: DiTechPolicyService,
    @InjectQueue(OrganizationBuildQueue)
    private readonly buildQueue: Queue,
    @InjectQueue(DeleteWorkspaceQueue)
    private readonly deleteQueue: Queue,
  ) {}

  /**
   * Creates (or links) the owner user, the tenant, its metadata and policy,
   * then queues the organization build. Replaying the same idempotency key
   * returns the existing tenant instead of creating another.
   */
  async create(idempotencyKey: string, input: CreateTenantInput): Promise<{ state: TenantState; replay: boolean }> {
    const existing = await this.systemKnex('ditech_idempotency').where('key', idempotencyKey).first();
    if (existing) {
      const response = typeof existing.response === 'string' ? JSON.parse(existing.response) : existing.response;
      const organization_id = response.organization_id ?? response.organizationId;
      return { state: await this.state(organization_id), replay: true };
    }

    const email = input.owner.email.toLowerCase();
    let organizationId: string;
    try {
      organizationId = await this.systemKnex.transaction(async (trx) => {
        const tenant = await this.tenantRepository.createWithUniqueOrgId(undefined, trx);

        let user = await trx('users').where('email', email).first();
        if (!user) {
          // The owner signs in through 103 DiTech SSO, or sets a password
          // with BigCapital's "forgot password"; this one is never shown.
          const [id] = await trx('users').insert({
            first_name: input.owner.first_name,
            last_name: input.owner.last_name,
            email,
            password: await hashPassword(randomBytes(32).toString('hex')),
            verified: true,
            active: true,
            tenant_id: tenant.id,
            invite_accepted_at: moment().format('YYYY-MM-DD'),
            created_at: new Date(),
          });
          user = { id };
        }
        await trx('user_tenants').insert({
          user_id: user.id,
          tenant_id: tenant.id,
          role: 'owner',
          created_at: new Date(),
          updated_at: new Date(),
        });
        await this.tenantRepository.saveMetadata(
          tenant.id,
          transformBuildDto({
            name: input.organization.name,
            location: input.organization.location,
            baseCurrency: input.organization.base_currency,
            timezone: input.organization.timezone,
            fiscalYear: input.organization.fiscal_year,
            language: input.organization.language,
            dateFormat: input.organization.date_format,
          } as any),
          trx,
        );
        await this.policies.save(tenant.id, tenant.organizationId, input.policy, trx);
        await trx('ditech_idempotency').insert({
          key: idempotencyKey,
          tenant_id: tenant.id,
          response: JSON.stringify({ organization_id: tenant.organizationId }),
        });
        return tenant.organizationId;
      });
    } catch (err: any) {
      // A concurrent request with the same key won the insert race; its
      // committed record makes the retry return that tenant.
      if (err?.code === 'ER_DUP_ENTRY' && (await this.systemKnex('ditech_idempotency').where('key', idempotencyKey).first())) {
        return this.create(idempotencyKey, input);
      }
      throw err;
    }

    await this.enqueueBuild(organizationId);
    return { state: await this.state(organizationId), replay: false };
  }

  async state(organizationId: string): Promise<TenantState> {
    const tenant = await this.systemKnex('tenants').where('organization_id', organizationId).first();
    if (!tenant) throw new NotFoundException('Unknown organization.');
    const owner = await this.systemKnex('user_tenants')
      .where({ tenant_id: tenant.id, role: 'owner' })
      .orderBy('id', 'asc')
      .first();
    return {
      organization_id: organizationId,
      tenant_id: tenant.id,
      owner_user_id: owner?.userId,
      build_status: tenant.builtAt ? 'built' : tenant.buildJobId ? 'building' : 'pending',
      build_job_id: tenant.buildJobId ?? null,
      built_at: tenant.builtAt ? new Date(tenant.builtAt).toISOString() : null,
    };
  }

  /** Queues the build if it isn't built or already running. Safe to call repeatedly. */
  async enqueueBuild(organizationId: string): Promise<TenantState> {
    const state = await this.state(organizationId);
    if (state.build_status !== 'pending') return state;

    const metadata = await this.systemKnex('tenants_metadata').where('tenant_id', state.tenant_id).first();
    await this.buildQueue.add(
      OrganizationBuildQueueJob,
      {
        organizationId,
        userId: state.owner_user_id,
        buildDto: {
          name: metadata.name,
          location: metadata.location,
          baseCurrency: metadata.baseCurrency,
          timezone: metadata.timezone,
          fiscalYear: metadata.fiscalYear,
          language: metadata.language,
          dateFormat: metadata.dateFormat,
        },
      } as OrganizationBuildQueueJobPayload,
      // One build job per organization, even if called concurrently.
      { jobId: `ditech-build-${organizationId}` },
    );
    return this.state(organizationId);
  }

  async updatePolicy(organizationId: string, policy: DiTechPolicy) {
    const state = await this.state(organizationId);
    await this.policies.save(state.tenant_id, organizationId, policy);
    return policy;
  }

  async usage(organizationId: string) {
    const state = await this.state(organizationId);
    if (state.build_status !== 'built') return { users_active: 0, users_invited: 0, storage_bytes: 0 };
    const database = sanitizeDatabaseName(`${this.config.get('tenantDatabase.dbNamePrefix')}${organizationId}`);
    const [[users], [storage]] = await Promise.all([
      this.systemKnex.raw(
        `SELECT SUM(ACTIVE = 1 AND INVITE_ACCEPTED_AT IS NOT NULL) AS active, SUM(ACTIVE = 1 AND INVITE_ACCEPTED_AT IS NULL) AS invited FROM \`${database}\`.USERS`,
      ),
      this.systemKnex.raw(`SELECT COALESCE(SUM(SIZE), 0) AS bytes FROM \`${database}\`.DOCUMENTS`),
    ]);
    return {
      users_active: Number(users[0]?.active ?? 0),
      users_invited: Number(users[0]?.invited ?? 0),
      storage_bytes: Number(storage[0]?.bytes ?? 0),
    };
  }

  /** Queues BigCapital's workspace deletion (drops the tenant DB and tenant row). */
  async delete(organizationId: string) {
    const state = await this.state(organizationId);
    const tenant = await this.systemKnex('tenants').where('id', state.tenant_id).first();
    if (tenant.isDeleting) return { organization_id: organizationId, status: 'deleting' };
    if (!state.owner_user_id) throw new ConflictException('Tenant has no owner.');
    await this.systemKnex('tenants').where('id', state.tenant_id).update({ is_deleting: true });
    await this.deleteQueue.add('delete-workspace', {
      organizationId,
      userId: state.owner_user_id,
    });
    return { organization_id: organizationId, status: 'deleting' };
  }
}
