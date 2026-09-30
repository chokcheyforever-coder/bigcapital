import knex, { Knex } from 'knex';
import * as LRUCache from 'lru-cache';
import { Global, Module } from '@nestjs/common';
import { knexSnakeCaseMappers } from 'objection';
import { ClsModule, ClsService } from 'nestjs-cls';
import { ConfigService } from '@nestjs/config';
import { TENANCY_DB_CONNECTION } from './TenancyDB.constants';
import { UnitOfWork } from './UnitOfWork.service';
import { sanitizeDatabaseName } from '@/utils/sanitize-database-name';

// Bounded: every cached knex instance holds its own connection pool. Evicted
// instances are destroyed so their connections are released.
const lruCache = new LRUCache<string, Knex>({
  max: Number(process.env.TENANT_DB_CACHE_MAX || 100),
  dispose: (_key, instance) => {
    instance.destroy().catch(() => undefined);
  },
});

export const TenancyDatabaseProxyProvider = ClsModule.forFeatureAsync({
  provide: TENANCY_DB_CONNECTION,
  global: true,
  strict: true,
  inject: [ConfigService, ClsService],
  useFactory: async (configService: ConfigService, cls: ClsService) => () => {
    const organizationId = cls.get('organizationId');
    const database = sanitizeDatabaseName(
      `${configService.get('tenantDatabase.dbNamePrefix')}${organizationId}`,
    );
    const cachedInstance = lruCache.get(database);

    if (cachedInstance) {
      return cachedInstance;
    }
    const knexInstance = knex({
      client: configService.get('tenantDatabase.client'),
      connection: {
        host: configService.get('tenantDatabase.host'),
        port: configService.get('tenantDatabase.port'),
        user: configService.get('tenantDatabase.user'),
        password: configService.get('tenantDatabase.password'),
        database,
        charset: 'utf8',
      },
      migrations: {
        directory: configService.get('tenantDatabase.migrationsDir'),
        loadExtensions: ['.js'],
      },
      seeds: {
        directory: configService.get('tenantDatabase.seedsDir'),
      },
      pool: { min: 0, max: 7 },
      ...knexSnakeCaseMappers({ upperCase: true }),
    });
    lruCache.set(database, knexInstance);

    return knexInstance;
  },
  type: 'function',
});

@Global()
@Module({
  imports: [TenancyDatabaseProxyProvider],
  providers: [UnitOfWork],
  exports: [UnitOfWork],
})
export class TenancyDatabaseModule {}
