// @ts-nocheck
// 103 DiTech compliance gaps G2/G3: VAT and Specific/Accommodation Tax + PLT
// on the forms upstream keeps without tax (credit notes, vendor credits, sales
// receipts). The form keeps `inclusiveExclusiveTax` and the lines' tax rates
// like the invoice form; the server recalculates everything on save.
import React from 'react';
import { useFormikContext } from 'formik';
import styled from 'styled-components';
import { Callout, Intent } from '@blueprintjs/core';
import { FFormGroup, FSelect, TotalLine, TotalLineBorderStyle } from '@/components';
import { Features } from '@/constants';
import { InclusiveTaxOptions } from '@/constants/InclusiveTaxOptions';
import { EntriesActionsBar } from '@/containers/Entries/EntriesActionBar';
import { aggregateItemEntriesTaxRates, assignEntriesTaxAmount, getEntriesTotal } from '@/containers/Entries/utils';
import { useFeatureCan } from '@/hooks/state';
import { TaxType } from '@/interfaces/TaxRates';
import { formattedAmount, toSafeNumber } from '@/utils';
import { entriesExcise } from '../excise/entriesExcise';
import { useExciseTaxCodes } from '../excise/useExciseTaxCodes';

export interface DocumentTaxValues {
  entries: any[];
  currencyCode: string;
  inclusiveExclusiveTax?: TaxType;
  discount?: string | number;
  discountType?: 'amount' | 'percentage';
  adjustment?: string | number;
}

/** Form value -> request: `isInclusiveTax`, and the line's tax rate. */
export const isInclusive = (values: { inclusiveExclusiveTax?: TaxType }) => values.inclusiveExclusiveTax === TaxType.Inclusive;
export const taxModeFromDocument = (doc?: { isInclusiveTax?: boolean } | null) => (doc?.isInclusiveTax ? TaxType.Inclusive : TaxType.Exclusive);

/**
 * Subtotal, discount, adjustment, taxes and total of a form, as the server
 * computes them (VAT also on the Specific Tax and PLT, which are only charged
 * on tax-exclusive documents). `excise` false for purchase documents.
 */
export function useDocumentTaxTotals(taxRates: any[] = [], { excise = true } = {}) {
  const { values } = useFormikContext<DocumentTaxValues>();
  const { data: codes } = useExciseTaxCodes({ enabled: excise });
  const { featureCan } = useFeatureCan();
  const salesTax = featureCan(Features.SalesTax);
  const exclusive = !isInclusive(values);

  return React.useMemo(() => {
    const { entries, currencyCode } = values;
    const subtotal = getEntriesTotal(entries);
    const discount = toSafeNumber(values.discount);
    const discountAmount = values.discountType === 'percentage' ? (subtotal * discount) / 100 : discount;
    const adjustment = toSafeNumber(values.adjustment);
    const x = excise ? entriesExcise(entries, codes ?? [], taxRates ?? [], exclusive) : { lines: [], total: 0, vatByTaxRateId: {}, vat: 0, hasExciseItems: false };
    const vatLines = salesTax
      ? aggregateItemEntriesTaxRates(currencyCode, taxRates)(entries).map((rate) => {
          const taxAmount = rate.taxAmount + (x.vatByTaxRateId[String(rate.taxRateId)] ?? 0);
          return { ...rate, taxAmount, taxAmountFormatted: formattedAmount(taxAmount, currencyCode) };
        })
      : [];
    const vat = vatLines.reduce((s, l) => s + (Number(l.taxAmount) || 0), 0);
    const total = subtotal - discountAmount + adjustment + x.total + (exclusive ? vat : 0);
    return {
      subtotal,
      discountAmount,
      adjustment,
      vat,
      vatLines,
      excise: x,
      total,
      totalFormatted: formattedAmount(total, currencyCode, { money: true }),
      inclusive: !exclusive,
    };
  }, [values, codes, taxRates, salesTax, excise, exclusive]);
}

/** "Amounts are: Inclusive / Exclusive of tax" above the lines. */
export function DocumentTaxModeBar() {
  const { featureCan } = useFeatureCan();
  const { values, setFieldValue } = useFormikContext<DocumentTaxValues>();
  if (!featureCan(Features.SalesTax)) return null;

  const handleItemSelect = (item: { key: TaxType }) => {
    setFieldValue('inclusiveExclusiveTax', item.key);
    setFieldValue('entries', assignEntriesTaxAmount(item.key === TaxType.Inclusive)(values.entries));
  };
  return (
    <EntriesActionsBar>
      <ModeGroup name={'inclusiveExclusiveTax'} label={'Amounts are'} inline={true}>
        <FSelect
          name={'inclusiveExclusiveTax'}
          items={InclusiveTaxOptions}
          textAccessor={'label'}
          labelAccessor={() => ''}
          valueAccessor={'key'}
          popoverProps={{ minimal: true, usePortal: true, inline: false }}
          buttonProps={{ small: true }}
          onItemSelect={handleItemSelect}
          filterable={false}
        />
      </ModeGroup>
    </EntriesActionsBar>
  );
}

/** The tax lines between the adjustment and the total. */
export function DocumentTaxTotalLines({ totals, currencyCode }) {
  return (
    <>
      {totals.excise.hasExciseItems && totals.inclusive && (
        <Callout intent={Intent.WARNING} icon={'warning-sign'} style={{ marginBottom: 10 }} data-testid="excise-inclusive-warning">
          Some items carry Specific Tax or Public Lighting Tax: switch to "Exclusive of tax" and enter their prices excluding tax.
        </Callout>
      )}
      {totals.excise.lines.map((line) => (
        <TotalLine key={line.code} title={line.label} value={formattedAmount(line.amount, currencyCode)} borderStyle={TotalLineBorderStyle.None} />
      ))}
      {totals.vatLines.map((tax, index) => (
        <TotalLine key={index} title={tax.label} value={tax.taxAmountFormatted} borderStyle={TotalLineBorderStyle.None} />
      ))}
    </>
  );
}

const ModeGroup = styled(FFormGroup)`
  margin-left: auto;
`;
