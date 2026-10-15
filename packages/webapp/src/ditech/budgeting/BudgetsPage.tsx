// @ts-nocheck
import { useState } from 'react';
import { useHistory } from 'react-router-dom';
import { Button, Classes, HTMLSelect, InputGroup, Intent, NavbarDivider, NavbarGroup, Tag } from '@blueprintjs/core';
import { Can, DashboardActionsBar, DashboardContentTable, DashboardPageContent, DataTable, EmptyStatus, Icon, TableSkeletonHeader, TableSkeletonRows } from '@/components';
import { AbilitySubject, BudgetAction } from '@/constants/abilityOption';
import { useBudgets } from '@/hooks/query/budgets';
import { portalUrl } from '@/ditech/plan';
import { BUDGET_TYPES, BUDGET_TYPE_LABEL, CreateBudgetDialog } from './BudgetDialogs';
import { useBudgetingEnabled } from './hooks';

export const STATUS_INTENT = { draft: Intent.NONE, submitted: Intent.PRIMARY, under_review: Intent.PRIMARY, approved: Intent.SUCCESS, locked: Intent.SUCCESS, rejected: Intent.DANGER, cancelled: Intent.NONE };
export const statusLabel = (s: string) => s.replace('_', ' ').replace(/^./, (c) => c.toUpperCase());

const COLUMNS = [
  { id: 'reference', Header: 'Reference', accessor: 'reference', width: 110 },
  { id: 'name', Header: 'Name', accessor: 'name', width: 220 },
  { id: 'type', Header: 'Type', accessor: (b) => BUDGET_TYPE_LABEL[b.type] ?? b.type, width: 150 },
  { id: 'year', Header: 'Fiscal year', accessor: 'fiscalYear', width: 80 },
  { id: 'period', Header: 'Period', accessor: (b) => `${b.startDate} – ${b.endDate}`, width: 170 },
  {
    id: 'status',
    Header: 'Latest version',
    accessor: (b) =>
      b.latestVersion ? (
        <span>
          v{b.latestVersion.versionNo} <Tag minimal intent={STATUS_INTENT[b.latestVersion.status]}>{statusLabel(b.latestVersion.status)}</Tag>
        </span>
      ) : (
        ''
      ),
    width: 140,
  },
];

/** 103 DiTech: budgets list (Financial > Budgets). */
export function BudgetsPage() {
  const history = useHistory();
  const enabled = useBudgetingEnabled();
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');
  const [fiscalYear, setFiscalYear] = useState('');
  const [type, setType] = useState('');
  const query = { pageSize: 200, ...(search.trim() ? { search: search.trim() } : {}), ...(fiscalYear ? { fiscalYear: Number(fiscalYear) } : {}), ...(type ? { type } : {}) };
  const { data, isLoading, isFetching } = useBudgets(query, { enabled });
  const budgets = data?.data ?? [];
  const thisYear = new Date().getFullYear();

  if (!enabled) {
    return (
      <DashboardPageContent>
        <EmptyStatus
          title="Budgeting is not in your plan"
          description={<p>Plan income and expenses by month, compare them with your posted transactions and keep approved versions. Available on the Business plan and above.</p>}
          action={<Button intent={Intent.PRIMARY} large onClick={() => window.open(portalUrl('/billing'), '_blank')}>Upgrade plan</Button>}
        />
      </DashboardPageContent>
    );
  }

  return (
    <>
      <DashboardActionsBar>
        <NavbarGroup>
          <Can I={BudgetAction.Create} a={AbilitySubject.Budget}>
            <Button className={Classes.MINIMAL} icon={<Icon icon="plus" />} text="New budget" onClick={() => setCreating(true)} data-testid="new-budget" />
            <NavbarDivider />
          </Can>
          <InputGroup leftIcon="search" placeholder="Search name or reference" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 220 }} />
          <HTMLSelect
            value={fiscalYear}
            onChange={(e) => setFiscalYear(e.target.value)}
            options={[{ value: '', label: 'All years' }, ...[thisYear + 2, thisYear + 1, thisYear, thisYear - 1, thisYear - 2].map((y) => ({ value: y, label: String(y) }))]}
            style={{ marginLeft: 8 }}
          />
          <HTMLSelect value={type} onChange={(e) => setType(e.target.value)} options={[{ value: '', label: 'All types' }, ...BUDGET_TYPES.map(({ value, label }) => ({ value, label }))]} style={{ marginLeft: 8 }} />
        </NavbarGroup>
      </DashboardActionsBar>

      <DashboardPageContent>
        <DashboardContentTable>
          {!isLoading && budgets.length === 0 && !search && !fiscalYear && !type ? (
            <EmptyStatus
              title="Plan your year"
              description={<p>Create a budget, fill it from last year's actuals or an Excel file, and compare it with what you actually post.</p>}
              action={
                <Can I={BudgetAction.Create} a={AbilitySubject.Budget}>
                  <Button intent={Intent.PRIMARY} large onClick={() => setCreating(true)}>New budget</Button>
                </Can>
              }
            />
          ) : (
            <DataTable
              columns={COLUMNS}
              data={budgets}
              loading={isLoading}
              headerLoading={isLoading}
              progressBarLoading={isFetching}
              selectionColumn={false}
              noInitialFetch
              sticky
              pagination={false}
              TableLoadingRenderer={TableSkeletonRows}
              TableHeaderSkeletonRenderer={TableSkeletonHeader}
              onCellClick={(cell) => history.push(`/budgets/${cell.row.original.id}`)}
              size="medium"
            />
          )}
        </DashboardContentTable>
      </DashboardPageContent>

      <CreateBudgetDialog isOpen={creating} onClose={() => setCreating(false)} onCreated={(b) => history.push(`/budgets/${b.id}`)} />
    </>
  );
}

export default BudgetsPage;
