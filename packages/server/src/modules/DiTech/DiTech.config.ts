import { createHmac, timingSafeEqual } from 'crypto';

/**
 * 103 DiTech settings, read from the environment:
 * - DITECH_SERVICE_TOKEN: bearer token the control plane uses on /api/ditech/*.
 * - DITECH_GATEWAY_SECRET: HMAC key shared with the tenant gateway.
 * - DITECH_ENFORCE_GATEWAY: "false" only for local development; otherwise every
 *   tenant request must carry a valid gateway signature and a policy.
 */
export const ditechConfig = () => ({
  serviceToken: process.env.DITECH_SERVICE_TOKEN ?? '',
  gatewaySecret: process.env.DITECH_GATEWAY_SECRET ?? '',
  enforceGateway: process.env.DITECH_ENFORCE_GATEWAY !== 'false',
});

export const PINNED_ORG_HEADER = 'x-ditech-pinned-org';
export const GATEWAY_TS_HEADER = 'x-ditech-gateway-ts';
export const GATEWAY_SIG_HEADER = 'x-ditech-gateway-sig';
const MAX_CLOCK_SKEW_S = 60;

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function signGateway(secret: string, organizationId: string, ts: number): string {
  return createHmac('sha256', secret).update(`${organizationId}.${ts}`).digest('hex');
}

/**
 * Returns the organization the gateway pinned for this request, or null when
 * the request did not come through the gateway with a valid signature.
 */
export function verifiedPinnedOrg(headers: Record<string, unknown>): string | null {
  const { gatewaySecret } = ditechConfig();
  const org = headers[PINNED_ORG_HEADER];
  const ts = Number(headers[GATEWAY_TS_HEADER]);
  const sig = headers[GATEWAY_SIG_HEADER];
  if (!gatewaySecret || typeof org !== 'string' || typeof sig !== 'string' || !ts) return null;
  if (Math.abs(Date.now() / 1000 - ts) > MAX_CLOCK_SKEW_S) return null;
  return safeEqual(signGateway(gatewaySecret, org, ts), sig) ? org : null;
}
