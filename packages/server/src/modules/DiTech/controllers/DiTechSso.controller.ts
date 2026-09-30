import { Controller, ForbiddenException, Get, Query, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { PublicRoute } from '../../Auth/guards/jwt.guard';
import { TenantAgnosticRoute } from '../../Tenancy/TenancyGlobal.guard';
import { ditechConfig, verifiedPinnedOrg } from '../DiTech.config';
import { DiTechSsoService } from '../services/DiTechSso.service';

/**
 * Browser-facing end of "Open my books": reached on the company's own host
 * through the gateway. Sets the cookies the webapp already reads after login
 * (hooks/query/authentication/queries.ts) and redirects to the dashboard.
 */
@ApiExcludeController()
@Controller('ditech/sso')
@PublicRoute()
@TenantAgnosticRoute()
export class DiTechSsoController {
  constructor(private readonly sso: DiTechSsoService) {}

  @Get('callback')
  async callback(@Query('t') token: string, @Req() req: Request, @Res() res: Response) {
    const pinned = verifiedPinnedOrg(req.headers);
    if (ditechConfig().enforceGateway && !pinned) {
      throw new ForbiddenException('Requests must come through the 103 DiTech gateway.');
    }
    const session = await this.sso.exchange(String(token ?? ''), pinned);
    const cookie = {
      path: '/',
      maxAge: 24 * 3600 * 1000,
      sameSite: 'lax' as const,
      secure: req.get('x-forwarded-proto') === 'https',
      encode: String,
    };
    res.cookie('token', session.accessToken, cookie);
    res.cookie('authenticated_user_id', String(session.userId), cookie);
    res.cookie('organization_id', session.organizationId, cookie);
    res.cookie('tenant_id', String(session.tenantId), cookie);
    res.redirect(302, '/');
  }
}
