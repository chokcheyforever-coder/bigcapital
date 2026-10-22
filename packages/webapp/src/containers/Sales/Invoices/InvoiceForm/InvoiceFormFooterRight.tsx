import { useFormikContext } from 'formik';
import React from 'react';
import { Callout, Intent } from '@blueprintjs/core';
import styled from 'styled-components';
import { AdjustmentTotalLine } from './AdjustmentTotalLine';
import { DiscountTotalLine } from './DiscountTotalLine';
import {
  useInvoiceAdjustmentAmountFormatted,
  useInvoiceAggregatedTaxRates,
  useInvoiceDiscountAmountFormatted,
  useInvoiceDueAmountFormatted,
  useInvoiceExcise,
  useInvoicePaidAmountFormatted,
  useInvoiceSubtotalFormatted,
  useInvoiceTotalFormatted,
} from './utils';
import type { InvoiceFormValues } from './utils';
import {
  T,
  TotalLines,
  TotalLine,
  TotalLineBorderStyle,
  TotalLineTextStyle,
} from '@/components';
import { Features } from '@/constants';
import { useFeatureCan } from '@/hooks/state';
import { TaxType } from '@/interfaces/TaxRates';
import { formattedAmount } from '@/utils';

export function InvoiceFormFooterRight() {
  const {
    values: { inclusiveExclusiveTax, currencyCode },
  } = useFormikContext<InvoiceFormValues>();

  const { featureCan } = useFeatureCan();
  const isSalesTaxFeatureCan = featureCan(Features.SalesTax);

  const taxEntries = useInvoiceAggregatedTaxRates();
  const excise = useInvoiceExcise();
  const adjustmentAmount = useInvoiceAdjustmentAmountFormatted();
  const discountAmount = useInvoiceDiscountAmountFormatted();
  const totalFormatted = useInvoiceTotalFormatted();
  const subtotalFormatted = useInvoiceSubtotalFormatted();
  const paidAmountFormatted = useInvoicePaidAmountFormatted();
  const dueAmountFormatted = useInvoiceDueAmountFormatted();

  return (
    <InvoiceTotalLines labelColWidth={'180px'} amountColWidth={'180px'}>
      {excise.hasExciseItems && inclusiveExclusiveTax === TaxType.Inclusive && (
        <Callout intent={Intent.WARNING} icon={'warning-sign'} style={{ marginBottom: 10 }} data-testid="excise-inclusive-warning">
          Some items carry Specific Tax or Public Lighting Tax: switch the invoice to "Exclusive of tax" and enter their prices excluding tax.
        </Callout>
      )}
      <TotalLine
        title={
          <>
            {isSalesTaxFeatureCan && inclusiveExclusiveTax === TaxType.Inclusive
              ? 'Subtotal (Tax Inclusive)'
              : 'Subtotal'}
          </>
        }
        value={subtotalFormatted}
      />
      <DiscountTotalLine
        currencyCode={currencyCode}
        discountAmount={discountAmount}
      />
      <AdjustmentTotalLine adjustmentAmount={adjustmentAmount} />

      {excise.lines.map((line) => (
        <TotalLine
          key={line.code}
          title={line.label}
          value={formattedAmount(line.amount, currencyCode)}
          borderStyle={TotalLineBorderStyle.None}
        />
      ))}
      {isSalesTaxFeatureCan &&
        taxEntries.map((tax, index) => (
          <TotalLine
            key={index}
            title={tax.label}
            value={tax.taxAmountFormatted}
            borderStyle={TotalLineBorderStyle.None}
          />
        ))}
      <TotalLine
        title={`Total (${currencyCode})`}
        value={totalFormatted}
        borderStyle={TotalLineBorderStyle.SingleDark}
        textStyle={TotalLineTextStyle.Bold}
      />
      <TotalLine
        title={<T id={'invoice_form.label.payment_amount'} />}
        value={paidAmountFormatted}
        borderStyle={TotalLineBorderStyle.None}
      />
      <TotalLine
        title={<T id={'invoice_form.label.due_amount'} />}
        value={dueAmountFormatted}
        textStyle={TotalLineTextStyle.Bold}
      />
    </InvoiceTotalLines>
  );
}

const InvoiceTotalLines = styled(TotalLines)`
  --x-color-text: #555;

  .bp4-dark & {
    --x-color-text: var(--color-light-gray4);
  }
  width: 100%;
  color: var(--x-color-text);
`;
