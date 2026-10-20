// @ts-nocheck
import { Button, Classes, Dialog, HTMLTable, Intent, MenuItem, Position, Switch } from '@blueprintjs/core';
import { FieldArray, Form, Formik } from 'formik';
import moment from 'moment';
import * as Yup from 'yup';
import { AppToaster, FDateInput, FFormGroup, FInputGroup, FTextArea, Group, Stack } from '@/components';
import { FMultiSelect, FSelect } from '@/components/Forms';
import { useDateInputFormatter } from '@/hooks';
import { useItems, useItemsCategories } from '@/hooks/query';
import { useCreatePriceLevel, useEditPriceLevel, usePriceLevel } from '@/hooks/query/price-levels';
import { ROUNDING_OPTIONS } from './hooks';

const TYPES = [
  { value: 'sales', label: 'Sales (customers)' },
  { value: 'purchase', label: 'Purchases (vendors)' },
];
const METHODS = [
  { value: 'percentage', label: 'Percentage of the normal price' },
  { value: 'per_item', label: 'Fixed price per item (with quantity breaks)' },
];
const DIRECTIONS = [
  { value: 'down', label: 'Decrease by' },
  { value: 'up', label: 'Increase by' },
];

const ERROR_MESSAGES = {
  PRICE_LEVEL_NAME_EXISTS: { name: 'Another price level already has this name.' },
};

const Schema = Yup.object().shape({
  name: Yup.string().trim().max(120).required().label('Name'),
  type: Yup.string().oneOf(['sales', 'purchase']).required(),
  method: Yup.string().oneOf(['percentage', 'per_item']).required(),
  percent: Yup.number().when('method', {
    is: 'percentage',
    then: (s) => s.typeError('Enter a number').min(0).max(1000).required().label('Percentage'),
    otherwise: (s) => s.nullable(),
  }),
  validFrom: Yup.date().nullable(),
  validTo: Yup.date()
    .nullable()
    .when('validFrom', (validFrom, schema) => (validFrom ? schema.min(validFrom, 'The end date must be after the start date.') : schema)),
  items: Yup.array().of(
    Yup.object().shape({
      itemId: Yup.number().nullable(),
      minQuantity: Yup.number().typeError('Enter a number').min(0.001).nullable(),
      price: Yup.number().typeError('Enter a number').min(0).nullable(),
    }),
  ),
});

const categoryPredicate = (query, category) => category.name.toLowerCase().includes(query.toLowerCase());
const categoryRenderer = (category, { handleClick, modifiers }, { isSelected }) => (
  <MenuItem
    active={modifiers.active}
    icon={isSelected ? 'tick' : 'blank'}
    text={category.name}
    key={category.id}
    onClick={handleClick}
  />
);

const emptyRow = () => ({ itemId: null, minQuantity: 1, price: '' });

const toForm = (level) => ({
  name: level?.name ?? '',
  description: level?.description ?? '',
  type: level?.type ?? 'sales',
  method: level?.method ?? 'percentage',
  direction: Number(level?.percentage ?? -1) > 0 ? 'up' : 'down',
  percent: level?.percentage != null ? Math.abs(Number(level.percentage)) : '',
  rounding: level?.rounding ?? 'none',
  categoryIds: (level?.categories ?? []).map((c) => c.id),
  items: level?.items?.length ? level.items.map((i) => ({ itemId: i.itemId, minQuantity: i.minQuantity, price: i.price })) : [emptyRow()],
  validFrom: level?.validFrom ?? null,
  validTo: level?.validTo ?? null,
  active: level?.active ?? true,
});

const toRequest = (values) => {
  const percentage = values.method === 'percentage' ? Number(values.percent || 0) * (values.direction === 'up' ? 1 : -1) : null;
  return {
    name: values.name.trim(),
    description: values.description?.trim() || null,
    type: values.type,
    method: values.method,
    percentage,
    rounding: values.rounding,
    validFrom: values.validFrom ? moment(values.validFrom).format('YYYY-MM-DD') : null,
    validTo: values.validTo ? moment(values.validTo).format('YYYY-MM-DD') : null,
    active: !!values.active,
    categoryIds: values.method === 'percentage' ? values.categoryIds : [],
    items:
      values.method === 'per_item'
        ? values.items
            .filter((r) => r.itemId && r.price !== '' && r.price != null)
            .map((r) => ({ itemId: Number(r.itemId), minQuantity: Number(r.minQuantity || 1), price: Number(r.price) }))
        : [],
  };
};

