import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { RedisService } from '@liaoliaots/nestjs-redis';
import type { Redis } from 'ioredis';
import { Knex } from 'knex';
import { SystemKnexConnection } from '../../System/SystemDB/SystemDB.constants';
import { DiTechPolicy } from '../DiTech.types';

const CACHE_TTL_MS = 30_000;
export const POLICY_INVALIDATE_CHANNEL = 'ditech:policy:invalidate';

/**
 * Reads and writes ditech_policies. Lookups are cached in-process for 30 s.
 * A cell runs several server processes (replicas), so a write is announced
 * on Redis and every process drops its cached copy; if a message is lost,
 * the 30 s expiry still bounds how stale a policy can be.
 */
@Injectable()
export class DiTechPolicyService implements OnModuleInit, OnModuleDestroy {
  private readonly cache = new Map<string, { at: number; policy: DiTechPolicy | null }>();
  private readonly logger = new Logger(DiTechPolicyService.name);
  private subscriber?: Redis;

  constructor(
    @Inject(SystemKnexConnection)
    private readonly systemKnex: Knex,
    private readonly redisService: RedisService,
  ) {}

  async onModuleInit() {
    try {
      this.subscriber = this.redisService.getOrThrow().duplicate();
      this.subscriber.on('message', (channel, organizationId) => {
        if (channel === POLICY_INVALIDATE_CHANNEL) this.cache.delete(organizationId);
      });
      this.subscriber.on('error', (err) => this.logger.warn(`policy invalidation subscriber: ${err.message}`));
      await this.subscriber.subscribe(POLICY_INVALIDATE_CHANNEL);
    } catch (err: any) {
      this.logger.warn(`policy invalidation unavailable, relying on the ${CACHE_TTL_MS / 1000}s expiry: ${err?.message}`);
    }
  }

  async onModuleDestroy() {
    await this.subscriber?.quit().catch(() => undefined);
  }

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
    if (trx) {
      // Announce only once committed: earlier, another process could re-read
      // the old row and cache it again.
      trx.executionPromise.then(() => this.invalidate(organizationId), () => undefined);
    } else {
      await this.invalidate(organizationId);
    }
  }

  /** Drops the cached policy here and in every other server process of the cell. */
  async invalidate(organizationId: string) {
    this.cache.delete(organizationId);
    try {
      await this.redisService.getOrThrow().publish(POLICY_INVALIDATE_CHANNEL, organizationId);
    } catch (err: any) {
      this.logger.warn(`policy invalidation not published for ${organizationId}: ${err?.message}`);
    }
  }
}
