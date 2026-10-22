import React from 'react';
import styled from 'styled-components';
import {
  useExpenseSubtotalFormatted,
  useExpenseTotalFormatted,
  useExpenseWithholding,
} from './utils';
import {
  T,
  TotalLines,
  TotalLine,
  TotalLineBorderStyle,
  TotalLineTextStyle,
} from '@/components';

export function ExpenseFormFooterRight() {
  const totalFormatted = useExpenseTotalFormatted();
  const subtotalFormatted = useExpenseSubtotalFormatted();
  const withholding = useExpenseWithholding();

  return (
    <ExpensesTotalLines>
      <TotalLine
        title={<T id={'expense.label.subtotal'} />}
        value={subtotalFormatted}
        borderStyle={TotalLineBorderStyle.None}
      />
      <TotalLine
        title={<T id={'expense.label.total'} />}
        value={totalFormatted}
        textStyle={TotalLineTextStyle.Bold}
      />
      {withholding.code && (
        <>
          <TotalLine
            title={`Withholding tax [${withholding.code.rate}%]`}
            value={`-${withholding.amountFormatted}`}
            borderStyle={TotalLineBorderStyle.None}
          />
          <TotalLine
            title={'Paid from the account'}
            value={withholding.paidFormatted}
            textStyle={TotalLineTextStyle.Bold}
          />
        </>
      )}
    </ExpensesTotalLines>
  );
}

const ExpensesTotalLines = styled(TotalLines)`
  --x-color-text: #555555;

  .bp4-dark & {
    --x-color-text: var(--color-light-gray4);
  }
  width: 100%;
  color: var(--x-color-text);
`;
