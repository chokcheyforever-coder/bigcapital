// @ts-nocheck
// 103 DiTech part C2: pick the withholding tax of a bill, an expense or a
// vendor's usual one. The form value is the code id as a string, '' for none.
import { useMemo } from 'react';
import { FFormGroup } from '@/components';
import { FSelect } from '@/components/Forms';
import { useWhtCodes } from './useWhtCodes';

export function WhtCodeSelectField({ name = 'whtCodeId', label = 'Withholding tax', inline = true, helperText }: { name?: string; label?: string; inline?: boolean; helperText?: string }) {
  const { data: codes = [] } = useWhtCodes();
  const items = useMemo(
    () => [
      { value: '', label: 'None' },
      ...codes.filter((c) => c.active).map((c) => ({ value: String(c.id), label: `${c.name} (${c.rate}%)`, hint: c.code })),
    ],
    [codes],
  );
  return (
    <FFormGroup name={name} label={label} inline={inline} helperText={helperText}>
      <FSelect name={name} items={items} valueAccessor={'value'} textAccessor={'label'} labelAccessor={'hint'} popoverProps={{ minimal: true }} />
    </FFormGroup>
  );
}
