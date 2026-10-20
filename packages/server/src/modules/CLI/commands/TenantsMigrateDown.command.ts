import { Command, Option } from 'nest-commander';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PromisePool } from '@supercharge/promise-pool';
import { BaseCommand } from './BaseCommand';

interface TenantsMigrateDownOptions {
  to?: string;
  tenant_id?: string;
  dry_run?: boolean;
}

/** The 14-digit timestamp a migration name starts with. */
const stamp = (name: string) => name.slice(0, 14);

/**
 * DiTech: undoes, newest first, every tenant migration newer than `--to`, and
 * nothing else. Unlike tenants:migrate:rollback (last batch), this is safe for
 * companies created after a migration was added: their first batch holds the
 * whole schema, which a batch rollback would drop.
 *
 *   node dist/cli.js tenants:migrate:down --to 20261015999999 [--dry_run]
 *
 * Data in the tables or columns a migration removes is lost: restore the
 * backup taken before the deploy to get it back.
 */
@Injectable()
@Command({
  name: 'tenants:migrate:down',
  description: 'Undo the tenant migrations newer than --to (a migration timestamp), newest first.',
})
export class TenantsMigrateDownCommand extends BaseCommand {
  private readonly MIGRATION_CONCURRENCY = 5;

  constructor(configService: ConfigService) {
    super(configService);
  }

  @Option({ flags: '--to <timestamp>', description: 'Keep migrations up to and including this 14-digit timestamp.' })
  parseTo(val: string): string {
    return val;
  }

  @Option({ flags: '-t, --tenant_id [tenant_id]', description: 'Only this organization.' })
  parseTenantId(val: string): string {
    return val;
  }

  @Option({ flags: '--dry_run', description: 'List what would be undone; change nothing.' })
  parseDryRun(): boolean {
    return true;
  }

  async run(_params: string[], options: TenantsMigrateDownOptions): Promise<void> {
    if (!options.to || !/^\d{14}$/.test(options.to)) {
      this.exit('--to must be a 14-digit migration timestamp, e.g. 20261015999999.');
    }
    const sysKnex = this.initSystemKnex();
    const tenants = await this.getAllInitializedTenants(sysKnex);
    const ids: string[] = tenants.map((t: any) => t.organizationId);
    if (options.tenant_id && !ids.includes(options.tenant_id)) {
      this.exit(`The given tenant id ${options.tenant_id} does not exist.`);
    }
    const targets = options.tenant_id ? [options.tenant_id] : ids;
    let failed = 0;

    await PromisePool.withConcurrency(this.MIGRATION_CONCURRENCY)
      .for(targets)
      .process(async (organizationId: string) => {
        const knex = this.initTenantKnex(organizationId);
        const db = `${this.configService.get('tenantDatabase.dbNamePrefix')}${organizationId}`;
        try {
          const [completed] = await knex.migrate.list();
          const names: string[] = completed.map((m: any) => (typeof m === 'string' ? m : m.name));
          const undo = names.filter((n) => stamp(n) > options.to!).sort().reverse();
          if (options.dry_run) {
            this.log(`Tenant: ${db} > would undo ${undo.length}: ${undo.join(', ') || '-'}`);
            return;
          }
          for (const name of undo) {
            await knex.migrate.down({ name });
          }
          this.log(`Tenant: ${db} > undone ${undo.length}: ${undo.join(', ') || '-'}`);
        } catch (error) {
          failed++;
          console.error(`Tenant: ${db} > FAILED: ${(error as Error).message}`);
        } finally {
          await knex.destroy();
        }
      });

    if (failed > 0) this.exit(`${failed} tenant(s) failed.`);
    this.success(options.dry_run ? 'Dry run done.' : 'All tenants are at the target migration.');
  }
}
