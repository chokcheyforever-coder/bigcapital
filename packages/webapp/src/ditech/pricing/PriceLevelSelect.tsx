// @ts-nocheck
import { FSelect } from '@/components/Forms';
import { describeLevel } from './hooks';

const NO_LEVEL = { id: null, name: 'Normal prices', hint: '' };

/** Price level picker; the first item clears the level (normal item prices). */
export function PriceLevelSelect({ levels, ...rest }) {
  const items = (levels ?? []).map((l) => ({ ...l, hint: `${describeLevel(l)}${l.active ? '' : ' · inactive'}` }));
  return (
    <FSelect
      valueAccessor={'id'}
      textAccessor={'name'}
      labelAccessor={'hint'}
      placeholder={'Normal prices'}
      {...rest}
      items={[NO_LEVEL, ...items]}
    />
  );
}
