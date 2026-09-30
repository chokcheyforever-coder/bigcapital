export type PolicyStatus = 'active' | 'read_only' | 'suspended';

export interface Entitlements {
  max_users: number;
  storage_mb: number;
  features: string[];
}

export interface DiTechPolicy {
  company_ref: string;
  status: PolicyStatus;
  pinned_host: string;
  entitlements: Entitlements;
}

/** Plan features and the API route prefixes they unlock (architecture.md §5). */
export const FEATURE_ROUTES: Record<string, string[]> = {
  inventory: ['/api/inventory-adjustments', '/api/warehouses', '/api/warehouse-transfers'],
  multi_branch: ['/api/branches'],
  bank_rules: ['/api/banking/rules'],
};
