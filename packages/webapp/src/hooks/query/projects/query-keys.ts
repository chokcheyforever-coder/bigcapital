// Query key constants
export const PROJECTS = 'PROJECTS';
export const PROJECT = 'PROJECT';

// Query key factory
export const projectsKeys = {
  all: () => [PROJECTS] as const,
  list: (query?: Record<string, unknown>) => [PROJECTS, query] as const,
  detail: (id: number | string | null | undefined) => [PROJECT, id] as const,
};
