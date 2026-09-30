import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Put,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { PublicRoute } from '../../Auth/guards/jwt.guard';
import { TenantAgnosticRoute } from '../../Tenancy/TenancyGlobal.guard';
import { DiTechServiceGuard } from '../guards/DiTechService.guard';
import { DiTechTenantsService, CreateTenantInput } from '../services/DiTechTenants.service';
import { DiTechSsoService } from '../services/DiTechSso.service';
import { DiTechPolicy } from '../DiTech.types';

// Bodies are converted to camelCase by BigCapital's SerializeInterceptor
// before reaching handlers, and responses back to snake_case.

const STATUSES = ['active', 'read_only', 'suspended'];

function toPolicy(body: any): DiTechPolicy {
  const e = body?.entitlements ?? {};
  const policy: DiTechPolicy = {
    company_ref: String(body?.companyRef ?? ''),
    status: body?.status,
    pinned_host: String(body?.pinnedHost ?? '').toLowerCase(),
    entitlements: {
      max_users: Number(e.maxUsers),
      storage_mb: Number(e.storageMb),
      features: Array.isArray(e.features) ? e.features.map(String) : [],
    },
  };
  if (
    !policy.company_ref ||
    !STATUSES.includes(policy.status) ||
    !/^[a-z0-9.-]+$/.test(policy.pinned_host) ||
    !(policy.entitlements.max_users >= 1) ||
    !(policy.entitlements.storage_mb >= 1)
  ) {
    throw new BadRequestException('Invalid policy.');
  }
  return policy;
}

/** Internal provisioning API for the 103 DiTech control plane. */
@ApiExcludeController()
@Controller('ditech/tenants')
@PublicRoute()
@TenantAgnosticRoute()
@UseGuards(DiTechServiceGuard)
export class DiTechTenantsController {
  constructor(
    private readonly tenants: DiTechTenantsService,
    private readonly sso: DiTechSsoService,
  ) {}

  @Post()
  async create(
    @Headers('idempotency-key') idempotencyKey: string,
    @Body() body: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!idempotencyKey || idempotencyKey.length > 64) {
      throw new BadRequestException('Idempotency-Key header is required (max 64 chars).');
    }
    const o = body?.organization ?? {};
    const input: CreateTenantInput = {
      owner: {
        email: String(body?.owner?.email ?? ''),
        first_name: String(body?.owner?.firstName ?? ''),
        last_name: String(body?.owner?.lastName ?? ''),
      },
      organization: {
        name: o.name,
        location: o.location,
        base_currency: o.baseCurrency,
        timezone: o.timezone,
        fiscal_year: o.fiscalYear,
        language: o.language,
        date_format: o.dateFormat,
      },
      policy: toPolicy(body?.policy),
    };
    if (!/^[^@\s]+@[^@\s]+$/.test(input.owner.email) || !input.organization.name) {
      throw new BadRequestException('owner.email and organization.name are required.');
    }
    const { state, replay } = await this.tenants.create(idempotencyKey, input);
    res.status(replay ? 200 : 202);
    return state;
  }

  @Get(':organizationId')
  state(@Param('organizationId') organizationId: string) {
    return this.tenants.state(organizationId);
  }

  @Post(':organizationId/build')
  @HttpCode(202)
  build(@Param('organizationId') organizationId: string) {
    return this.tenants.enqueueBuild(organizationId);
  }

  @Put(':organizationId/policy')
  policy(@Param('organizationId') organizationId: string, @Body() body: any) {
    return this.tenants.updatePolicy(organizationId, toPolicy(body));
  }

  @Get(':organizationId/usage')
  usage(@Param('organizationId') organizationId: string) {
    return this.tenants.usage(organizationId);
  }

  @Post(':organizationId/sso-tokens')
  @HttpCode(201)
  ssoToken(@Param('organizationId') organizationId: string, @Body() body: any) {
    return this.sso.mint(organizationId, String(body?.email ?? ''));
  }

  @Delete(':organizationId')
  @HttpCode(202)
  remove(@Param('organizationId') organizationId: string) {
    return this.tenants.delete(organizationId);
  }
}
