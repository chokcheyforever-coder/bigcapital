// @ts-nocheck
// 103 DiTech part C3: Reports › Tax reports › Monthly return. What the
// month's return needs (VAT, withholding, 1% prepayment, Specific Tax, PLT,
// Accommodation Tax), and posting the prepayment journal.
import { Button, Callout, Classes, HTMLTable, Intent } from '@blueprintjs/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AppToaster } from '@/components';
import { useTaxApi } from '../compliance/useTaxApi';

const n = (v) => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Row({ label, value, strong = false, hint = null }) {
  return (
    <tr>
      <td>
        {strong ? <strong>{label}</strong> : label}
        {hint ? <div className={Classes.TEXT_MUTED} style={{ fontSize: 11 }}>{hint}</div> : null}
      </td>
      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{strong ? <strong>{value}</strong> : value}</td>
    </tr>
  );
}

export function ReturnWorksheetTab({ month }) {
  const api = useTaxApi();
  const queryClient = useQueryClient();
  const key = ['TAX_RETURN_WORKSHEET', month];
  const { data: s, isLoading, error } = useQuery({ queryKey: key, queryFn: () => api('GET', `/returns/worksheet?month=${month}`) });
  const post = useMutation({
    mutationFn: () => api('POST', `/returns/prepayment?month=${month}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  if (isLoading) return <div className={Classes.SKELETON} style={{ height: 300 }} />;
  if (error) return <Callout intent={'danger'}>The worksheet could not be loaded.</Callout>;
  const cur = s.currency_code;
  const vat = s.vat;

  return (
    <div data-testid="return-worksheet" style={{ maxWidth: 720 }}>
      <Callout icon={'calendar'} style={{ marginBottom: 12 }}>
        File and pay by <strong>{s.due_date}</strong>. Amounts in {cur}. This is a worksheet for the GDT e-Filing return, not a submission;
        check it with your accountant.
      </Callout>
      <HTMLTable compact style={{ width: '100%', marginBottom: 16 }}>
        <tbody>
          <tr>
            <th colSpan={2}>VAT</th>
          </tr>
          <Row label={'Taxable sales'} value={n(vat.taxable_sales)} />
          <Row label={'Non-taxable sales'} value={n(vat.non_taxable_sales)} />
          <Row label={'Output VAT'} value={n(vat.output_vat)} hint={vat.output_vat_khr !== null ? `${Number(vat.output_vat_khr).toLocaleString('en-US')} ៛` : null} />
          <Row label={'Taxable purchases'} value={n(vat.taxable_purchases)} />
          <Row label={'Input VAT'} value={n(vat.input_vat)} hint={vat.input_vat_khr !== null ? `${Number(vat.input_vat_khr).toLocaleString('en-US')} ៛` : null} />
          <Row label={vat.payable >= 0 ? 'VAT to pay' : 'VAT credit carried forward'} value={n(Math.abs(vat.payable))} strong />

          <tr>
            <th colSpan={2}>Withholding tax</th>
          </tr>
          {s.withholding.lines.length === 0 ? <Row label={'None this month'} value={n(0)} /> : null}
          {s.withholding.lines.map((l) => (
            <Row key={l.code} label={l.name} value={n(l.amount)} hint={`on ${n(l.base)}`} />
          ))}
          <Row label={'Withholding tax to pay'} value={n(s.withholding.total)} strong />

          <tr>
            <th colSpan={2}>Prepayment of tax on income</th>
          </tr>
          <Row label={'Turnover (excluding VAT)'} value={n(s.prepayment.turnover)} />
          <Row label={`Prepayment ${s.prepayment.rate}%`} value={n(s.prepayment.amount)} strong />

          <tr>
            <th colSpan={2}>Other taxes collected on sales</th>
          </tr>
          <Row label={'Specific Tax'} value={n(s.specific_tax)} />
          <Row label={'Accommodation Tax'} value={n(s.accommodation_tax)} />
          <Row label={'Public Lighting Tax'} value={n(s.public_lighting_tax)} />
        </tbody>
      </HTMLTable>

      {s.prepayment.posted ? (
        <Callout intent={Intent.SUCCESS} icon={'tick'}>
          The prepayment of {n(s.prepayment.posted.amount)} is posted as journal{' '}
          <Link to={`/manual-journals/${s.prepayment.posted.journal_id}/edit`}>{s.prepayment.posted.journal_number ?? `#${s.prepayment.posted.journal_id}`}</Link>.
        </Callout>
      ) : (
        <Button
          intent={Intent.PRIMARY}
          icon={'add'}
          disabled={!(s.prepayment.amount > 0)}
          loading={post.isPending}
          text={`Post the prepayment journal (${n(s.prepayment.amount)})`}
          onClick={() =>
            post
              .mutateAsync()
              .then(() => AppToaster.show({ message: 'The prepayment journal has been posted.', intent: Intent.SUCCESS }))
              .catch((e) => AppToaster.show({ message: e?.data?.errors?.[0]?.message ?? 'It could not be posted.', intent: Intent.DANGER }))
          }
        />
      )}
    </div>
  );
}
