import {
  Alignment,
  NavbarGroup,
  NavbarDivider,
  Classes,
} from '@blueprintjs/core';
import React from 'react';
import { useEstimateFormContext } from './EstimateFormProvider';
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
import { DocumentPriceLevel } from '@/ditech/pricing/DocumentPriceLevel';
import { usePriceLevelsEnabled } from '@/ditech/pricing/hooks';

/**
 * Estimate form topbar .
 * @returns {JSX.Element}
 */
export function EstimtaeFormTopBar() {
  // Features guard.
  const { featureCan } = useFeatureCan();

  // Sets the primary warehouse to form.
  useSetPrimaryWarehouseToForm();

  // Sets the primary branch to form.
  useSetPrimaryBranchToForm();

  // Can't display the navigation bar if warehouses or branches feature is not enabled.
  const isPriceLevelsEnabled = usePriceLevelsEnabled();
  const { isNewMode } = useEstimateFormContext();

  if (
    !featureCan(Features.Warehouses) &&
    !featureCan(Features.Branches) &&
    !isPriceLevelsEnabled
  ) {
    return null;
  }

  return (
    <FormTopbar>
      <NavbarGroup align={Alignment.LEFT}>
        <FeatureCan feature={Features.Branches}>
          <EstimateFormSelectBranch />
        </FeatureCan>
        {featureCan(Features.Warehouses) && featureCan(Features.Branches) && (
          <NavbarDivider />
        )}
        <FeatureCan feature={Features.Warehouses}>
          <EstimateFormSelectWarehouse />
        </FeatureCan>
        <DocumentPriceLevel
          type={'sales'}
          contactField={'customerId'}
          dateField={'estimateDate'}
          isNewMode={isNewMode}
          divider={
            featureCan(Features.Warehouses) || featureCan(Features.Branches)
          }
        />
      </NavbarGroup>
    </FormTopbar>
  );
}

function EstimateFormSelectBranch() {
  // Estimate form context.
  const { branches, isBranchesLoading } = useEstimateFormContext();

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

function EstimateFormSelectWarehouse() {
  // Estimate form context.
  const { warehouses, isWarehouesLoading } = useEstimateFormContext();

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
