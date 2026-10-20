// @ts-nocheck
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
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
import { AbilitySubject, PriceLevelAction } from '@/constants/abilityOption';
import { useDeletePriceLevel, useEditPriceLevel, usePriceLevels } from '@/hooks/query/price-levels';
import { portalUrl } from '@/ditech/plan';
import { safeCallback } from '@/utils';
import { fetchPriceLevel } from '@bigcapital/sdk-ts';
import { useApiFetcher } from '@/hooks/useRequest';
import { PriceLevelFormDialog } from './PriceLevelFormDialog';
import { AssignPriceLevelDialog } from './AssignPriceLevelDialog';
import { PriceLevelSalesReportDialog } from './PriceLevelSalesReportDialog';
import { useBudgetFiles } from '@/ditech/budgeting/files';
import { priceLevelsKeys } from '@/hooks/query/price-levels';
import { describeLevel, usePriceLevelsEnabled } from './hooks';

const DELETE_ERRORS = {
  PRICE_LEVEL_IN_USE: 'Customers, vendors or documents use this price level. Deactivate it instead: it keeps its history but is not offered on new documents.',
};

const statusAccessor = (l) =>
  l.active ? <Tag intent={Intent.SUCCESS} minimal>Active</Tag> : <Tag minimal>Inactive</Tag>;

const datesAccessor = (l) => (!l.validFrom && !l.validTo ? 'Always' : `${l.validFrom ?? '…'} – ${l.validTo ?? '…'}`);

const COLUMNS = [
  { id: 'name', Header: 'Name', accessor: 'name', width: 180 },
  { id: 'type', Header: 'For', accessor: (l) => (l.type === 'sales' ? 'Customers' : 'Vendors'), width: 90 },
  { id: 'prices', Header: 'Prices', accessor: describeLevel, width: 170 },
  { id: 'contacts', Header: 'Assigned to', accessor: (l) => `${l.contactsCount} ${l.type === 'sales' ? 'customer' : 'vendor'}${l.contactsCount === 1 ? '' : 's'}`, width: 110 },
  { id: 'dates', Header: 'Valid', accessor: datesAccessor, width: 150 },
  { id: 'status', Header: 'Status', accessor: statusAccessor, width: 80 },
];

function PriceLevelActionsMenu({ payload: { onEdit, onAssign, onToggle, onDelete, onExport, onImport }, row: { original } }) {
  return (
    <Menu>
      {original.method === 'per_item' && (
        <>
          <MenuItem icon={'export'} text={'Export prices (Excel)'} onClick={safeCallback(onExport, original)} />
          <Can I={PriceLevelAction.Edit} a={AbilitySubject.PriceLevel}>
            <MenuItem icon={'import'} text={'Import prices…'} onClick={safeCallback(onImport, original)} />
          </Can>
          <MenuDivider />
        </>
      )}
      <Can I={PriceLevelAction.Edit} a={AbilitySubject.PriceLevel}>
        <MenuItem icon={<Icon icon="pen-18" />} text={'Edit price level'} onClick={safeCallback(onEdit, original)} />
        {original.active && (
          <MenuItem icon={'people'} text={original.type === 'sales' ? 'Assign to customers' : 'Assign to vendors'} onClick={safeCallback(onAssign, original)} />
        )}
        <MenuItem text={original.active ? 'Deactivate' : 'Activate'} onClick={safeCallback(onToggle, original)} />
      </Can>
      <Can I={PriceLevelAction.Delete} a={AbilitySubject.PriceLevel}>
        <MenuDivider />
        <MenuItem
          icon={<Icon icon="trash-16" iconSize={16} />}
          intent={Intent.DANGER}
          text={'Delete price level'}
          onClick={safeCallback(onDelete, original)}
        />
      </Can>
    </Menu>
  );
}

/**
 * 103 DiTech: price levels. A level gives some customers (or vendors) other
 * prices than the normal item prices: a percentage up or down, or fixed
 * prices per item with quantity breaks.
 */
