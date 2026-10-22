// @ts-nocheck
// 103 DiTech: calls /api/tax-compliance with the session's token (the
// endpoints are not in the generated SDK).
import { useAuthOrganizationId, useAuthToken } from '@/hooks/state';

export function useTaxApi() {
  const token = useAuthToken();
  const organizationId = useAuthOrganizationId();
  return async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`/api/tax-compliance${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'organization-id': organizationId ?? '', 'content-type': 'application/json', accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw Object.assign(new Error('request failed'), { data, status: res.status });
    return data;
  };
}
