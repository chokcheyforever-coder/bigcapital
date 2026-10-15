// @ts-nocheck
import { Button, NavbarDivider } from '@blueprintjs/core';
import { useFormikContext } from 'formik';
import { ProjectSelect } from './ProjectSelect';
import { useProjectOptions } from './hooks';

function ProjectButton({ text }) {
  return (
    <Button
      text={`Project: ${text}`}
      minimal={true}
      small={true}
      icon={'folder-open'}
    />
  );
}

/**
 * 103 DiTech: the document's project, in the form top bar next to branch and
 * warehouse. Renders nothing when the plan has no projects.
 */
export function DocumentProjectSelect({ divider = false }: { divider?: boolean }) {
  const { values } = useFormikContext<{ projectId?: number | null }>();
  const { enabled, projects, isLoading } = useProjectOptions([values?.projectId]);

  if (!enabled || isLoading) return null;
  return (
    <>
      {divider && <NavbarDivider />}
      <ProjectSelect
        name={'projectId'}
        projects={projects}
        input={ProjectButton}
        popoverProps={{ minimal: true }}
        fill={false}
      />
    </>
  );
}
