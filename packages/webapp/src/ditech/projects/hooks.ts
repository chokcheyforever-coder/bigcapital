// 103 DiTech: projects are a plan feature (`projects`). The server blocks
// /api/projects for plans without it; the webapp hides the project fields
// and shows the menu entry locked.
import { useMemo } from 'react';
import { isLocked, usePlanFeatures } from '@/ditech/plan';
import { useProjects } from '@/hooks/query/projects';

export const PROJECTS_FEATURE = 'projects';

/** True unless the company's plan is known and leaves projects out. */
export function useProjectsEnabled(): boolean {
  const { data: plan } = usePlanFeatures();
  return !isLocked(plan, PROJECTS_FEATURE);
}

/**
 * Projects to offer in a document form: the active ones, plus a closed one the
 * document already uses (so editing an old document keeps its project).
 */
export function useProjectOptions(currentProjectIds: Array<number | null | undefined> = []) {
  const enabled = useProjectsEnabled();
  const { data: projects = [], isLoading } = useProjects({ status: 'all' }, { enabled });
  const key = currentProjectIds.filter(Boolean).join(',');

  const options = useMemo(
    () =>
      projects.filter((p) => p.status === 'active' || currentProjectIds.includes(p.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projects, key],
  );
  return { enabled, projects: options, allProjects: projects, isLoading };
}
