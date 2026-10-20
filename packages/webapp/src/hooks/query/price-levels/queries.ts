import {
  fetchPriceLevels,
  fetchPriceLevel,
  createPriceLevel,
  editPriceLevel,
  deletePriceLevel,
  assignPriceLevel,
} from '@bigcapital/sdk-ts';
import {
  useMutation,
  useQuery,
  useQueryClient,
  UseMutationOptions,
  UseQueryOptions,
} from '@tanstack/react-query';
import type {
  GetPriceLevelsQuery,
  PriceLevelBody,
  PriceLevelDetail,
  PriceLevelListItem,
} from '@bigcapital/sdk-ts';
import { useApiFetcher } from '../../useRequest';
import { customersKeys } from '../customers/query-keys';
import { priceLevelsKeys } from './query-keys';

const invalidate = (queryClient: ReturnType<typeof useQueryClient>) => {
  queryClient.invalidateQueries({ queryKey: priceLevelsKeys.all() });
  queryClient.invalidateQueries({ queryKey: [priceLevelsKeys.detail(null)[0]] });
};

export function usePriceLevels(
  query?: GetPriceLevelsQuery,
  props?: Omit<UseQueryOptions<PriceLevelListItem[]>, 'queryKey' | 'queryFn'>,
) {
  const fetcher = useApiFetcher({ enableCamelCaseTransform: true });
  return useQuery({
    ...props,
    queryKey: priceLevelsKeys.list(query as Record<string, unknown>),
    queryFn: () => fetchPriceLevels(fetcher, query),
  });
}

export function usePriceLevel(
  id: number | string | null | undefined,
  props?: Omit<UseQueryOptions<PriceLevelDetail>, 'queryKey' | 'queryFn'>,
) {
  const fetcher = useApiFetcher({ enableCamelCaseTransform: true });
  return useQuery({
    ...props,
    enabled: !!id && (props?.enabled ?? true),
    queryKey: priceLevelsKeys.detail(id),
    queryFn: () => fetchPriceLevel(fetcher, String(id)),
  });
}

export function useCreatePriceLevel(props?: UseMutationOptions<PriceLevelDetail, Error, PriceLevelBody>) {
  const queryClient = useQueryClient();
  const fetcher = useApiFetcher();
  return useMutation({
    ...props,
    mutationFn: (values: PriceLevelBody) => createPriceLevel(fetcher, values),
    onSuccess: () => invalidate(queryClient),
  });
}

export function useEditPriceLevel(
  props?: UseMutationOptions<PriceLevelDetail, Error, [number | string, PriceLevelBody]>,
) {
  const queryClient = useQueryClient();
  const fetcher = useApiFetcher();
  return useMutation({
    ...props,
    mutationFn: ([id, values]: [number | string, PriceLevelBody]) => editPriceLevel(fetcher, String(id), values),
    onSuccess: () => invalidate(queryClient),
  });
}

export function useDeletePriceLevel(props?: UseMutationOptions<void, Error, number | string>) {
  const queryClient = useQueryClient();
  const fetcher = useApiFetcher();
  return useMutation({
    ...props,
    mutationFn: (id: number | string) => deletePriceLevel(fetcher, String(id)),
    onSuccess: () => invalidate(queryClient),
  });
}

export function useAssignPriceLevel(
  props?: UseMutationOptions<{ assigned: number }, Error, [number | string, number[]]>,
) {
  const queryClient = useQueryClient();
  const fetcher = useApiFetcher();
  return useMutation({
    ...props,
    mutationFn: ([id, contactIds]: [number | string, number[]]) => assignPriceLevel(fetcher, String(id), contactIds),
    onSuccess: () => {
      invalidate(queryClient);
      queryClient.invalidateQueries({ queryKey: customersKeys.all() });
      queryClient.invalidateQueries({ queryKey: ['VENDORS'] });
    },
  });
}
