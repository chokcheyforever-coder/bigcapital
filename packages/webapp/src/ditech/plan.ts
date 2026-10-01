// 103 DiTech: plan awareness in the BigCapital webapp. The server enforces
// plans (modules/DiTech/guards/DiTechPolicy.guard.ts); this only explains
// locked features and links to the 103 DiTech portal to upgrade.
import { useQuery } from '@tanstack/react-query';
import { useAuthOrganizationId, useAuthToken } from '@/hooks/state';

export interface PlanFeatures {
  features: string[];
}

/** Error codes the DiTech guard returns when the plan blocks a request. */
export const PLAN_ERROR_CODES = [
  'FEATURE_NOT_IN_PLAN',
  'PLAN_LIMIT_USERS',
  'PLAN_LIMIT_STORAGE',
  'READ_ONLY',
  'SUBSCRIPTION_INACTIVE',
  'WORKSPACES_DISABLED',
];

export function usePlanFeatures() {
  const token = useAuthToken();
  const organizationId = useAuthOrganizationId();
  return useQuery({
    queryKey: ['ditech', 'plan-features', organizationId],
    enabled: !!token,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<PlanFeatures | null> => {
      const res = await fetch('/api/plan-features', {
        headers: {
          accept: 'application/json',
          Authorization: `Bearer ${token}`,
          'organization-id': organizationId ?? '',
        },
      });
      return res.ok ? res.json() : null;
    },
  });
}

/** True when the plan is known and does not include the feature. */
export function isLocked(plan: PlanFeatures | null | undefined, feature?: string) {
  return !!feature && !!plan && !plan.features.includes(feature);
}

/**
 * The 103 DiTech portal lives on www.<same domain>: abc.103ditech.com ->
 * www.103ditech.com, abc.localhost:18081 -> www.localhost:18081.
 */
export function portalUrl(path = '/dashboard') {
  const { protocol, host } = window.location;
  const rest = host.split('.').slice(1).join('.');
  return `${protocol}//www.${rest}${path}`;
}
