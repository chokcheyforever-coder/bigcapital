// @ts-nocheck
import { Button, Classes, Dialog, Intent, MenuItem } from '@blueprintjs/core';
import { Form, Formik } from 'formik';
import { AppToaster, FFormGroup } from '@/components';
import { FMultiSelect } from '@/components/Forms';
import { useCustomers, useVendors } from '@/hooks/query';
import { useAssignPriceLevel } from '@/hooks/query/price-levels';

const contactPredicate = (query, contact) => (contact.displayName ?? '').toLowerCase().includes(query.toLowerCase());
const contactRenderer = (contact, { handleClick, modifiers }, { isSelected }) => (
  <MenuItem
    active={modifiers.active}
    icon={isSelected ? 'tick' : 'blank'}
    text={contact.displayName}
    label={contact.priceLevelId ? 'has a level' : ''}
    key={contact.id}
    onClick={handleClick}
  />
);

/** Makes a price level the default of many customers (sales level) or vendors (purchase level) at once. */
export function AssignPriceLevelDialog({ level, onClose }) {
  const isSales = level?.type === 'sales';
  const { data: customersData } = useCustomers({ page_size: 10000 }, { enabled: !!level && isSales });
  const { data: vendorsData } = useVendors({ page_size: 10000 }, { enabled: !!level && !isSales });
  const contacts = (isSales ? customersData?.data : vendorsData?.data) ?? [];
  const { mutateAsync: assign } = useAssignPriceLevel();
  const who = isSales ? 'customers' : 'vendors';

  const handleSubmit = (values, { setSubmitting }) => {
    assign([level.id, values.contactIds])
      .then((res) => {
        AppToaster.show({ message: `${res.assigned} ${who} now use ${level.name}.`, intent: Intent.SUCCESS });
        onClose();
      })
      .catch((error) => {
        AppToaster.show({ message: error?.data?.errors?.[0]?.message ?? 'Something went wrong.', intent: Intent.DANGER });
        setSubmitting(false);
      });
  };

  return (
    <Dialog isOpen={!!level} onClose={onClose} title={`Assign ${level?.name ?? ''}`} style={{ width: 520 }} canOutsideClickClose={false}>
      <Formik initialValues={{ contactIds: [] }} onSubmit={handleSubmit} enableReinitialize>
        {({ values, isSubmitting }) => (
          <Form>
            <div className={Classes.DIALOG_BODY}>
              <FFormGroup
                name={'contactIds'}
                label={isSales ? 'Customers' : 'Vendors'}
                helperText={`New documents for these ${who} will start with this price level. It replaces their current level.`}
              >
                <FMultiSelect
                  name={'contactIds'}
                  items={contacts}
                  placeholder={`Choose ${who}...`}
                  popoverProps={{ minimal: true }}
                  itemPredicate={contactPredicate}
                  itemRenderer={contactRenderer}
                  valueAccessor={(c) => c.id}
                  labelAccessor={(c) => c.displayName}
                  tagRenderer={(c) => c.displayName}
                />
              </FFormGroup>
            </div>
            <div className={Classes.DIALOG_FOOTER}>
              <div className={Classes.DIALOG_FOOTER_ACTIONS}>
                <Button onClick={onClose} disabled={isSubmitting}>
                  Cancel
                </Button>
                <Button intent={Intent.PRIMARY} type={'submit'} loading={isSubmitting} disabled={values.contactIds.length === 0}>
                  Assign
                </Button>
              </div>
            </div>
          </Form>
        )}
      </Formik>
    </Dialog>
  );
}
