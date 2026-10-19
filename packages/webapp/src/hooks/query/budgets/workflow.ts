// 103 DiTech: budget approvals, versions and spending control (Phase 5).
import {
  createBudgetRevision,
  createBudgetScenario,
  decideBudgetOverride,
  deleteBudgetPolicy,
  fetchBudgetAlerts,
  fetchBudgetApprovalRules,
  fetchBudgetApprovals,
  fetchBudgetAudit,
  fetchBudgetAvailability,
  fetchBudgetComparison,
  fetchBudgetOverrideDrafts,
  fetchBudgetOverrides,
  fetchBudgetPolicies,
  fetchBudgetVersionApprovals,
  requestBudgetOverride,
  runBudgetVersionAction,
  saveBudgetApprovalRules,
  saveBudgetPolicy,
} from '@bigcapital/sdk-ts';
import type { BudgetApprovalRule, BudgetControlledType, BudgetControlMode, BudgetControlPolicy, BudgetPeriodBasis, BudgetVersionAction } from '@bigcapital/sdk-ts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApiFetcher } from '../../useRequest';
import { budgetsKeys, budgetWorkflowKeys } from './query-keys';

const useInvalidateAll = () => {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: budgetsKeys.all() });
    queryClient.invalidateQueries({ queryKey: ['BUDGET'] });
    queryClient.invalidateQueries({ queryKey: ['BUDGET_VERSION'] });
    queryClient.invalidateQueries({ queryKey: ['BUDGET_REPORT'] });
    queryClient.invalidateQueries({ queryKey: budgetWorkflowKeys.all() });
  };
};

export function useBudgetApprovals(query: { mine?: boolean; status?: 'in_review' | 'all' } = {}, props: { enabled?: boolean } = {}) {
  const fetcher = useApiFetcher({ enableCamelCaseTransform: true });
  return useQuery({ ...props, queryKey: budgetWorkflowKeys.approvals(query), queryFn: () => fetchBudgetApprovals(fetcher, query) });
}

export function useBudgetApprovalRules(props: { enabled?: boolean } = {}) {
  const fetcher = useApiFetcher({ enableCamelCaseTransform: true });
  return useQuery({ ...props, queryKey: budgetWorkflowKeys.rules(), queryFn: () => fetchBudgetApprovalRules(fetcher) });
}

export function useSaveBudgetApprovalRules() {
  const fetcher = useApiFetcher({ enableCamelCaseTransform: true });
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: (rules: BudgetApprovalRule[]) => saveBudgetApprovalRules(fetcher, rules), onSuccess: invalidate });
}

export function useBudgetVersionApprovals(id: number | null, versionNo: number | null, props: { enabled?: boolean } = {}) {
  const fetcher = useApiFetcher({ enableCamelCaseTransform: true });
  return useQuery({
    enabled: !!id && !!versionNo && props.enabled !== false,
    queryKey: budgetWorkflowKeys.versionApprovals(id ?? 0, versionNo ?? 0),
    queryFn: () => fetchBudgetVersionApprovals(fetcher, { id: id as number, versionNo: versionNo as number }),
  });
}

export function useBudgetVersionAction() {
  const fetcher = useApiFetcher({ enableCamelCaseTransform: true });
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ action, id, versionNo, comment, userId }: { action: BudgetVersionAction; id: number; versionNo: number; comment?: string; userId?: number }) =>
      runBudgetVersionAction(fetcher, action, { id, versionNo }, { comment, userId }),
    onSuccess: invalidate,
  });
}

export function useCreateBudgetRevision() {
  const fetcher = useApiFetcher({ enableCamelCaseTransform: true });
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ([id, values]: [number, { reason: string; sourceVersionNo?: number; label?: string }]) => createBudgetRevision(fetcher, id, values),
    onSuccess: invalidate,
  });
}

export function useCreateBudgetScenario() {
  const fetcher = useApiFetcher({ enableCamelCaseTransform: true });
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ([id, values]: [number, { scenario: 'base' | 'best' | 'worst' | 'custom'; label: string; sourceVersionNo?: number }]) =>
      createBudgetScenario(fetcher, id, values),
    onSuccess: invalidate,
  });
}

