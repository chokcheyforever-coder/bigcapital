// @ts-nocheck
import { useState } from 'react';
import { useHistory } from 'react-router-dom';
import {
  Alert,
  Button,
  Classes,
  InputGroup,
  Intent,
  Menu,
  MenuDivider,
  MenuItem,
  NavbarDivider,
  NavbarGroup,
  Tab,
  Tabs,
  Tag,
} from '@blueprintjs/core';
import {
  AppToaster,
  Can,
  DashboardActionsBar,
  DashboardContentTable,
  DashboardPageContent,
  DataTable,
  EmptyStatus,
  Icon,
  TableSkeletonHeader,
  TableSkeletonRows,
} from '@/components';
import { AbilitySubject, ProjectAction } from '@/constants/abilityOption';
import { useDeleteProject, useEditProject, useProjects } from '@/hooks/query/projects';
import { portalUrl } from '@/ditech/plan';
import { safeCallback } from '@/utils';
import { ProjectFormDialog } from './ProjectFormDialog';
import { useProjectsEnabled } from './hooks';

const DELETE_ERRORS = {
  PROJECT_HAS_TRANSACTIONS: 'This project is used by transactions. Close it instead: closed projects keep their history but take no new transactions.',
};

const statusAccessor = (p) =>
  p.status === 'closed' ? <Tag minimal>Closed</Tag> : <Tag intent={Intent.SUCCESS} minimal>Active</Tag>;

const dateAccessor = (p) => {
  if (!p.startDate && !p.deadline) return '';
  return `${p.startDate ?? '…'} – ${p.deadline ?? '…'}`;
};

const COLUMNS = [
  { id: 'name', Header: 'Name', accessor: 'name', width: 180 },
  { id: 'code', Header: 'Code', accessor: 'code', width: 80 },
  { id: 'customer', Header: 'Customer', accessor: 'customerName', width: 140 },
  { id: 'dates', Header: 'Dates', accessor: dateAccessor, width: 140 },
  { id: 'status', Header: 'Status', accessor: statusAccessor, width: 70 },
];

function ProjectActionsMenu({ payload: { onEdit, onToggle, onDelete, onReport }, row: { original } }) {
  return (
    <Menu>
      <MenuItem icon={<Icon icon="reader-18" />} text={'Profit & loss for this project'} onClick={safeCallback(onReport, original)} />
      <Can I={ProjectAction.Edit} a={AbilitySubject.Project}>
        <MenuDivider />
        <MenuItem icon={<Icon icon="pen-18" />} text={'Edit project'} onClick={safeCallback(onEdit, original)} />
        <MenuItem
          text={original.status === 'closed' ? 'Reopen project' : 'Close project'}
          onClick={safeCallback(onToggle, original)}
        />
      </Can>
      <Can I={ProjectAction.Delete} a={AbilitySubject.Project}>
        <MenuDivider />
        <MenuItem
          icon={<Icon icon="trash-16" iconSize={16} />}
          intent={Intent.DANGER}
          text={'Delete project'}
          onClick={safeCallback(onDelete, original)}
        />
      </Can>
    </Menu>
  );
}

/**
 * 103 DiTech: projects list. Projects tag invoices, bills, expenses and journal
 * lines so the reports (and budgets) can be filtered by project.
 */
