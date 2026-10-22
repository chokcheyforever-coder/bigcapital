// @ts-nocheck
// 103 DiTech part C3: Reports › Tax reports › VAT books. The month's sales and
// purchase books in the GDT e-VAT layout, with an Excel export of both.
import { useState } from 'react';
import { Button, ButtonGroup, Callout, Classes, HTMLTable, NonIdealState } from '@blueprintjs/core';
import { useQuery } from '@tanstack/react-query';
import { useAuthOrganizationId, useAuthToken } from '@/hooks/state';
import { useTaxApi } from '../compliance/useTaxApi';

const n = (v) => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const riel = (v) => (v === null || v === undefined ? '—' : `${Number(v).toLocaleString('en-US')} ៛`);

export function VatBooksTab({ month }) {
  const api = useTaxApi();
  const token = useAuthToken();
  const organizationId = useAuthOrganizationId();
  const [book, setBook] = useState('sales');
  const { data: rows = [], isLoading, error } = useQuery({ queryKey: ['TAX_VAT_BOOK', book, month], queryFn: () => api('GET', `/vat-books/${book}?month=${month}`) });

  const exportBooks = async () => {
    const res = await fetch(`/api/tax-compliance/vat-books-export?month=${month}`, {
      headers: { Authorization: `Bearer ${token}`, 'organization-id': organizationId ?? '' },
    });
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `VAT-books-${month}.xlsx`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const total = (key) => rows.reduce((s, r) => s + (Number(r[key]) || 0), 0);
  const isSales = book === 'sales';

  return (
    <div data-testid="vat-books">
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 }}>
        <ButtonGroup>
          <Button active={isSales} onClick={() => setBook('sales')} text={'Sales book'} />
          <Button active={!isSales} onClick={() => setBook('purchases')} text={'Purchase book'} />
        </ButtonGroup>
        <Button icon={'export'} text={'Export both (Excel)'} onClick={exportBooks} />
      </div>
      <Callout icon={'info-sign'} style={{ marginBottom: 12 }}>
        {isSales
          ? 'Delivered invoices and closed receipts dated in the month. Receipts carry no VAT and are listed as non-taxable sales. Credit notes are not listed: BigCapital records them without VAT, so adjust the return for them by hand.'
          : 'Open bills dated in the month. Expenses carry no VAT and are not listed.'}{' '}
        Amounts are in the base currency, with riel at each document's rate. Check the columns against the current GDT e-VAT template before importing.
      </Callout>
      {isLoading ? (
        <div className={Classes.SKELETON} style={{ height: 200 }} />
      ) : error ? (
        <Callout intent={'danger'}>The book could not be loaded.</Callout>
      ) : rows.length === 0 ? (
        <NonIdealState icon={'book'} title={'Nothing this month'} />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <HTMLTable compact striped style={{ width: '100%', fontSize: 12 }}>
            <thead>
              <tr>
                <th>No.</th>
                <th>Date</th>
                <th>{isSales ? 'Invoice' : 'Bill'}</th>
                <th>{isSales ? 'Buyer' : 'Supplier'}</th>
                <th>TIN</th>
                <th style={{ textAlign: 'right' }}>Non-taxable</th>
                <th style={{ textAlign: 'right' }}>Taxable value</th>
                <th style={{ textAlign: 'right' }}>VAT</th>
                {isSales && <th style={{ textAlign: 'right' }}>Specific / Accom. / PLT</th>}
                <th style={{ textAlign: 'right' }}>Total</th>
                <th style={{ textAlign: 'right' }}>VAT (KHR)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.type}:${r.id}`}>
                  <td>{r.no}</td>
                  <td>{r.date}</td>
                  <td>
                    {r.number} {r.type === 'receipt' ? <span className={Classes.TEXT_MUTED}>(receipt)</span> : null}
                  </td>
                  <td>
                    {r.party_name}
                    {r.party_name_km ? <div className={Classes.TEXT_MUTED}>{r.party_name_km}</div> : null}
                  </td>
                  <td>{r.party_tin || <span className={Classes.TEXT_MUTED}>{r.party === 'taxpayer' ? 'missing' : '—'}</span>}</td>
                  <td style={{ textAlign: 'right' }}>{n(r.non_taxable)}</td>
                  <td style={{ textAlign: 'right' }}>{n(r.taxable)}</td>
                  <td style={{ textAlign: 'right' }}>{n(r.vat)}</td>
                  {isSales && <td style={{ textAlign: 'right' }}>{n(r.specific_tax + r.accommodation_tax + r.plt)}</td>}
                  <td style={{ textAlign: 'right' }}>{n(r.total)}</td>
                  <td style={{ textAlign: 'right' }}>{riel(r.vat_khr)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5}>
                  <strong>Total</strong>
                </td>
                <td style={{ textAlign: 'right' }}>{n(total('non_taxable'))}</td>
                <td style={{ textAlign: 'right' }}>{n(total('taxable'))}</td>
                <td style={{ textAlign: 'right' }}>
                  <strong>{n(total('vat'))}</strong>
                </td>
                {isSales && <td style={{ textAlign: 'right' }}>{n(total('specific_tax') + total('accommodation_tax') + total('plt'))}</td>}
                <td style={{ textAlign: 'right' }}>{n(total('total'))}</td>
                <td />
              </tr>
            </tfoot>
          </HTMLTable>
        </div>
      )}
    </div>
  );
}
