// 103 DiTech: budgeting is a plan feature (`budgeting`); the server blocks
// /api/budgets for plans without it.
import { isLocked, usePlanFeatures } from '@/ditech/plan';

export const BUDGETING_FEATURE = 'budgeting';

export function useBudgetingEnabled(): boolean {
  const { data: plan } = usePlanFeatures();
  return !isLocked(plan, BUDGETING_FEATURE);
}
