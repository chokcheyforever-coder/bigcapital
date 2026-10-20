import {
  Alignment,
  NavbarGroup,
  NavbarDivider,
  Classes,
} from '@blueprintjs/core';
import React from 'react';
import styled from 'styled-components';
import { useInvoiceFormContext } from './InvoiceFormProvider';
import {
  useSetPrimaryWarehouseToForm,
  useSetPrimaryBranchToForm,
} from './utils';
import {
  BranchSelect,
  FeatureCan,
  WarehouseSelect,
  FormTopbar,
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
 * Invoice form topbar .
 * @returns {JSX.Element}
 */
export function InvoiceFormTopBar() {
  // Features guard.
  const { featureCan } = useFeatureCan();

  // Sets the primary warehouse to form.
  useSetPrimaryWarehouseToForm();

  // Sets the primary branch to form.
  useSetPrimaryBranchToForm();

  // Can't display the navigation bar if warehouses or branches feature is not enabled.
  const isProjectsEnabled = useProjectsEnabled();
  const isPriceLevelsEnabled = usePriceLevelsEnabled();
  const { isNewMode } = useInvoiceFormContext();

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
          <InvoiceFormSelectBranch />
        </FeatureCan>
        {featureCan(Features.Warehouses) && featureCan(Features.Branches) && (
          <NavbarDivider />
        )}
        <FeatureCan feature={Features.Warehouses}>
          <InvoiceFormSelectWarehouse />
        </FeatureCan>
        <DocumentProjectSelect
          divider={
            featureCan(Features.Warehouses) || featureCan(Features.Branches)
          }
        />
        <DocumentPriceLevel
          type={'sales'}
          contactField={'customerId'}
          dateField={'invoiceDate'}
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

function InvoiceFormSelectBranch() {
  // Invoice form context.
  const { branches, isBranchesLoading } = useInvoiceFormContext();

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

function InvoiceFormSelectWarehouse() {
  // Invoice form context.
  const { warehouses, isWarehouesLoading } = useInvoiceFormContext();

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

const DetailsBarSkeletonBase = styled.div`
  letter-spacing: 10px;
  margin-right: 10px;
  margin-left: 10px;
  font-size: 8px;
  width: 140px;
  height: 10px;
`;