export function PriceLevelsPage() {
  const enabled = usePriceLevelsEnabled();
  const fetcher = useApiFetcher({ enableCamelCaseTransform: true });
  const [active, setActive] = useState('true');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<null | { id: number | null }>(null);
  const [assigning, setAssigning] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [reportOpen, setReportOpen] = useState(false);
  const { download, upload } = useBudgetFiles();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const importTarget = useRef(null);

  const query = { active, ...(search.trim() ? { search: search.trim() } : {}) };
  const { data: levels = [], isLoading, isFetching } = usePriceLevels(query, { enabled });
  const { mutateAsync: editLevel } = useEditPriceLevel();
  const { mutateAsync: deleteLevel, isPending: isDeleting } = useDeletePriceLevel();

  if (!enabled) {
    return (
      <DashboardPageContent>
        <EmptyStatus
          title={'Price levels are not in your plan'}
          description={<p>Give wholesale, VIP or partner customers their own prices, with quantity breaks and promotions. Available on the Business plan and above.</p>}
          action={
            <Button intent={Intent.PRIMARY} large onClick={() => window.open(portalUrl('/billing'), '_blank')}>
              Upgrade plan
            </Button>
          }
        />
      </DashboardPageContent>
    );
  }

  // Activating or deactivating keeps everything else: send the full level back.
  const toggleActive = async (row) => {
    try {
      const level = await fetchPriceLevel(fetcher, row.id);
      await editLevel([
        level.id,
        {
          name: level.name,
          description: level.description,
          type: level.type,
          method: level.method,
          percentage: level.percentage,
          currencyCode: level.currencyCode,
          rounding: level.rounding,
          validFrom: level.validFrom,
          validTo: level.validTo,
          active: !level.active,
          categoryIds: level.categories.map((c) => c.id),
          items: level.items.map((i) => ({ itemId: i.itemId, minQuantity: i.minQuantity, price: i.price })),
        },
      ]);
      AppToaster.show({ message: level.active ? 'The price level has been deactivated.' : 'The price level has been activated.', intent: Intent.SUCCESS });
    } catch {
      AppToaster.show({ message: 'Something went wrong.', intent: Intent.DANGER });
    }
  };

  const exportPrices = (level) =>
    download(`/api/price-levels/${level.id}/export?format=xlsx`, `price-level-${level.id}.xlsx`).catch(() =>
      AppToaster.show({ message: 'The export failed.', intent: Intent.DANGER }),
    );

  const importPrices = async (file: File) => {
    const level = importTarget.current;
    if (!level || !file) return;
    const res = await upload(`/api/price-levels/${level.id}/import`, file);
    if (res.ok) {
      AppToaster.show({ message: `${res.body?.imported ?? 0} prices imported into ${level.name}.`, intent: Intent.SUCCESS });
      queryClient.invalidateQueries({ queryKey: priceLevelsKeys.all() });
      queryClient.invalidateQueries({ queryKey: priceLevelsKeys.detail(level.id) });
    } else {
      const error = res.body?.errors?.[0];
      const rows = (error?.data?.rows ?? []).slice(0, 3).map((r) => `row ${r.row}: ${r.message}`).join('; ');
      AppToaster.show({ message: `${error?.message ?? 'The import failed.'}${rows ? ` (${rows})` : ''}`, intent: Intent.DANGER, timeout: 10000 });
    }
  };

  const confirmDelete = () => {
    deleteLevel(deleting.id)
      .then(() => {
        AppToaster.show({ message: 'The price level has been deleted.', intent: Intent.SUCCESS });
        setDeleting(null);
      })
      .catch((error) => {
        const type = error?.data?.errors?.[0]?.type;
        AppToaster.show({ message: DELETE_ERRORS[type] ?? 'Something went wrong.', intent: Intent.DANGER });
        setDeleting(null);
      });
  };

  return (
    <>
      <DashboardActionsBar>
        <NavbarGroup>
          <Can I={PriceLevelAction.Create} a={AbilitySubject.PriceLevel}>
            <Button className={Classes.MINIMAL} icon={<Icon icon="plus" />} text={'New price level'} onClick={() => setEditing({ id: null })} />
            <NavbarDivider />
          </Can>
          <InputGroup leftIcon={'search'} placeholder={'Search by name'} value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 240 }} />
          <NavbarDivider />
          <Button className={Classes.MINIMAL} icon={<Icon icon="reader-18" />} text={'Sales by price level'} onClick={() => setReportOpen(true)} />
        </NavbarGroup>
      </DashboardActionsBar>

      <DashboardPageContent>
        <Tabs id={'price-levels-status'} selectedTabId={active} onChange={(id) => setActive(String(id))} large>
          <Tab id={'true'} title={'Active'} />
          <Tab id={'false'} title={'Inactive'} />
          <Tab id={'all'} title={'All'} />
        </Tabs>

        <DashboardContentTable>
          {!isLoading && levels.length === 0 && active === 'true' && !search ? (
            <EmptyStatus
              title={'Different prices for different customers'}
              description={
                <p>
                  Create a price level such as &quot;Wholesale −15%&quot; or a list of fixed prices with quantity breaks, then give it to
                  customers or vendors. Invoices, receipts, estimates, credit notes, bills and vendor credits fill in its prices.
                </p>
              }
              action={
                <Can I={PriceLevelAction.Create} a={AbilitySubject.PriceLevel}>
                  <Button intent={Intent.PRIMARY} large onClick={() => setEditing({ id: null })}>
                    New price level
                  </Button>
                </Can>
              }
            />
          ) : (
            <DataTable
              columns={COLUMNS}
              data={levels}
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
              ContextMenu={PriceLevelActionsMenu}
              onCellClick={(cell) => setEditing({ id: cell.row.original.id })}
              size={'medium'}
              payload={{
                onEdit: (l) => setEditing({ id: l.id }),
                onAssign: (l) => setAssigning(l),
                onToggle: toggleActive,
                onDelete: (l) => setDeleting(l),
                onExport: exportPrices,
                onImport: (l) => {
                  importTarget.current = l;
                  fileInput.current?.click();
                },
              }}
            />
          )}
        </DashboardContentTable>
      </DashboardPageContent>

      <PriceLevelFormDialog isOpen={!!editing} levelId={editing?.id ?? null} onClose={() => setEditing(null)} />
      <AssignPriceLevelDialog level={assigning} onClose={() => setAssigning(null)} />
      <PriceLevelSalesReportDialog isOpen={reportOpen} onClose={() => setReportOpen(false)} />
      <input
        ref={fileInput}
        type="file"
        accept=".xlsx,.xls,.csv"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) importPrices(file);
        }}
      />

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
          Delete <b>{deleting?.name}</b>? This cannot be undone. A price level that customers, vendors or documents use cannot be deleted;
          deactivate it instead.
        </p>
      </Alert>
    </>
  );
}

export default PriceLevelsPage;
