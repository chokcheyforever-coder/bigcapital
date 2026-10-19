// 103 DiTech: budget forecasts, dashboard and notifications (Phase 6).
import {
  createBudgetForecast,
  fetchBudgetDashboard,
  fetchBudgetForecastVsBudget,
  fetchBudgetNotifications,
  fetchBudgetNotificationSettings,
  fetchBudgetRollingForecast,
  markBudgetNotificationsRead,
  refreshBudgetForecast,
  saveBudgetNotificationSettings,
} from '@bigcapital/sdk-ts';
import type { BudgetForecastInput, BudgetNotificationSettings } from '@bigcapital/sdk-ts';
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

export function useCreateBudgetForecast() {
  const fetcher = useApiFetcher({ enableCamelCaseTransform: true });
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ([id, values]: [number, BudgetForecastInput & { label?: string; baseVersionNo?: number }]) => createBudgetForecast(fetcher, id, values),
    onSuccess: invalidate,
  });
}

export function useRefreshBudgetForecast() {
  const fetcher = useApiFetcher({ enableCamelCaseTransform: true });
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, versionNo, ...values }: BudgetForecastInput & { id: number; versionNo: number; lockVersion: number }) =>
      refreshBudgetForecast(fetcher, { id, versionNo }, values),
    onSuccess: invalidate,
  });
}

export function useBudgetForecastVsBudget(id: number | null, query: { forecastVersionNo?: number; baseVersionNo?: number } = {}, props: { enabled?: boolean } = {}) {
  const fetcher = useApiFetcher({ enableCamelCaseTransform: true });
  return useQuery({
    enabled: !!id && props.enabled !== false,
    queryKey: budgetWorkflowKeys.forecastVsBudget(id ?? 0, query),
    queryFn: () => fetchBudgetForecastVsBudget(fetcher, id as number, query),
    retry: false,
  });
}

export function useBudgetRollingForecast(
  id: number | null,
  query: { asOfMonth?: string; method?: 'run_rate' | 'growth' | 'seasonal'; runRateMonths?: number; growthPercent?: number } = {},
  props: { enabled?: boolean } = {},
) {
  const fetcher = useApiFetcher({ enableCamelCaseTransform: true });
  return useQuery({
    enabled: !!id && props.enabled !== false,
    queryKey: budgetWorkflowKeys.rolling(id ?? 0, query),
    queryFn: () => fetchBudgetRollingForecast(fetcher, id as number, query),
  });
}

export function useBudgetDashboard(query: { budgetId?: number; asOfMonth?: string } = {}) {
  const fetcher = useApiFetcher({ enableCamelCaseTransform: true });
  return useQuery({ queryKey: budgetWorkflowKeys.dashboard(query), queryFn: () => fetchBudgetDashboard(fetcher, query) });
}

export function useBudgetNotifications(query: { unread?: boolean; page?: number; pageSize?: number } = {}, props: { enabled?: boolean; refetchInterval?: number } = {}) {
  const fetcher = useApiFetcher({ enableCamelCaseTransform: true });
  return useQuery({ ...props, queryKey: budgetWorkflowKeys.notifications(query), queryFn: () => fetchBudgetNotifications(fetcher, query) });
}

export function useMarkBudgetNotificationsRead() {
  const fetcher = useApiFetcher({ enableCamelCaseTransform: true });
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids?: number[]) => markBudgetNotificationsRead(fetcher, ids),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: budgetWorkflowKeys.all() }),
  });
}

export function useBudgetNotificationSettings() {
  const fetcher = useApiFetcher({ enableCamelCaseTransform: true });
  return useQuery({ queryKey: budgetWorkflowKeys.notificationSettings(), queryFn: () => fetchBudgetNotificationSettings(fetcher) });
}

export function useSaveBudgetNotificationSettings() {
  const fetcher = useApiFetcher({ enableCamelCaseTransform: true });
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: BudgetNotificationSettings) => saveBudgetNotificationSettings(fetcher, values),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: budgetWorkflowKeys.notificationSettings() }),
  });
}
