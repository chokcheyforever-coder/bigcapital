import {
  fetchProjects,
  fetchProject,
  createProject,
  editProject,
  deleteProject,
} from '@bigcapital/sdk-ts';
import {
  useMutation,
  useQuery,
  useQueryClient,
  UseMutationOptions,
  UseQueryOptions,
} from '@tanstack/react-query';
import type {
  Project,
  ProjectsListResponse,
  GetProjectsQuery,
  CreateProjectBody,
  EditProjectBody,
} from '@bigcapital/sdk-ts';
import { useApiFetcher } from '../../useRequest';
import { projectsKeys } from './query-keys';

const invalidate = (queryClient: ReturnType<typeof useQueryClient>) => {
  queryClient.invalidateQueries({ queryKey: projectsKeys.all() });
};

export function useProjects(
  query?: GetProjectsQuery,
  props?: Omit<UseQueryOptions<ProjectsListResponse>, 'queryKey' | 'queryFn'>,
) {
  const fetcher = useApiFetcher({ enableCamelCaseTransform: true });
  return useQuery({
    ...props,
    queryKey: projectsKeys.list(query as Record<string, unknown>),
    queryFn: () => fetchProjects(fetcher, query),
  });
}

export function useProject(
  id: number | string | null | undefined,
  props?: Omit<UseQueryOptions<Project>, 'queryKey' | 'queryFn'>,
) {
  const fetcher = useApiFetcher({ enableCamelCaseTransform: true });
  return useQuery({
    enabled: !!id,
    ...props,
    queryKey: projectsKeys.detail(id),
    queryFn: () => fetchProject(fetcher, String(id)),
  });
}

export function useCreateProject(
  props?: UseMutationOptions<Project, Error, CreateProjectBody>,
) {
  const queryClient = useQueryClient();
  const fetcher = useApiFetcher();
  return useMutation({
    ...props,
    mutationFn: (values: CreateProjectBody) => createProject(fetcher, values),
    onSuccess: () => invalidate(queryClient),
  });
}

export function useEditProject(
  props?: UseMutationOptions<Project, Error, [number | string, EditProjectBody]>,
) {
  const queryClient = useQueryClient();
  const fetcher = useApiFetcher();
  return useMutation({
    ...props,
    mutationFn: ([id, values]: [number | string, EditProjectBody]) =>
      editProject(fetcher, String(id), values),
    onSuccess: (_data, [id]) => {
      queryClient.invalidateQueries({ queryKey: projectsKeys.detail(id) });
      invalidate(queryClient);
    },
  });
}

export function useDeleteProject(
  props?: UseMutationOptions<void, Error, number | string>,
) {
  const queryClient = useQueryClient();
  const fetcher = useApiFetcher();
  return useMutation({
    ...props,
    mutationFn: (id: number | string) => deleteProject(fetcher, String(id)),
    onSuccess: () => invalidate(queryClient),
  });
}
