import {
  Alignment,
  NavbarGroup,
  NavbarDivider,
  Classes,
} from '@blueprintjs/core';
import React from 'react';
import { useBillFormContext } from './BillFormProvider';
import {
  useSetPrimaryBranchToForm,
  useSetPrimaryWarehouseToForm,
} from './utils';
import {
  BranchSelect,
  FeatureCan,
  WarehouseSelect,
  FormTopbar,
  DetailsBarSkeletonBase,
  FormWarehouseSelectButton,
  FormBranchSelectButton,
} from '@/components';
import { Features } from '@/constants';
import { useFeatureCan } from '@/hooks/state';
import { DocumentProjectSelect } from '@/ditech/projects/DocumentProjectSelect';
import { useProjectsEnabled } from '@/ditech/projects/hooks';

/**
 * Bill form topbar .
 * @returns {JSX.Element}
 */
export function BillFormTopBar() {
  // Features guard.
  const { featureCan } = useFeatureCan();

  // Sets the primary warehouse to form.
  useSetPrimaryWarehouseToForm();

  // Sets the primary branch to form.
  useSetPrimaryBranchToForm();

  // Can't display the navigation bar if warehouses or branches feature is not enabled.
  const isProjectsEnabled = useProjectsEnabled();

  if (
    !featureCan(Features.Warehouses) &&
    !featureCan(Features.Branches) &&
    !isProjectsEnabled
  ) {
    return null;
  }

  return (
    <FormTopbar>
      <NavbarGroup align={Alignment.LEFT}>
        <FeatureCan feature={Features.Branches}>
          <BillFormSelectBranch />
        </FeatureCan>
        {featureCan(Features.Warehouses) && featureCan(Features.Branches) && (
          <NavbarDivider />
        )}
        <FeatureCan feature={Features.Warehouses}>
          <BillFormSelectWarehouse />
        </FeatureCan>
        <DocumentProjectSelect
          divider={
            featureCan(Features.Warehouses) || featureCan(Features.Branches)
          }
        />
      </NavbarGroup>
    </FormTopbar>
  );
}

function BillFormSelectBranch() {
  // Bill form context.
  const { branches, isBranchesLoading } = useBillFormContext();

  return isBranchesLoading ? (
    <DetailsBarSkeletonBase className={Classes.SKELETON} />
  ) : (
    <BranchSelect
      name={'branchId'}
      branches={branches}
      input={FormBranchSelectButton}
      popoverProps={{ minimal: true }}
      fill={false}
    />
  );
}

function BillFormSelectWarehouse() {
  // Bill form context.
  const { warehouses, isWarehousesLoading } = useBillFormContext();

  return isWarehousesLoading ? (
    <DetailsBarSkeletonBase className={Classes.SKELETON} />
  ) : (
    <WarehouseSelect
      name={'warehouseId'}
      warehouses={warehouses}
      input={FormWarehouseSelectButton}
      popoverProps={{ minimal: true }}
      fill={false}
    />
  );
}
