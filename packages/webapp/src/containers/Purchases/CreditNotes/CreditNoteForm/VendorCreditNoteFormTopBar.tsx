import {
  Alignment,
  NavbarGroup,
  NavbarDivider,
  Classes,
} from '@blueprintjs/core';
import React from 'react';
import {
  useSetPrimaryBranchToForm,
  useSetPrimaryWarehouseToForm,
} from './utils';
import { useVendorCreditNoteFormContext } from './VendorCreditNoteFormProvider';
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
import { DocumentPriceLevel } from '@/ditech/pricing/DocumentPriceLevel';
import { usePriceLevelsEnabled } from '@/ditech/pricing/hooks';

/**
 * Vendor Credit note form topbar.
 */
export function VendorCreditNoteFormTopBar() {
  // Features guard.
  const { featureCan } = useFeatureCan();

  // Sets the primary warehouse to form.
  useSetPrimaryWarehouseToForm();

  // Sets the primary branch to form.
  useSetPrimaryBranchToForm();

  // Can't display the navigation bar if warehouses or branches feature is not enabled.
  const isProjectsEnabled = useProjectsEnabled();
  const isPriceLevelsEnabled = usePriceLevelsEnabled();
  const { isNewMode } = useVendorCreditNoteFormContext();

  if (
    !featureCan(Features.Warehouses) &&
    !featureCan(Features.Branches) &&
    !isProjectsEnabled &&
    !isPriceLevelsEnabled
  ) {
    return null;
  }

  return (
    <FormTopbar>
      <NavbarGroup align={Alignment.LEFT}>
        <FeatureCan feature={Features.Branches}>
          <VendorCreditNoteFormSelectBranch />
        </FeatureCan>
        {featureCan(Features.Warehouses) && featureCan(Features.Branches) && (
          <NavbarDivider />
        )}
        <FeatureCan feature={Features.Warehouses}>
          <VendorCreditFormSelectWarehouse />
        </FeatureCan>
        <DocumentProjectSelect
          divider={
            featureCan(Features.Warehouses) || featureCan(Features.Branches)
          }
        />
        <DocumentPriceLevel
          type={'purchase'}
          contactField={'vendorId'}
          dateField={'vendorCreditDate'}
          isNewMode={isNewMode}
          divider={
            featureCan(Features.Warehouses) ||
            featureCan(Features.Branches) ||
            isProjectsEnabled
          }
        />
      </NavbarGroup>
    </FormTopbar>
  );
}

function VendorCreditNoteFormSelectBranch() {
  //  Vendor credit note form context.
  const { branches, isBranchesLoading } = useVendorCreditNoteFormContext();

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

function VendorCreditFormSelectWarehouse() {
  // vendor credit note form context.
  const { warehouses, isWarehouesLoading } = useVendorCreditNoteFormContext();

  return isWarehouesLoading ? (
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
