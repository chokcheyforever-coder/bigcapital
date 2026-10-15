import type { ApiFetcher } from './fetch-utils';
import { paths } from './schema';
import { OpForPath, OpQueryParams, OpRequestBody, OpResponseBody } from './utils';

export const PROJECTS_ROUTES = {
  LIST: '/api/projects',
  BY_ID: '/api/projects/{id}',
} as const satisfies Record<string, keyof paths>;

export type ProjectsListResponse = OpResponseBody<OpForPath<typeof PROJECTS_ROUTES.LIST, 'get'>>;
export type Project = OpResponseBody<OpForPath<typeof PROJECTS_ROUTES.BY_ID, 'get'>>;
export type GetProjectsQuery = OpQueryParams<OpForPath<typeof PROJECTS_ROUTES.LIST, 'get'>>;
export type CreateProjectBody = OpRequestBody<OpForPath<typeof PROJECTS_ROUTES.LIST, 'post'>>;
export type EditProjectBody = OpRequestBody<OpForPath<typeof PROJECTS_ROUTES.BY_ID, 'put'>>;

export async function fetchProjects(
  fetcher: ApiFetcher,
  query?: GetProjectsQuery
): Promise<ProjectsListResponse> {
  const get = fetcher.path(PROJECTS_ROUTES.LIST).method('get').create();
  const { data } = await get(query ?? {});
  return data;
}

export async function fetchProject(fetcher: ApiFetcher, id: number | string): Promise<Project> {
  const get = fetcher.path(PROJECTS_ROUTES.BY_ID).method('get').create();
  const { data } = await get({ id: Number(id) });
  return data;
}

export async function createProject(
  fetcher: ApiFetcher,
  values: CreateProjectBody
): Promise<Project> {
  const post = fetcher.path(PROJECTS_ROUTES.LIST).method('post').create();
  const { data } = await post(values);
  return data as Project;
}

export async function editProject(
  fetcher: ApiFetcher,
  id: number | string,
  values: EditProjectBody
): Promise<Project> {
  const put = fetcher.path(PROJECTS_ROUTES.BY_ID).method('put').create();
  const { data } = await put({ id: Number(id), ...values });
  return data as Project;
}

export async function deleteProject(fetcher: ApiFetcher, id: number | string): Promise<void> {
  const del = fetcher.path(PROJECTS_ROUTES.BY_ID).method('delete').create();
  await del({ id: Number(id) });
}
