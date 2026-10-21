// @ts-nocheck
// 103 DiTech: Preferences › Tax compliance. The company's tax profile for
// Cambodian tax documents (docs/ditech/compliance/cambodia-invoicing-design.md).
import { useEffect } from 'react';
import { Button, Callout, Classes, HTMLTable, Intent, Switch } from '@blueprintjs/core';
import { FieldArray, Form, Formik } from 'formik';
import { useHistory } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppToaster, FFormGroup, FInputGroup, FTextArea, Stack } from '@/components';
import { FSelect } from '@/components/Forms';
import { withDashboardActions } from '@/containers/Dashboard/withDashboardActions';
import { useAuthOrganizationId, useAuthToken } from '@/hooks/state';

const SIZES = [
  { value: 'small', label: 'Small taxpayer' },
  { value: 'medium', label: 'Medium taxpayer' },
  { value: 'large', label: 'Large taxpayer' },
];
const LANGUAGES = [
  { value: 'km_en', label: 'Khmer, English below' },
  { value: 'km', label: 'Khmer only' },
  { value: 'en', label: 'English only' },
];
const RATE_SOURCES = [
  { value: 'nbc_daily', label: 'NBC daily rate (automatic)' },
  { value: 'gdt_monthly', label: "GDT monthly rate (previous month's, entered below)" },
];

