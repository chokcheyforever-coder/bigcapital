import { FastField } from 'formik';
import React from 'react';
import { useCreditNoteFormContext } from './CreditNoteFormProvider';
import { entriesFieldShouldUpdate } from './utils';
import type { CreditNoteFormValues } from './utils';
import type { FieldProps } from 'formik';
import { Box } from '@/components';
import { ItemsEntriesTable } from '@/containers/Entries/ItemsEntriesTable';
import { TaxType } from '@/interfaces/TaxRates';
import { DocumentTaxModeBar } from '@/ditech/taxes/DocumentTaxes';

/**
 * Credit note items entries editor field.
 */
export function CreditNoteItemsEntriesEditorField() {
  const { items, taxRates } = useCreditNoteFormContext();

  return (
    <Box p="18px 32px 0">
      <DocumentTaxModeBar />
      <FastField
        name={'entries'}
        items={items}
        taxRates={taxRates}
        shouldUpdate={entriesFieldShouldUpdate}
      >
        {({
          form: { values, setFieldValue },
          field: { value },
          meta: { error },
        }: FieldProps<any[], CreditNoteFormValues>) => (
          <ItemsEntriesTable
            value={value}
            onChange={(entries) => {
              setFieldValue('entries', entries);
            }}
            items={items}
            errors={error}
            linesNumber={4}
            currencyCode={values.currencyCode}
            taxRates={taxRates}
            isInclusiveTax={values.inclusiveExclusiveTax === TaxType.Inclusive}
          />
        )}
      </FastField>
    </Box>
  );
}
