import {
  allocateBudget,
  createBudget,
  deleteBudget,
  editBudget,
  fetchBudget,
  fetchBudgets,
  fetchBudgetVersion,
  prefillBudget,
  saveBudgetLines,
} from '@bigcapital/sdk-ts';
import type {
  AllocateBudgetBody,
  BudgetDetail,
  BudgetsListResponse,
  BudgetVersionDetail,
  CreateBudgetBody,
  EditBudgetBody,
  GetBudgetsQuery,
  PrefillBudgetBody,
  SaveBudgetLinesBody,
} from '@bigcapital/sdk-ts';
import { useMutation, useQuery, useQueryClient, UseQueryOptions } from '@tanstack/react-query';
import { useApiFetcher } from '../../useRequest';
import { budgetsKeys } from './query-keys';

export function useBudgets(query?: GetBudgetsQuery, props?: Omit<UseQueryOptions<BudgetsListResponse>, 'queryKey' | 'queryFn'>) {
  const fetcher = useApiFetcher({ enableCamelCaseTransform: true });
  return useQuery({
    ...props,
    queryKey: budgetsKeys.list(query as Record<string, unknown>),
    queryFn: () => fetchBudgets(fetcher, query),
  });
}

export function useBudget(id: number | string | null | undefined, props?: Omit<UseQueryOptions<BudgetDetail>, 'queryKey' | 'queryFn'>) {
  const fetcher = useApiFetcher({ enableCamelCaseTransform: true });
  return useQuery({
    enabled: !!id,
    ...props,
    queryKey: budgetsKeys.detail(id),
    queryFn: () => fetchBudget(fetcher, id as number),
  });
}

export function useBudgetVersion(
  id: number | string | null | undefined,
  versionNo: number | string | null | undefined,
  props?: Omit<UseQueryOptions<BudgetVersionDetail>, 'queryKey' | 'queryFn'>,
) {
  const fetcher = useApiFetcher({ enableCamelCaseTransform: true });
  return useQuery({
    enabled: !!id && !!versionNo,
    ...props,
    queryKey: budgetsKeys.version(id, versionNo),
    queryFn: () => fetchBudgetVersion(fetcher, id as number, versionNo as number),
  });
}

export function useCreateBudget() {
  const queryClient = useQueryClient();
  const fetcher = useApiFetcher({ enableCamelCaseTransform: true });
  return useMutation({
    mutationFn: (values: CreateBudgetBody) => createBudget(fetcher, values),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: budgetsKeys.all() }),
  });
}

export function useEditBudget() {
  const queryClient = useQueryClient();
  const fetcher = useApiFetcher({ enableCamelCaseTransform: true });
  return useMutation({
    mutationFn: ([id, values]: [number, EditBudgetBody]) => editBudget(fetcher, id, values),
    onSuccess: (_d, [id]) => {
      queryClient.invalidateQueries({ queryKey: budgetsKeys.all() });
      queryClient.invalidateQueries({ queryKey: budgetsKeys.detail(id) });
    },
  });
}

export function useDeleteBudget() {
  const queryClient = useQueryClient();
  const fetcher = useApiFetcher();
  return useMutation({
    mutationFn: (id: number) => deleteBudget(fetcher, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: budgetsKeys.all() }),
  });
}

export function useSaveBudgetLines() {
  const queryClient = useQueryClient();
  const fetcher = useApiFetcher({ enableCamelCaseTransform: true });
  return useMutation({
    mutationFn: ([id, versionNo, values]: [number, number, SaveBudgetLinesBody]) => saveBudgetLines(fetcher, id, versionNo, values),
    onSuccess: (data, [id, versionNo]) => {
      queryClient.setQueryData(budgetsKeys.version(id, versionNo), data);
      queryClient.invalidateQueries({ queryKey: budgetsKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: budgetsKeys.all() });
    },
  });
}

export function useAllocateBudget() {
  const fetcher = useApiFetcher({ enableCamelCaseTransform: true });
  return useMutation({
    mutationFn: ([id, values]: [number, AllocateBudgetBody]) => allocateBudget(fetcher, id, values),
  });
}

export function usePrefillBudget() {
  const fetcher = useApiFetcher({ enableCamelCaseTransform: true });
  return useMutation({
    mutationFn: ([id, values]: [number, PrefillBudgetBody]) => prefillBudget(fetcher, id, values),
  });
}