function useTaxApi() {
  const token = useAuthToken();
  const organizationId = useAuthOrganizationId();
  return async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`/api/tax-compliance${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'organization-id': organizationId ?? '', 'content-type': 'application/json', accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw Object.assign(new Error('request failed'), { data, status: res.status });
    return data;
  };
}

const toForm = (p) => ({
  enabled: !!p?.enabled,
  tin: p?.tin ?? '',
  taxpayerSize: p?.taxpayer_size ?? 'medium',
  vatRegistered: !!p?.vat_registered,
  companyNameKm: p?.company_name_km ?? '',
  addressKm: p?.address_km ?? '',
  addressEn: p?.address_en ?? '',
  documentLanguage: p?.document_language ?? 'km_en',
  rateSource: p?.rate_source ?? 'nbc_daily',
  gdtRates: (p?.gdt_rates ?? []).map((r) => ({ month: r.month, rate: String(r.rate) })),
  signatoryName: p?.signatory_name ?? '',
  signatoryTitle: p?.signatory_title ?? '',
});

const toRequest = (v) => ({
  enabled: v.enabled,
  tin: v.tin.trim() || null,
  taxpayerSize: v.taxpayerSize,
  vatRegistered: v.vatRegistered,
  companyNameKm: v.companyNameKm.trim() || null,
  addressKm: v.addressKm.trim() || null,
  addressEn: v.addressEn.trim() || null,
  documentLanguage: v.documentLanguage,
  rateSource: v.rateSource,
  gdtRates: v.gdtRates.filter((r) => /^\d{4}-\d{2}$/.test(r.month) && Number(r.rate) > 0).map((r) => ({ month: r.month, rate: Number(r.rate) })),
  signatoryName: v.signatoryName.trim() || null,
  signatoryTitle: v.signatoryTitle.trim() || null,
});

function TaxCompliancePageInner({ changePreferencesPageTitle }) {
  const history = useHistory();
  const api = useTaxApi();
  const queryClient = useQueryClient();
  const { data: profile, isLoading } = useQuery({ queryKey: ['TAX_PROFILE'], queryFn: () => api('GET', '/profile') });
  const { data: rate } = useQuery({ queryKey: ['TAX_KHR_RATE'], queryFn: () => api('GET', '/khr-rate?currency=USD') });
  const save = useMutation({
    mutationFn: (body) => api('PUT', '/profile', body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['TAX_PROFILE'] }),
  });

  useEffect(() => {
    changePreferencesPageTitle('Tax compliance');
  }, [changePreferencesPageTitle]);

  if (isLoading) return <div className={Classes.SKELETON} style={{ height: 300 }} />;

  return (
    <Formik
      initialValues={toForm(profile)}
      enableReinitialize
      onSubmit={(values, { setSubmitting }) =>
        save
          .mutateAsync(toRequest(values))
          .then(() => AppToaster.show({ message: 'The tax profile has been saved.', intent: Intent.SUCCESS }))
          .catch((e) => AppToaster.show({ message: e?.data?.errors?.[0]?.message ?? 'The tax profile could not be saved.', intent: Intent.DANGER }))
          .finally(() => setSubmitting(false))
      }
    >
      {({ values, setFieldValue, isSubmitting }) => (
        <Form style={{ maxWidth: 720 }} data-testid="tax-compliance-form">
          <Stack spacing={14}>
            <Callout intent={Intent.PRIMARY} icon={'info-sign'}>
              Prints invoices, receipts and credit notes as Cambodian tax documents (Prakas 723): VAT invoice or commercial
              invoice, both TINs, amounts in riel with the exchange rate, Khmer above English, signatures. Issuing is
              refused while something required is missing, and issued documents can only be cancelled with a credit note.
              Receipts have no tax lines and always print as commercial invoices: use an invoice for a VAT invoice.
              Confirm the fields with your tax adviser.
            </Callout>

            <Switch
              large
              checked={values.enabled}
              label={'Issue Cambodian tax documents'}
              onChange={(e) => setFieldValue('enabled', e.currentTarget.checked)}
            />

            <FFormGroup name={'tin'} label={'Company TIN (VATTIN)'} inline helperText={'e.g. K001-123456789'}>
              <FInputGroup name={'tin'} />
            </FFormGroup>
            <FFormGroup name={'taxpayerSize'} label={'Taxpayer'} inline>
              <FSelect name={'taxpayerSize'} items={SIZES} valueAccessor={'value'} textAccessor={'label'} labelAccessor={'hint'} popoverProps={{ minimal: true }} />
            </FFormGroup>
            <Switch
              checked={values.vatRegistered}
              label={'Registered for VAT (medium and large taxpayers issue VAT invoices to registered customers)'}
              onChange={(e) => setFieldValue('vatRegistered', e.currentTarget.checked)}
            />

            <FFormGroup name={'companyNameKm'} label={'Company name in Khmer'} inline>
              <FInputGroup name={'companyNameKm'} />
            </FFormGroup>
            <FFormGroup name={'addressKm'} label={'Address in Khmer'} inline>
              <FTextArea name={'addressKm'} fill growVertically />
            </FFormGroup>
            <FFormGroup name={'addressEn'} label={'Address in English'} inline>
              <FTextArea name={'addressEn'} fill growVertically />
            </FFormGroup>

            <FFormGroup name={'documentLanguage'} label={'Language on documents'} inline>
              <FSelect name={'documentLanguage'} items={LANGUAGES} valueAccessor={'value'} textAccessor={'label'} labelAccessor={'hint'} popoverProps={{ minimal: true }} />
            </FFormGroup>

            <FFormGroup
              name={'rateSource'}
              label={'Riel exchange rate'}
              inline
              helperText={rate?.rate ? `Today: 1 USD = ${Number(rate.rate).toLocaleString('en-US')} ៛ (${rate.source === 'gdt_monthly' ? 'GDT monthly' : 'NBC daily'})` : 'No rate available right now.'}
            >
              <FSelect name={'rateSource'} items={RATE_SOURCES} valueAccessor={'value'} textAccessor={'label'} labelAccessor={'hint'} popoverProps={{ minimal: true }} />
            </FFormGroup>

            {values.rateSource === 'gdt_monthly' && (
              <FieldArray name={'gdtRates'}>
                {({ push, remove }) => (
                  <div>
                    <HTMLTable compact data-testid="gdt-rates">
                      <thead>
                        <tr>
                          <th>Month (YYYY-MM)</th>
                          <th>1 USD in riel</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {values.gdtRates.map((r, i) => (
                          <tr key={i}>
                            <td>
                              <FInputGroup name={`gdtRates[${i}].month`} small placeholder={'2026-09'} />
                            </td>
                            <td>
                              <FInputGroup name={`gdtRates[${i}].rate`} small inputMode={'decimal'} />
                            </td>
                            <td>
                              <Button minimal small icon={'cross'} onClick={() => remove(i)} aria-label={'Remove'} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </HTMLTable>
                    <Button minimal small icon={'plus'} text={'Add a month'} onClick={() => push({ month: '', rate: '' })} />
                  </div>
                )}
              </FieldArray>
            )}

            <FFormGroup name={'signatoryName'} label={'Signed by (name)'} inline>
              <FInputGroup name={'signatoryName'} />
            </FFormGroup>
            <FFormGroup name={'signatoryTitle'} label={'Title'} inline>
              <FInputGroup name={'signatoryTitle'} />
            </FFormGroup>

            <div>
              <Button intent={Intent.PRIMARY} type={'submit'} loading={isSubmitting}>
                Save
              </Button>{' '}
              <Button onClick={() => history.go(-1)}>Close</Button>
            </div>
          </Stack>
        </Form>
      )}
    </Formik>
  );
}

export const TaxCompliancePage = withDashboardActions(TaxCompliancePageInner);
export default TaxCompliancePage;
