// @ts-nocheck
// 103 DiTech part C2: Preferences › Tax compliance › Withholding tax. Each
// payment type's rate, payable account and whether it is offered on bills
// and expenses. Documents keep the rate they were saved with.
import { useMemo, useState } from 'react';
import { Button, Callout, Classes, Dialog, HTMLTable, Intent, Switch } from '@blueprintjs/core';
import { Form, Formik } from 'formik';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AppToaster, FFormGroup, FInputGroup, Stack } from '@/components';
import { FSelect } from '@/components/Forms';
import { useAccounts } from '@/hooks/query';
import { useTaxApi } from '../compliance/useTaxApi';
import { useWhtCodes, WHT_CODES_QUERY_KEY } from './useWhtCodes';

export function WhtCodesSection() {
  const { data: codes = [], isLoading } = useWhtCodes();
  const { data: accounts = [] } = useAccounts();
  const [editing, setEditing] = useState(null);
  const accountName = (id) => accounts.find((a) => a.id === id)?.name ?? '—';

  return (
    <div style={{ maxWidth: 1010, margin: '32px 0 0', padding: '0 25px 20px' }} data-testid="wht-codes">
      <h3 style={{ margin: '0 0 10px' }}>Withholding tax</h3>
      <Stack spacing={10}>
        <Callout icon={'info-sign'}>
          Choose a rate on a bill or expense (or as a vendor's usual one) to keep the tax back from the vendor: the vendor is
          owed the rest and the tax goes to the payable account, to be paid by the 20th of the next month. Certificates
          and the monthly list are in Reports › Tax reports. Starting rates follow the Law on Taxation: check them with
          your tax adviser.
        </Callout>
        {isLoading ? (
          <div className={Classes.SKELETON} style={{ height: 160 }} />
        ) : (
          <HTMLTable compact striped style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Code</th>
                <th>Payment type</th>
                <th style={{ textAlign: 'right' }}>Rate</th>
                <th>Posts to</th>
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
                    {!code.active ? <div className={Classes.TEXT_MUTED} style={{ fontSize: 11 }}>inactive</div> : null}
                  </td>
                  <td style={{ textAlign: 'right' }}>{code.rate}%</td>
                  <td>{accountName(code.account_id)}</td>
                  <td>
                    <Button small minimal icon={'edit'} text={'Edit'} onClick={() => setEditing(code)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </HTMLTable>
        )}
      </Stack>
      <WhtCodeDialog code={editing} accounts={accounts} onClose={() => setEditing(null)} />
    </div>
  );
}

function WhtCodeDialog({ code, accounts, onClose }) {
  const api = useTaxApi();
  const queryClient = useQueryClient();
  const payableAccounts = useMemo(
    () =>
      accounts
        .filter((a) => a.accountType === 'tax-payable' || /liability/.test(a.accountType ?? ''))
        .map((a) => ({ value: a.id, label: a.code ? `${a.code} · ${a.name}` : a.name })),
    [accounts],
  );
  const save = useMutation({
    mutationFn: (values) =>
      api('PUT', `/wht-codes/${code.id}`, {
        name: values.name.trim(),
        nameKm: values.nameKm.trim() || null,
        rate: Number(values.rate),
        accountId: values.accountId ? Number(values.accountId) : undefined,
        active: values.active,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: WHT_CODES_QUERY_KEY }),
  });
  if (!code) return null;

  return (
    <Dialog isOpen={!!code} onClose={onClose} title={code.code} style={{ width: 520 }} canOutsideClickClose={false}>
      <Formik
        initialValues={{ name: code.name ?? '', nameKm: code.name_km ?? '', rate: String(code.rate), accountId: code.account_id, active: !!code.active }}
        validate={(v) => ({
          ...(!v.name.trim() ? { name: 'Enter a name.' } : {}),
          ...(v.rate === '' || Number.isNaN(Number(v.rate)) || Number(v.rate) < 0 || Number(v.rate) > 100 ? { rate: 'Between 0 and 100.' } : {}),
        })}
        onSubmit={(values, { setSubmitting }) =>
          save
            .mutateAsync(values)
            .then(() => {
              AppToaster.show({ message: 'The withholding tax has been saved.', intent: Intent.SUCCESS });
              onClose();
            })
            .catch((e) => AppToaster.show({ message: e?.data?.errors?.[0]?.message ?? 'It could not be saved.', intent: Intent.DANGER }))
            .finally(() => setSubmitting(false))
        }
      >
        {({ values, setFieldValue, isSubmitting }) => (
          <Form>
            <div className={Classes.DIALOG_BODY} data-testid="wht-code-form">
              <Stack spacing={8}>
                <FFormGroup name={'name'} label={'Payment type'}>
                  <FInputGroup name={'name'} />
                </FFormGroup>
                <FFormGroup name={'nameKm'} label={'In Khmer'}>
                  <FInputGroup name={'nameKm'} />
                </FFormGroup>
                <FFormGroup name={'rate'} label={'Rate (%)'}>
                  <FInputGroup name={'rate'} inputMode={'decimal'} />
                </FFormGroup>
                <FFormGroup name={'accountId'} label={'Payable account'}>
                  <FSelect name={'accountId'} items={payableAccounts} valueAccessor={'value'} textAccessor={'label'} popoverProps={{ minimal: true }} />
                </FFormGroup>
                <Switch checked={values.active} label={'Offered on bills and expenses'} onChange={(e) => setFieldValue('active', e.currentTarget.checked)} />
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
