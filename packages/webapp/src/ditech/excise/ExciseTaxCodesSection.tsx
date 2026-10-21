// @ts-nocheck
// 103 DiTech: Preferences › Tax compliance › Specific Tax, Accommodation Tax
// and Public Lighting Tax (part C1). Each code's rate, base and payable
// account, and the items charged it. Invoices keep the rates they were saved
// with, so changing a rate only affects new and edited invoices.
import { useMemo, useState } from 'react';
import { Button, Callout, Checkbox, Classes, Dialog, HTMLTable, InputGroup, Intent, Switch, Tag } from '@blueprintjs/core';
import { Form, Formik } from 'formik';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AppToaster, FFormGroup, FInputGroup, Stack } from '@/components';
import { FSelect } from '@/components/Forms';
import { useAccounts, useItems } from '@/hooks/query';
import { useTaxApi } from '../compliance/useTaxApi';
import { EXCISE_CODES_QUERY_KEY, useExciseTaxCodes } from './useExciseTaxCodes';

const KIND_LABELS = { specific: 'Specific Tax', accommodation: 'Accommodation Tax', plt: 'Public Lighting Tax' };

export function ExciseTaxCodesSection() {
  const { data: codes = [], isLoading } = useExciseTaxCodes();
  const { data: accounts = [] } = useAccounts();
  const [editing, setEditing] = useState(null);
  const accountName = (id) => accounts.find((a) => a.id === id)?.name ?? '—';

  return (
    <div style={{ maxWidth: 960, marginTop: 32 }} data-testid="excise-tax-codes">
      <h3 style={{ margin: '0 0 10px' }}>Taxes before VAT</h3>
      <Stack spacing={10}>
        <Callout icon={'info-sign'}>
          Specific Tax (wine, beer, spirits, cigarettes), Accommodation Tax and Public Lighting Tax are added to an invoice line
          before VAT, and VAT is charged on top. Assign each tax to the items it applies to. The starting rates come from
          published 2023–24 tax booklets: check them against current GDT notices before filing. Invoices keep the rates they
          were saved with. Prices of these items must be entered excluding tax.
        </Callout>
        {isLoading ? (
          <div className={Classes.SKELETON} style={{ height: 160 }} />
        ) : (
          <HTMLTable compact striped style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Code</th>
                <th>Tax</th>
                <th style={{ textAlign: 'right' }}>Rate</th>
                <th style={{ textAlign: 'right' }}>Base</th>
                <th>Posts to</th>
                <th>Items</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {codes.map((code) => (
                <tr key={code.id} style={{ opacity: code.active ? 1 : 0.5 }}>
                  <td>
                    <strong>{code.code}</strong>
                  </td>
                  <td>
                    {code.name}
                    {code.name_km ? <div className={Classes.TEXT_MUTED}>{code.name_km}</div> : null}
                    <div className={Classes.TEXT_MUTED} style={{ fontSize: 11 }}>
                      {KIND_LABELS[code.kind]}
                      {!code.active ? ' · inactive' : ''}
                    </div>
                  </td>
                  <td style={{ textAlign: 'right' }}>{code.rate}%</td>
                  <td style={{ textAlign: 'right' }}>{code.base_percent}%</td>
                  <td>{accountName(code.account_id)}</td>
                  <td>
                    <Tag minimal round>
                      {code.item_ids.length}
                    </Tag>
                  </td>
                  <td>
                    <Button small minimal icon={'edit'} text={'Edit'} onClick={() => setEditing(code)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </HTMLTable>
        )}
      </Stack>
      <ExciseTaxCodeDialog code={editing} accounts={accounts} onClose={() => setEditing(null)} />
    </div>
  );
}

function ExciseTaxCodeDialog({ code, accounts, onClose }) {
  const api = useTaxApi();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const { data: itemsData } = useItems({ page_size: 10000, inactive_mode: false }, { enabled: !!code });
  const items = itemsData?.data ?? [];
  const payableAccounts = useMemo(
    () =>
      accounts
        .filter((a) => a.accountType === 'tax-payable' || /liability/.test(a.accountType ?? ''))
        .map((a) => ({ value: a.id, label: a.code ? `${a.code} · ${a.name}` : a.name })),
    [accounts],
  );
  const save = useMutation({
    mutationFn: async (values) => {
      await api('PUT', `/excise-codes/${code.id}`, {
        name: values.name.trim(),
        nameKm: values.nameKm.trim() || null,
        rate: Number(values.rate),
        basePercent: Number(values.basePercent),
        accountId: values.accountId ? Number(values.accountId) : undefined,
        active: values.active,
      });
      await api('PUT', `/excise-codes/${code.id}/items`, { itemIds: values.itemIds });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: EXCISE_CODES_QUERY_KEY }),
  });

  if (!code) return null;
  const valid = (v) => v !== '' && !Number.isNaN(Number(v)) && Number(v) >= 0 && Number(v) <= 100;
  const q = search.trim().toLowerCase();
  const shown = items.filter((i) => !q || `${i.name} ${i.code ?? ''}`.toLowerCase().includes(q));

  return (
    <Dialog isOpen={!!code} onClose={onClose} title={`${code.code} · ${KIND_LABELS[code.kind]}`} style={{ width: 620 }} canOutsideClickClose={false}>
      <Formik
        initialValues={{
          name: code.name ?? '',
          nameKm: code.name_km ?? '',
          rate: String(code.rate),
          basePercent: String(code.base_percent),
          accountId: code.account_id,
          active: !!code.active,
          itemIds: code.item_ids ?? [],
        }}
        validate={(v) => ({
          ...(!v.name.trim() ? { name: 'Enter a name.' } : {}),
          ...(!valid(v.rate) ? { rate: 'Between 0 and 100.' } : {}),
          ...(!valid(v.basePercent) ? { basePercent: 'Between 0 and 100.' } : {}),
        })}
        onSubmit={(values, { setSubmitting }) =>
          save
            .mutateAsync(values)
            .then(() => {
              AppToaster.show({ message: 'The tax has been saved.', intent: Intent.SUCCESS });
              onClose();
            })
            .catch((e) => AppToaster.show({ message: e?.data?.errors?.[0]?.message ?? 'The tax could not be saved.', intent: Intent.DANGER }))
            .finally(() => setSubmitting(false))
        }
      >
        {({ values, setFieldValue, isSubmitting }) => (
          <Form>
            <div className={Classes.DIALOG_BODY} data-testid="excise-tax-code-form">
              <Stack spacing={8}>
                <FFormGroup name={'name'} label={'Name'}>
                  <FInputGroup name={'name'} />
                </FFormGroup>
                <FFormGroup name={'nameKm'} label={'Name in Khmer'}>
                  <FInputGroup name={'nameKm'} />
                </FFormGroup>
                <div style={{ display: 'flex', gap: 10 }}>
                  <FFormGroup name={'rate'} label={'Rate (%)'} style={{ flex: 1 }}>
                    <FInputGroup name={'rate'} inputMode={'decimal'} />
                  </FFormGroup>
                  <FFormGroup
                    name={'basePercent'}
                    label={'Base (% of the line)'}
                    style={{ flex: 1 }}
                    helperText={code.kind === 'plt' ? 'A reseller pays PLT on 20% of the price.' : 'Usually 100%.'}
                  >
                    <FInputGroup name={'basePercent'} inputMode={'decimal'} />
                  </FFormGroup>
                </div>
                <FFormGroup name={'accountId'} label={'Payable account'}>
                  <FSelect name={'accountId'} items={payableAccounts} valueAccessor={'value'} textAccessor={'label'} popoverProps={{ minimal: true }} />
                </FFormGroup>
                <Switch checked={values.active} label={'Active (inactive taxes are not charged on new invoices)'} onChange={(e) => setFieldValue('active', e.currentTarget.checked)} />

                <div>
                  <strong>Items charged this tax ({values.itemIds.length})</strong>
                  {code.kind !== 'plt' ? (
                    <div className={Classes.TEXT_MUTED} style={{ fontSize: 12 }}>
                      An item has one Specific or Accommodation Tax: ticking it here moves it from another one.
                    </div>
                  ) : null}
                  <InputGroup leftIcon={'search'} placeholder={'Search items'} value={search} onChange={(e) => setSearch(e.target.value)} small style={{ margin: '6px 0' }} />
                  <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid rgba(0,0,0,.12)', borderRadius: 3, padding: '4px 8px' }}>
                    {shown.map((item) => (
                      <Checkbox
                        key={item.id}
                        checked={values.itemIds.includes(item.id)}
                        label={item.code ? `${item.name} (${item.code})` : item.name}
                        onChange={(e) =>
                          setFieldValue('itemIds', e.currentTarget.checked ? [...values.itemIds, item.id] : values.itemIds.filter((id) => id !== item.id))
                        }
                      />
                    ))}
                    {shown.length === 0 ? <div className={Classes.TEXT_MUTED}>No items.</div> : null}
                  </div>
                </div>
              </Stack>
            </div>
            <div className={Classes.DIALOG_FOOTER}>
              <div className={Classes.DIALOG_FOOTER_ACTIONS}>
                <Button onClick={onClose}>Cancel</Button>
                <Button intent={Intent.PRIMARY} type={'submit'} loading={isSubmitting}>
                  Save
                </Button>
              </div>
            </div>
          </Form>
        )}
      </Formik>
    </Dialog>
  );
}
