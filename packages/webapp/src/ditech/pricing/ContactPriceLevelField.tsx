// @ts-nocheck
import { useFormikContext } from 'formik';
import { FFormGroup } from '@/components';
import { usePriceLevels } from '@/hooks/query/price-levels';
import { PriceLevelSelect } from './PriceLevelSelect';
import { usePriceLevelsEnabled } from './hooks';

/**
 * 103 DiTech: the default price level of a customer (sales levels) or vendor
 * (purchase levels); new documents for them start with it.
 */
export function ContactPriceLevelField({ type }: { type: 'sales' | 'purchase' }) {
  const enabled = usePriceLevelsEnabled();
  const { values } = useFormikContext<{ priceLevelId?: number | null }>();
  const { data: levels = [] } = usePriceLevels({ type, active: 'all' }, { enabled });
  if (!enabled) return null;

  const options = levels.filter((l) => l.active || l.id === values.priceLevelId);
  return (
    <FFormGroup
      name={'priceLevelId'}
      label={'Price level'}
      helperText={'New documents start with these prices.'}
      inline
    >
      <PriceLevelSelect name={'priceLevelId'} levels={options} popoverProps={{ minimal: true }} />
    </FFormGroup>
  );
}
