import { Inject, Injectable } from '@nestjs/common';
import { Knex } from 'knex';
import { SystemKnexConnection } from '../../System/SystemDB/SystemDB.constants';
import { DiTechPolicy } from '../DiTech.types';

const CACHE_TTL_MS = 30_000;

/**
 * Reads and writes ditech_policies. Lookups are cached in-process for 30 s
 * and invalidated on write (single server process per cell for now).
 */
@Injectable()
export class DiTechPolicyService {
  private readonly cache = new Map<string, { at: number; policy: DiTechPolicy | null }>();

  constructor(
    @Inject(SystemKnexConnection)
    private readonly systemKnex: Knex,
  ) {}

  async getByOrganization(organizationId: string): Promise<DiTechPolicy | null> {
    const hit = this.cache.get(organizationId);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.policy;

    const row = await this.systemKnex('ditech_policies as p')
      .join('tenants as t', 't.id', 'p.tenant_id')
      .leftJoin('tenants_metadata as m', 'm.tenant_id', 't.id')
      .where('t.organization_id', organizationId)
      .first('p.company_ref', 'p.status', 'p.pinned_host', 'p.entitlements', 'm.base_currency');
    // The system knex returns camelCase keys (see SystemDB.module.ts).
    const policy: DiTechPolicy | null = row
      ? {
          company_ref: row.companyRef,
          status: row.status,
          pinned_host: row.pinnedHost,
          entitlements: typeof row.entitlements === 'string' ? JSON.parse(row.entitlements) : row.entitlements,
          base_currency: row.baseCurrency ?? undefined,
        }
      : null;
    this.cache.set(organizationId, { at: Date.now(), policy });
    return policy;
  }

  async save(tenantId: number, organizationId: string, policy: DiTechPolicy, trx?: Knex.Transaction) {
    const row = {
      tenant_id: tenantId,
      company_ref: policy.company_ref,
      status: policy.status,
      pinned_host: policy.pinned_host,
      entitlements: JSON.stringify(policy.entitlements),
      updated_at: new Date(),
    };
    await (trx ?? this.systemKnex)('ditech_policies').insert(row).onConflict('tenant_id').merge();
    this.cache.delete(organizationId);
  }
}
