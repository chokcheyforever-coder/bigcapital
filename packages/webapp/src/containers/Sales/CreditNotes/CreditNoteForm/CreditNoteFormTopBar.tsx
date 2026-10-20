import {
  Alignment,
  NavbarGroup,
  NavbarDivider,
  Classes,
} from '@blueprintjs/core';
import React from 'react';
import { useCreditNoteFormContext } from './CreditNoteFormProvider';
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
import { DocumentPriceLevel } from '@/ditech/pricing/DocumentPriceLevel';
import { usePriceLevelsEnabled } from '@/ditech/pricing/hooks';

/**
 * Credit note form topbar .
 */
export function CreditNoteFormTopbar() {
  // Features guard.
  const { featureCan } = useFeatureCan();

  // Sets the primary warehouse to form.
  useSetPrimaryWarehouseToForm();

  // Sets the primary branch to form.
  useSetPrimaryBranchToForm();

  // Can't display the navigation bar if warehouses or branches feature is not enabled.
  const isProjectsEnabled = useProjectsEnabled();
  const isPriceLevelsEnabled = usePriceLevelsEnabled();
  const { isNewMode } = useCreditNoteFormContext();

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
          <CreditNoteFormSelectBranch />
        </FeatureCan>
        {featureCan(Features.Warehouses) && featureCan(Features.Branches) && (
          <NavbarDivider />
        )}
        <FeatureCan feature={Features.Warehouses}>
          <CreditFormSelectWarehouse />
        </FeatureCan>
        <DocumentProjectSelect
          divider={
            featureCan(Features.Warehouses) || featureCan(Features.Branches)
          }
        />
        <DocumentPriceLevel
          type={'sales'}
          contactField={'customerId'}
          dateField={'creditNoteDate'}
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

function CreditNoteFormSelectBranch() {
  // Credit note form context.
  const { branches, isBranchesLoading } = useCreditNoteFormContext();

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

function CreditFormSelectWarehouse() {
  // Credit note form context.
  const { warehouses, isWarehouesLoading } = useCreditNoteFormContext();

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
