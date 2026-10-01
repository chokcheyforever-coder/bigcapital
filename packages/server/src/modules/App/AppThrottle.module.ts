import { ExecutionContext, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';

// 103 DiTech: @nestjs/throttler applies every named throttler to every route.
// The strict "auth" limit (30/min) is meant for the sign-in routes, which
// opt in with @Throttle({ auth: {} }); without this check it also capped
// every other route (lists, reports, journals) at 30 requests a minute.
export const AUTH_THROTTLE_METADATA = 'THROTTLER:LIMITauth';
export const skipAuthThrottle = (context: ExecutionContext): boolean =>
  !Reflect.hasMetadata(AUTH_THROTTLE_METADATA, context.getHandler()) &&
  !Reflect.hasMetadata(AUTH_THROTTLE_METADATA, context.getClass());

@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        // Use in-memory storage with very high limits for test environment
        const isTest =
          process.env.NODE_ENV === 'test' ||
          process.env.JEST_WORKER_ID !== undefined;

        if (isTest) {
          return {
            throttlers: [
              {
                name: 'default',
                ttl: 60000,
                limit: 1000000, // Effectively disable throttling in tests
              },
              {
                name: 'auth',
                ttl: 60000,
                limit: 1000000, // Effectively disable throttling in tests
              },
            ],
            // No storage specified = uses in-memory storage
          };
        }

        const host = configService.get<string>('redis.host') || 'localhost';
        const port = Number(configService.get<number>('redis.port') || 6379);
        const password = configService.get<string>('redis.password');
        const db = configService.get<number>('redis.db');

        const globalTtl = configService.get<number>('throttle.global.ttl');
        const globalLimit = configService.get<number>('throttle.global.limit');
        const authTtl = configService.get<number>('throttle.auth.ttl');
        const authLimit = configService.get<number>('throttle.auth.limit');

        return {
          throttlers: [
            {
              name: 'default',
              ttl: globalTtl,
              limit: globalLimit,
            },
            {
              name: 'auth',
              ttl: authTtl,
              limit: authLimit,
              skipIf: skipAuthThrottle,
            },
          ],
          storage: new ThrottlerStorageRedisService({
            host,
            port,
            password,
            db,
          }),
        };
      },
    }),
  ],
})
export class AppThrottleModule {}