/** Create or edit a price level. `levelId` is null for a new one. */
export function PriceLevelFormDialog({ isOpen, levelId, onClose }) {
  const isNew = !levelId;
  const dateInputFormatter = useDateInputFormatter();
  const { data: level, isLoading } = usePriceLevel(levelId, { enabled: isOpen && !!levelId });
  const { data: itemsData } = useItems({ page_size: 10000, inactive_mode: false }, { enabled: isOpen });
  const { data: categoriesData } = useItemsCategories(undefined, { enabled: isOpen });
  const items = itemsData?.data ?? [];
  const categories = Array.isArray(categoriesData) ? categoriesData : categoriesData?.data ?? categoriesData?.itemCategories ?? [];
  const { mutateAsync: createLevel } = useCreatePriceLevel();
  const { mutateAsync: editLevel } = useEditPriceLevel();

  const handleSubmit = (values, { setSubmitting, setErrors }) => {
    const request = toRequest(values);
    const action = isNew ? createLevel(request) : editLevel([levelId, request]);
    action
      .then(() => {
        AppToaster.show({ message: isNew ? 'The price level has been created.' : 'The price level has been saved.', intent: Intent.SUCCESS });
        onClose();
      })
      .catch((error) => {
        const errors = error?.data?.errors ?? [];
        const fieldErrors = Object.assign({}, ...errors.map((e) => ERROR_MESSAGES[e.type] ?? {}));
        if (Object.keys(fieldErrors).length > 0) setErrors(fieldErrors);
        else AppToaster.show({ message: errors[0]?.message ?? 'The price level could not be saved.', intent: Intent.DANGER });
        setSubmitting(false);
      });
  };

  const priceOf = (itemId, type) => {
    const item = items.find((i) => i.id === Number(itemId));
    return item ? (type === 'sales' ? item.sellPrice : item.costPrice) : null;
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={isNew ? 'New price level' : 'Edit price level'}
      style={{ width: 640 }}
      canOutsideClickClose={false}
    >
      {!isNew && isLoading ? (
        <div className={Classes.DIALOG_BODY}>Loading…</div>
      ) : (
        <Formik initialValues={toForm(level)} validationSchema={Schema} onSubmit={handleSubmit} enableReinitialize>
          {({ values, setFieldValue, isSubmitting }) => (
            <Form>
              <div className={Classes.DIALOG_BODY} data-testid="price-level-form">
                <Stack spacing={10}>
                  <FFormGroup name={'name'} label={'Name'} labelInfo={'*'}>
                    <FInputGroup name={'name'} autoFocus placeholder={'e.g. Wholesale'} />
                  </FFormGroup>

                  <Group spacing={10} grow noWrap>
                    <FFormGroup name={'type'} label={'For'}>
                      <FSelect name={'type'} items={TYPES} valueAccessor={'value'} textAccessor={'label'} popoverProps={{ minimal: true }} />
                    </FFormGroup>
                    <FFormGroup name={'method'} label={'Prices'}>
                      <FSelect name={'method'} items={METHODS} valueAccessor={'value'} textAccessor={'label'} popoverProps={{ minimal: true }} />
                    </FFormGroup>
                  </Group>

                  {values.method === 'percentage' ? (
                    <>
                      <Group spacing={10} grow noWrap>
                        <FFormGroup name={'direction'} label={'Normal price'}>
                          <FSelect name={'direction'} items={DIRECTIONS} valueAccessor={'value'} textAccessor={'label'} popoverProps={{ minimal: true }} />
                        </FFormGroup>
                        <FFormGroup name={'percent'} label={'Percent'} labelInfo={'*'}>
                          <FInputGroup name={'percent'} rightElement={<span className={Classes.TEXT_MUTED} style={{ padding: 6 }}>%</span>} inputMode={'decimal'} />
                        </FFormGroup>
                        <FFormGroup name={'rounding'} label={'Rounding'}>
                          <FSelect name={'rounding'} items={ROUNDING_OPTIONS} valueAccessor={'value'} textAccessor={'label'} popoverProps={{ minimal: true }} />
                        </FFormGroup>
                      </Group>
                      <FFormGroup
                        name={'categoryIds'}
                        label={'Item categories'}
                        helperText={'Leave empty to apply to all items.'}
                      >
                        <FMultiSelect
                          name={'categoryIds'}
                          items={categories}
                          placeholder={'All items'}
                          popoverProps={{ minimal: true }}
                          valueAccessor={(c) => c.id}
                          labelAccessor={(c) => c.name}
                          tagRenderer={(c) => c.name}
                          itemPredicate={categoryPredicate}
                          itemRenderer={categoryRenderer}
                        />
                      </FFormGroup>
                    </>
                  ) : (
                    <FFormGroup
                      name={'items'}
                      label={'Item prices'}
                      helperText={'Add the same item again with a higher "From quantity" for a quantity break. Items not listed keep their normal price.'}
                    >
                      <FieldArray name={'items'}>
                        {({ push, remove }) => (
                          <>
                            <HTMLTable compact style={{ width: '100%' }} data-testid="price-level-items">
                              <thead>
                                <tr>
                                  <th>Item</th>
                                  <th style={{ width: 90 }}>From qty</th>
                                  <th style={{ width: 110 }}>Price</th>
                                  <th style={{ width: 90 }}>Normal</th>
                                  <th style={{ width: 30 }} />
                                </tr>
                              </thead>
                              <tbody>
                                {values.items.map((row, index) => (
                                  <tr key={index}>
                                    <td>
                                      <FSelect
                                        name={`items[${index}].itemId`}
                                        items={items}
                                        valueAccessor={'id'}
                                        textAccessor={'name'}
                                        labelAccessor={'code'}
                                        placeholder={'Select an item'}
                                        popoverProps={{ minimal: true }}
                                        fill
                                      />
                                    </td>
                                    <td>
                                      <FInputGroup name={`items[${index}].minQuantity`} small inputMode={'decimal'} />
                                    </td>
                                    <td>
                                      <FInputGroup name={`items[${index}].price`} small inputMode={'decimal'} />
                                    </td>
                                    <td className={Classes.TEXT_MUTED}>{priceOf(row.itemId, values.type) ?? ''}</td>
                                    <td>
                                      <Button minimal small icon={'cross'} aria-label={'Remove line'} onClick={() => (values.items.length > 1 ? remove(index) : setFieldValue('items', [emptyRow()]))} />
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </HTMLTable>
                            <Button minimal small icon={'plus'} text={'Add a price'} onClick={() => push(emptyRow())} />
                          </>
                        )}
                      </FieldArray>
                    </FFormGroup>
                  )}

                  <Group spacing={10} grow noWrap>
                    <FFormGroup name={'validFrom'} label={'Valid from'} helperText={'Optional, for promotions.'}>
                      <FDateInput name={'validFrom'} {...dateInputFormatter} popoverProps={{ position: Position.BOTTOM_LEFT, minimal: true }} fill />
                    </FFormGroup>
                    <FFormGroup name={'validTo'} label={'Valid to'}>
                      <FDateInput name={'validTo'} {...dateInputFormatter} popoverProps={{ position: Position.BOTTOM_LEFT, minimal: true }} fill />
                    </FFormGroup>
                  </Group>

                  <FFormGroup name={'description'} label={'Description'}>
                    <FTextArea name={'description'} growVertically fill />
                  </FFormGroup>

                  {!isNew && (
                    <Switch
                      checked={!!values.active}
                      label={'Active (inactive levels are not offered on new documents)'}
                      onChange={(e) => setFieldValue('active', e.currentTarget.checked)}
                    />
                  )}
                </Stack>
              </div>
              <div className={Classes.DIALOG_FOOTER}>
                <div className={Classes.DIALOG_FOOTER_ACTIONS}>
                  <Button onClick={onClose} disabled={isSubmitting}>
                    Cancel
                  </Button>
                  <Button intent={Intent.PRIMARY} type={'submit'} loading={isSubmitting}>
                    {isNew ? 'Create price level' : 'Save'}
                  </Button>
                </div>
              </div>
            </Form>
          )}
        </Formik>
      )}
    </Dialog>
  );
}
