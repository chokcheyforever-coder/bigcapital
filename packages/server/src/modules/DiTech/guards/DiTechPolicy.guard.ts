import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import { Knex } from 'knex';
import { IS_PUBLIC_ROUTE } from '../../Auth/Auth.constants';
import { getAuthApiKey } from '../../Auth/Auth.utils';
import { TENANCY_DB_CONNECTION } from '../../Tenancy/TenancyDB/TenancyDB.constants';
import { ditechConfig, verifiedPinnedOrg } from '../DiTech.config';
import { FEATURE_ROUTES } from '../DiTech.types';
import { DiTechPolicyService } from '../services/DiTechPolicy.service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const deny = (status: number, code: string, message: string) =>
  new HttpException({ statusCode: status, code, message }, status);

/**
 * Global guard, registered after BigCapital's auth and tenancy guards
 * (architecture.md §3, layer L4). For every tenant request it enforces:
 *  (a) the gateway signature,
 *  (b) that the organization BigCapital resolved equals the one the gateway
 *      pinned for the host (closes R12: API keys pick their own tenant),
 *  (c) subscription status (read-only / suspended),
 *  (d) plan features and limits, before the controllers run.
 */
@Injectable()
export class DiTechPolicyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly cls: ClsService,
    private readonly policies: DiTechPolicyService,
    @Inject(TENANCY_DB_CONNECTION)
    private readonly tenantKnex: () => Knex,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const path: string = req.path ?? req.url;
    // Internal routes have their own guard.
    if (path.startsWith('/api/ditech/')) return true;
    // Container health check (Dockerfile HEALTHCHECK) comes from inside the
    // container, not the gateway. It only pings the system DB.
    if (req.method === 'GET' && path === '/api/system_db') return true;

    const { enforceGateway } = ditechConfig();
    const pinned = verifiedPinnedOrg(req.headers);
    if (enforceGateway && !pinned) {
      throw new ForbiddenException('Requests must come through the 103 DiTech gateway.');
    }

    // BigCapital's own workspace creation bypasses billing and subdomains.
    if (req.method === 'POST' && /^\/api\/workspaces\/?$/.test(path)) {
      throw deny(403, 'WORKSPACES_DISABLED', 'Create companies from your 103 DiTech account.');
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    const organizationId: string | undefined = this.cls.get('organizationId');
    if (isPublic || !organizationId) return true;

    if (pinned && organizationId !== pinned) {
      throw deny(403, 'ORG_MISMATCH', 'This credential belongs to a different company.');
    }

    const policy = await this.policies.getByOrganization(organizationId);
    if (!policy) {
      if (enforceGateway) throw deny(403, 'NO_POLICY', 'This company is not provisioned.');
      return true;
    }

    if (policy.status === 'suspended') {
      throw deny(402, 'SUBSCRIPTION_INACTIVE', 'This subscription is inactive. Renew it from your 103 DiTech account.');
    }
    if (policy.status === 'read_only' && !SAFE_METHODS.has(req.method)) {
      throw deny(402, 'READ_ONLY', 'Payment is overdue, so this company is read-only. Renew to make changes.');
    }

    const features = policy.entitlements.features ?? [];
    for (const [feature, prefixes] of Object.entries(FEATURE_ROUTES)) {
      if (!features.includes(feature) && prefixes.some((p) => path === p || path.startsWith(`${p}/`))) {
        throw deny(403, 'FEATURE_NOT_IN_PLAN', `Your plan does not include ${feature.replace('_', ' ')}.`);
      }
    }
    if (!features.includes('multi_currency') && this.usesForeignCurrency(req, path, policy.base_currency)) {
      throw deny(403, 'FEATURE_NOT_IN_PLAN', 'Your plan does not include multi-currency.');
    }
    if (getAuthApiKey(req.headers['authorization'] ?? '') && !features.includes('api_access')) {
      throw deny(403, 'FEATURE_NOT_IN_PLAN', 'Your plan does not include API access.');
    }

    await this.enforceLimits(req, path, policy.entitlements);
    return true;
  }

  /**
   * A second currency enters a company only through new currencies or
   * customers, vendors and accounts whose currency differs from the base
   * currency; transactions inherit it from those. Existing records are left
   * alone, so a downgrade never breaks recorded data.
   */
  private usesForeignCurrency(req: any, path: string, baseCurrency?: string): boolean {
    if (SAFE_METHODS.has(req.method)) return false;
    if (req.method === 'POST' && /^\/api\/currencies\/?$/.test(path)) return true;
    const code = req.body?.currency_code ?? req.body?.currencyCode;
    return typeof code === 'string' && !!baseCurrency && code.toUpperCase() !== baseCurrency.toUpperCase();
  }

  private async enforceLimits(req: any, path: string, limits: { max_users: number; storage_mb: number }) {
    const adding =
      req.method === 'PATCH' && /^\/api\/invite\/?$/.test(path)
        ? 1
        : req.method === 'POST' && /^\/api\/invite\/bulk\/?$/.test(path)
          ? Math.max(1, Array.isArray(req.body?.invites) ? req.body.invites.length : 1)
          : req.method === 'PUT' && /^\/api\/users\/\d+\/activate\/?$/.test(path)
            ? 1
            : 0;
    if (adding) {
      const [{ count }] = await this.tenantKnex()('users').where('active', true).count({ count: '*' });
      if (Number(count) + adding > limits.max_users) {
        throw deny(402, 'PLAN_LIMIT_USERS', `Your plan allows ${limits.max_users} users per company.`);
      }
    }

    if (req.method === 'POST' && /^\/api\/attachments\/?$/.test(path)) {
      const incoming = Number(req.headers['content-length'] ?? 0);
      const [{ used }] = await this.tenantKnex()('documents').sum({ used: 'size' });
      if (Number(used ?? 0) + incoming > limits.storage_mb * 1024 * 1024) {
        throw deny(402, 'PLAN_LIMIT_STORAGE', `Your plan includes ${limits.storage_mb} MB of storage.`);
      }
    }
  }
}