export function ProjectsPage() {
  const history = useHistory();
  const enabled = useProjectsEnabled();
  const [status, setStatus] = useState('active');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<null | { project: any }>(null);
  const [deleting, setDeleting] = useState(null);

  const query = { status, ...(search.trim() ? { search: search.trim() } : {}) };
  const { data: projects = [], isLoading, isFetching } = useProjects(query, { enabled });
  const { mutateAsync: editProject } = useEditProject();
  const { mutateAsync: deleteProject, isPending: isDeleting } = useDeleteProject();

  if (!enabled) {
    return (
      <DashboardPageContent>
        <EmptyStatus
          title={'Projects are not in your plan'}
          description={
            <p>Tag income and expenses by project and see profit &amp; loss per project. Available on the Business plan and above.</p>
          }
          action={
            <Button intent={Intent.PRIMARY} large onClick={() => window.open(portalUrl('/billing'), '_blank')}>
              Upgrade plan
            </Button>
          }
        />
      </DashboardPageContent>
    );
  }

  const toggleStatus = (project) => {
    const next = project.status === 'closed' ? 'active' : 'closed';
    editProject([
      project.id,
      {
        name: project.name,
        code: project.code ?? undefined,
        description: project.description ?? undefined,
        contactId: project.contactId ?? undefined,
        startDate: project.startDate ?? undefined,
        deadline: project.deadline ?? undefined,
        status: next,
      },
    ])
      .then(() =>
        AppToaster.show({
          message: next === 'closed' ? 'The project has been closed.' : 'The project has been reopened.',
          intent: Intent.SUCCESS,
        }),
      )
      .catch(() => AppToaster.show({ message: 'Something went wrong.', intent: Intent.DANGER }));
  };

  const confirmDelete = () => {
    deleteProject(deleting.id)
      .then(() => {
        AppToaster.show({ message: 'The project has been deleted.', intent: Intent.SUCCESS });
        setDeleting(null);
      })
      .catch((error) => {
        const type = error?.data?.errors?.[0]?.type;
        AppToaster.show({ message: DELETE_ERRORS[type] ?? 'Something went wrong.', intent: Intent.DANGER });
        setDeleting(null);
      });
  };

  const openReport = (project) => {
    history.push(`/financial-reports/profit-loss-sheet?projectsIds=${project.id}`);
  };

  return (
    <>
      <DashboardActionsBar>
        <NavbarGroup>
          <Can I={ProjectAction.Create} a={AbilitySubject.Project}>
            <Button
              className={Classes.MINIMAL}
              icon={<Icon icon="plus" />}
              text={'New project'}
              onClick={() => setEditing({ project: null })}
            />
            <NavbarDivider />
          </Can>
          <InputGroup
            leftIcon={'search'}
            placeholder={'Search by name or code'}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 240 }}
          />
        </NavbarGroup>
      </DashboardActionsBar>

      <DashboardPageContent>
        <Tabs id={'projects-status'} selectedTabId={status} onChange={(id) => setStatus(String(id))} large>
          <Tab id={'active'} title={'Active'} />
          <Tab id={'closed'} title={'Closed'} />
          <Tab id={'all'} title={'All'} />
        </Tabs>

        <DashboardContentTable>
          {!isLoading && projects.length === 0 && status === 'active' && !search ? (
            <EmptyStatus
              title={'Track income and costs by project'}
              description={
                <p>
                  Create a project, then choose it on invoices, bills, expenses and journal lines. The Profit &amp; Loss,
                  General Ledger and Trial Balance can then be filtered by project.
                </p>
              }
              action={
                <Can I={ProjectAction.Create} a={AbilitySubject.Project}>
                  <Button intent={Intent.PRIMARY} large onClick={() => setEditing({ project: null })}>
                    New project
                  </Button>
                </Can>
              }
            />
          ) : (
            <DataTable
              columns={COLUMNS}
              data={projects}
              loading={isLoading}
              headerLoading={isLoading}
              progressBarLoading={isFetching}
              manualSortBy={false}
              selectionColumn={false}
              noInitialFetch={true}
              sticky={true}
              pagination={false}
              TableLoadingRenderer={TableSkeletonRows}
              TableHeaderSkeletonRenderer={TableSkeletonHeader}
              ContextMenu={ProjectActionsMenu}
              onCellClick={(cell) => setEditing({ project: cell.row.original })}
              size={'medium'}
              payload={{
                onEdit: (p) => setEditing({ project: p }),
                onToggle: toggleStatus,
                onDelete: (p) => setDeleting(p),
                onReport: openReport,
              }}
            />
          )}
        </DashboardContentTable>
      </DashboardPageContent>

      <ProjectFormDialog isOpen={!!editing} project={editing?.project ?? null} onClose={() => setEditing(null)} />

      <Alert
        isOpen={!!deleting}
        intent={Intent.DANGER}
        icon={'trash'}
        cancelButtonText={'Cancel'}
        confirmButtonText={'Delete'}
        loading={isDeleting}
        onCancel={() => setDeleting(null)}
        onConfirm={confirmDelete}
      >
        <p>
          Delete <b>{deleting?.name}</b>? This cannot be undone. A project that is already used by transactions cannot be
          deleted; close it instead.
        </p>
      </Alert>
    </>
  );
}

export default ProjectsPage;
