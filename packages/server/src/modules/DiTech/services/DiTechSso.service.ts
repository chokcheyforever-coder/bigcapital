import { createHash, randomBytes } from 'crypto';
import { Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { RedisService } from '@liaoliaots/nestjs-redis';
import { Knex } from 'knex';
import { SystemKnexConnection } from '../../System/SystemDB/SystemDB.constants';
import { JWT_AUDIENCE, JWT_ISSUER } from '../../Auth/Auth.constants';

const TOKEN_TTL_S = 60;
const key = (token: string) => `ditech:sso:${createHash('sha256').update(token).digest('hex')}`;

export interface SsoSession {
  accessToken: string;
  userId: number;
  tenantId: number;
  organizationId: string;
}

/**
 * One-time, 60-second tokens that sign a company member into BigCapital
 * from the 103 DiTech portal ("Open my books"). Stored hashed in Redis and
 * deleted on first use.
 */
@Injectable()
export class DiTechSsoService {
  constructor(
    @Inject(SystemKnexConnection)
    private readonly systemKnex: Knex,
    private readonly redis: RedisService,
    private readonly jwt: JwtService,
  ) {}

  async mint(organizationId: string, email: string) {
    const member = await this.systemKnex('user_tenants as ut')
      .join('users as u', 'u.id', 'ut.user_id')
      .join('tenants as t', 't.id', 'ut.tenant_id')
      .where({ 't.organization_id': organizationId, 'u.email': email.toLowerCase(), 'u.active': true })
      .first('u.id as user_id', 't.id as tenant_id');
    if (!member) throw new NotFoundException('Not a member of this organization.');

    const token = randomBytes(32).toString('base64url');
    const payload = JSON.stringify({ userId: member.userId, tenantId: member.tenantId, organizationId });
    await this.redis.getOrThrow().set(key(token), payload, 'EX', TOKEN_TTL_S);
    return { token, expires_at: new Date(Date.now() + TOKEN_TTL_S * 1000).toISOString() };
  }

  /** Consumes the token (single use) and issues a normal BigCapital session. */
  async exchange(token: string, pinnedOrganizationId: string | null): Promise<SsoSession> {
    const raw = token ? await this.redis.getOrThrow().getdel(key(token)) : null;
    if (!raw) throw new UnauthorizedException('Invalid or expired sign-in link.');
    const data = JSON.parse(raw) as { userId: number; tenantId: number; organizationId: string };
    if (pinnedOrganizationId && data.organizationId !== pinnedOrganizationId) {
      throw new UnauthorizedException('This sign-in link is for a different company.');
    }
    // Same claims and lifetime as AuthSigninService.signToken.
    const accessToken = this.jwt.sign(
      { sub: String(data.userId) },
      { expiresIn: '1d', issuer: JWT_ISSUER, audience: JWT_AUDIENCE },
    );
    return { accessToken, ...data };
  }
}
