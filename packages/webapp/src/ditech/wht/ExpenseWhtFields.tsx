// @ts-nocheck
// 103 DiTech part C2: the vendor paid by an expense and the tax withheld from
// it. Picking the vendor takes their usual withholding tax.
import { useMemo } from 'react';
import { useFormikContext } from 'formik';
import { FFormGroup } from '@/components';
import { FSelect } from '@/components/Forms';
import { useVendors } from '@/hooks/query';
import { WhtCodeSelectField } from './WhtCodeSelectField';
import { whtCodeToForm } from './useWhtCodes';

export function ExpenseWhtFields() {
  const { setFieldValue } = useFormikContext();
  const { data } = useVendors({ page_size: 10000 });
  const vendors = data?.data ?? [];
  const items = useMemo(
    () => [{ value: '', label: '—' }, ...vendors.map((v) => ({ value: String(v.id), label: v.displayName }))],
    [vendors],
  );
  return (
    <>
      <FFormGroup name={'payeeId'} label={'Vendor (payee)'} inline helperText={'Needed for the withholding tax certificate.'}>
        <FSelect
          name={'payeeId'}
          items={items}
          valueAccessor={'value'}
          textAccessor={'label'}
          popoverProps={{ minimal: true }}
          onItemChange={(item) => {
            setFieldValue('payeeId', item.value);
            const vendor = vendors.find((v) => String(v.id) === item.value);
            setFieldValue('whtCodeId', whtCodeToForm(vendor?.defaultWhtCodeId));
          }}
        />
      </FFormGroup>
      <WhtCodeSelectField />
    </>
  );
}
