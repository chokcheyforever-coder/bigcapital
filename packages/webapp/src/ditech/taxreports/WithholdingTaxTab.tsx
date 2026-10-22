// @ts-nocheck
// 103 DiTech part C2: Reports › Tax reports › Withholding tax. The month's tax
// withheld by vendor and payment type, totals for the return, and each
// vendor's certificate.
import { Button, Callout, Classes, HTMLTable, NonIdealState } from '@blueprintjs/core';
import { useQuery } from '@tanstack/react-query';
import { useAuthOrganizationId, useAuthToken } from '@/hooks/state';
import { useTaxApi } from '../compliance/useTaxApi';

const money = (n, currency) => `${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency ?? ''}`.trim();

export function WithholdingTaxTab({ month }) {
  const api = useTaxApi();
  const token = useAuthToken();
  const organizationId = useAuthOrganizationId();
  const { data, isLoading, error } = useQuery({ queryKey: ['TAX_REPORT_WHT', month], queryFn: () => api('GET', `/wht?month=${month}`) });

  const openCertificate = async (vendorId) => {
    const win = window.open('', '_blank');
    const res = await api('GET', `/wht/certificate?vendorId=${vendorId}&month=${month}`);
    win?.document.write(res.html_content ?? res.htmlContent ?? '');
    win?.document.close();
  };
  const downloadPdf = async (vendorId, name) => {
    const res = await fetch(`/api/tax-compliance/wht/certificate?vendorId=${vendorId}&month=${month}`, {
      headers: { Authorization: `Bearer ${token}`, 'organization-id': organizationId ?? '', accept: 'application/pdf' },
    });
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `WHT-${name || vendorId}-${month}.pdf`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (isLoading) return <div className={Classes.SKELETON} style={{ height: 200 }} />;
  if (error) return <Callout intent={'danger'}>The withholding tax report could not be loaded.</Callout>;
  const cur = data.currency_code;

  return (
    <div data-testid="wht-report">
      <Callout icon={'calendar'} style={{ marginBottom: 12 }}>
        Tax withheld in {month}: <strong>{money(data.total, cur)}</strong>, to be paid to the GDT by <strong>{data.due_date}</strong>.
      </Callout>
      {data.lines.length === 0 ? (
        <NonIdealState icon={'document'} title={'No tax withheld this month'} description={'Choose a withholding tax on a bill or expense to see it here.'} />
      ) : (
        <>
          <HTMLTable compact striped style={{ width: '100%', marginBottom: 20 }}>
            <thead>
              <tr>
                <th>Vendor</th>
                <th>TIN</th>
                <th>Payment type</th>
                <th style={{ textAlign: 'right' }}>Documents</th>
                <th style={{ textAlign: 'right' }}>Amount paid</th>
                <th style={{ textAlign: 'right' }}>Rate</th>
                <th style={{ textAlign: 'right' }}>Withheld</th>
                <th>Certificate</th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map((l) => (
                <tr key={`${l.vendor_id}:${l.code_id}`}>
                  <td>{l.vendor_name || '—'}</td>
                  <td>{l.vendor_tin || <span className={Classes.TEXT_MUTED}>missing</span>}</td>
                  <td>{l.name}</td>
                  <td style={{ textAlign: 'right' }}>{l.documents.length}</td>
                  <td style={{ textAlign: 'right' }}>{money(l.base)}</td>
                  <td style={{ textAlign: 'right' }}>{l.rate}%</td>
                  <td style={{ textAlign: 'right' }}>{money(l.amount)}</td>
                  <td>
                    {l.vendor_id ? (
                      <>
                        <Button small minimal icon={'eye-open'} text={'View'} onClick={() => openCertificate(l.vendor_id)} />
                        <Button small minimal icon={'download'} text={'PDF'} onClick={() => downloadPdf(l.vendor_id, l.vendor_name)} />
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </HTMLTable>
          <h4 style={{ margin: '0 0 8px' }}>For the return</h4>
          <HTMLTable compact style={{ minWidth: 480 }}>
            <thead>
              <tr>
                <th>Payment type</th>
                <th style={{ textAlign: 'right' }}>Amount paid</th>
                <th style={{ textAlign: 'right' }}>Withheld</th>
              </tr>
            </thead>
            <tbody>
              {data.totals.map((t) => (
                <tr key={t.code_id}>
                  <td>
                    {t.name} <span className={Classes.TEXT_MUTED}>({t.code})</span>
                  </td>
                  <td style={{ textAlign: 'right' }}>{money(t.base)}</td>
                  <td style={{ textAlign: 'right' }}>{money(t.amount)}</td>
                </tr>
              ))}
              <tr>
                <td>
                  <strong>Total</strong>
                </td>
                <td />
                <td style={{ textAlign: 'right' }}>
                  <strong>{money(data.total, cur)}</strong>
                </td>
              </tr>
            </tbody>
          </HTMLTable>
        </>
      )}
    </div>
  );
}