export function useBudgetComparison(id: number | null, query: { baseVersionNo?: number; versionNo?: number }, props: { enabled?: boolean } = {}) {
  const fetcher = useApiFetcher({ enableCamelCaseTransform: true });
  return useQuery({
    enabled: !!id && props.enabled !== false,
    queryKey: budgetWorkflowKeys.compare(id ?? 0, query),
    queryFn: () => fetchBudgetComparison(fetcher, id as number, query),
  });
}

export function useBudgetAudit(id: number | null, query: { page?: number; pageSize?: number } = {}, props: { enabled?: boolean } = {}) {
  const fetcher = useApiFetcher({ enableCamelCaseTransform: true });
  return useQuery({
    enabled: !!id && props.enabled !== false,
    queryKey: budgetWorkflowKeys.audit(id ?? 0, query),
    queryFn: () => fetchBudgetAudit(fetcher, id as number, query),
  });
}

export function useBudgetPolicies(props: { enabled?: boolean } = {}) {
  const fetcher = useApiFetcher({ enableCamelCaseTransform: true });
  return useQuery({ ...props, queryKey: budgetWorkflowKeys.policies(), queryFn: () => fetchBudgetPolicies(fetcher) });
}

export function useSaveBudgetPolicy() {
  const fetcher = useApiFetcher({ enableCamelCaseTransform: true });
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (values: Partial<BudgetControlPolicy> & { mode: BudgetControlMode }) => saveBudgetPolicy(fetcher, values),
    onSuccess: invalidate,
  });
}

export function useDeleteBudgetPolicy() {
  const fetcher = useApiFetcher({ enableCamelCaseTransform: true });
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: (budgetId: number | null) => deleteBudgetPolicy(fetcher, budgetId), onSuccess: invalidate });
}

export function useBudgetOverrides(query: { status?: string; referenceType?: BudgetControlledType; referenceId?: number } = {}, props: { enabled?: boolean } = {}) {
  const fetcher = useApiFetcher({ enableCamelCaseTransform: true });
  return useQuery({ ...props, queryKey: budgetWorkflowKeys.overrides(query), queryFn: () => fetchBudgetOverrides(fetcher, query) });
}

export function useBudgetOverrideDrafts(props: { enabled?: boolean } = {}) {
  const fetcher = useApiFetcher({ enableCamelCaseTransform: true });
  return useQuery({ ...props, queryKey: budgetWorkflowKeys.drafts(), queryFn: () => fetchBudgetOverrideDrafts(fetcher) });
}

export function useRequestBudgetOverride() {
  const fetcher = useApiFetcher({ enableCamelCaseTransform: true });
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (values: { referenceType: BudgetControlledType; referenceId: number; reason: string }) => requestBudgetOverride(fetcher, values),
    onSuccess: invalidate,
  });
}

export function useDecideBudgetOverride() {
  const fetcher = useApiFetcher({ enableCamelCaseTransform: true });
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, decision, comment }: { id: number; decision: 'approve' | 'reject'; comment?: string }) => decideBudgetOverride(fetcher, id, decision, comment),
    onSuccess: invalidate,
  });
}

export function useBudgetAlerts(query: { budgetId?: number; level?: string; page?: number; pageSize?: number } = {}, props: { enabled?: boolean } = {}) {
  const fetcher = useApiFetcher({ enableCamelCaseTransform: true });
  return useQuery({ ...props, queryKey: budgetWorkflowKeys.alerts(query), queryFn: () => fetchBudgetAlerts(fetcher, query) });
}

export function useBudgetAvailability(id: number | null, query: { month?: string; basis?: BudgetPeriodBasis }, props: { enabled?: boolean } = {}) {
  const fetcher = useApiFetcher({ enableCamelCaseTransform: true });
  return useQuery({
    enabled: !!id && props.enabled !== false,
    queryKey: budgetWorkflowKeys.availability(id ?? 0, query),
    queryFn: () => fetchBudgetAvailability(fetcher, id as number, query),
    // An active version is needed; a 409 just means "not approved yet".
    retry: false,
  });
}
