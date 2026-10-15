// @ts-nocheck
import { useMemo } from 'react';
import { FormGroup, Intent, Classes, MenuItem } from '@blueprintjs/core';
import { Suggest } from '@blueprintjs/select';
import classNames from 'classnames';
import { CellType } from '@/constants';
import { CLASSES } from '@/constants/classes';

const NO_PROJECT = { id: null, name: 'No project', code: '' };

/**
 * 103 DiTech: project of one line (expense lines, journal lines). Writes the
 * row's `projectId`; "No project" clears it.
 */
export function ProjectsListFieldCell({
  column: { id },
  row: { index, original },
  payload: { projects, updateData, errors },
}) {
  const items = useMemo(() => {
    const list = projects ?? [];
    // Keep a closed project the line already uses selectable on edit.
    return [NO_PROJECT, ...list];
  }, [projects]);
  const selected = items.find((p) => p.id && p.id === original?.projectId) ?? null;
  const error = errors?.[index]?.[id];

  return (
    <FormGroup
      intent={error ? Intent.DANGER : null}
      className={classNames('form-group--select-list', Classes.FILL)}
    >
      <Suggest
        items={items}
        selectedItem={selected}
        onItemSelect={(project) => updateData(index, 'projectId', project.id)}
        itemRenderer={(project, { handleClick, modifiers }) => (
          <MenuItem
            key={project.id ?? 'none'}
            text={project.name}
            label={project.code}
            active={modifiers.active}
            onClick={handleClick}
          />
        )}
        itemPredicate={(query, project) =>
          `${project.code ?? ''} ${project.name}`.toLowerCase().includes(query.toLowerCase())
        }
        inputValueRenderer={(project) => (project?.id ? project.name : '')}
        inputProps={{ placeholder: 'No project' }}
        noResults={<MenuItem disabled text={'No projects'} />}
        resetOnClose
        fill
        popoverProps={{ minimal: true, boundary: 'window' }}
        className={classNames(CLASSES.FORM_GROUP_LIST_SELECT)}
      />
    </FormGroup>
  );
}

ProjectsListFieldCell.cellType = CellType.Field;
