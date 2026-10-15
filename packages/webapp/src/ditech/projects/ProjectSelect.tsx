// @ts-nocheck
import { MenuItem } from '@blueprintjs/core';
import { FSelect, FMultiSelect } from '@/components/Forms';

const NO_PROJECT = { id: null, name: 'No project', code: '' };

/** Project picker for document headers; the first item clears the project. */
export function ProjectSelect({ projects, ...rest }) {
  return (
    <FSelect
      valueAccessor={'id'}
      textAccessor={'name'}
      labelAccessor={'code'}
      placeholder={'No project'}
      {...rest}
      items={[NO_PROJECT, ...(projects ?? [])]}
    />
  );
}

const projectItemPredicate = (query, project, _index, exactMatch) => {
  const name = project.name.toLowerCase();
  const q = query.toLowerCase();
  return exactMatch ? name === q : `${project.code ?? ''} ${name}`.indexOf(q) >= 0;
};

const projectItemRenderer = (project, { handleClick, modifiers }, { isSelected }) => (
  <MenuItem
    active={modifiers.active}
    disabled={modifiers.disabled}
    icon={isSelected ? 'tick' : 'blank'}
    text={project.name}
    label={project.code}
    key={project.id}
    onClick={handleClick}
  />
);

/** Projects filter for financial reports. */
export function ProjectMultiSelect({ projects, ...rest }) {
  return (
    <FMultiSelect
      items={projects}
      placeholder={'Filter by projects...'}
      popoverProps={{ minimal: true }}
      itemPredicate={projectItemPredicate}
      itemRenderer={projectItemRenderer}
      valueAccessor={(item) => item.id}
      labelAccessor={(item) => item.code}
      tagRenderer={(item) => item.name}
      {...rest}
    />
  );
}
