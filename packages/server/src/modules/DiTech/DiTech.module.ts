import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { BullModule } from '@nestjs/bullmq';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { OrganizationBuildQueue } from '../Organization/Organization.types';
import { DeleteWorkspaceQueue } from '../ee/Workspaces/Workspaces.types';
import { DiTechPolicyGuard } from './guards/DiTechPolicy.guard';
import { DiTechServiceGuard } from './guards/DiTechService.guard';
import { DiTechPolicyService } from './services/DiTechPolicy.service';
import { DiTechTenantsService } from './services/DiTechTenants.service';
import { DiTechSsoService } from './services/DiTechSso.service';
import { DiTechTenantsController } from './controllers/DiTechTenants.controller';
import { DiTechSsoController } from './controllers/DiTechSso.controller';

/**
 * 103 DiTech Cloud Accounting integration: internal provisioning API, SSO
 * and the tenant policy guard. Must be imported after AuthModule and
 * TenancyModule so its global guard runs after authentication.
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: OrganizationBuildQueue }, { name: DeleteWorkspaceQueue }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.secret'),
        signOptions: { algorithm: 'HS384' },
      }),
    }),
  ],
  controllers: [DiTechTenantsController, DiTechSsoController],
  providers: [
    DiTechPolicyService,
    DiTechTenantsService,
    DiTechSsoService,
    DiTechServiceGuard,
    { provide: APP_GUARD, useClass: DiTechPolicyGuard },
  ],
})
export class DiTechModule {}
