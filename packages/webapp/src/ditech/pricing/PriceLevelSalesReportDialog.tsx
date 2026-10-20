// @ts-nocheck
import { useState } from 'react';
import moment from 'moment';
import { Classes, Dialog, FormGroup, HTMLTable, InputGroup, NonIdealState, Spinner } from '@blueprintjs/core';
import { usePriceLevelSalesReport } from '@/hooks/query/price-levels';

const money = (n: number) => Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Sales by price level: what the delivered invoices and closed receipts that
 * used a price level charged, against the items' normal prices.
 */
export function PriceLevelSalesReportDialog({ isOpen, onClose }) {
  const [fromDate, setFromDate] = useState(moment().startOf('year').format('YYYY-MM-DD'));
  const [toDate, setToDate] = useState(moment().format('YYYY-MM-DD'));
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(fromDate) && /^\d{4}-\d{2}-\d{2}$/.test(toDate) && fromDate <= toDate;
  const { data, isLoading } = usePriceLevelSalesReport({ fromDate, toDate }, { enabled: isOpen && valid });

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title={'Sales by price level'} style={{ width: 860 }}>
      <div className={Classes.DIALOG_BODY} data-testid="price-level-sales-report">
        <div style={{ display: 'flex', gap: 12 }}>
          <FormGroup label={'From'}>
            <InputGroup type={'date'} value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </FormGroup>
          <FormGroup label={'To'}>
            <InputGroup type={'date'} value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </FormGroup>
        </div>
        {isLoading ? (
          <Spinner size={30} />
        ) : !data || data.rows.length === 0 ? (
          <NonIdealState icon={'tag'} title={'No sales with a price level in this period'} />
        ) : (
          <HTMLTable compact striped style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Price level</th>
                <th>Customer</th>
                <th>Item</th>
                <th style={{ textAlign: 'right' }}>Qty</th>
                <th style={{ textAlign: 'right' }}>At normal prices</th>
                <th style={{ textAlign: 'right' }}>Charged</th>
                <th style={{ textAlign: 'right' }}>Difference</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={`${r.priceLevelId}-${r.customerId}-${r.itemId}`}>
                  <td>{r.priceLevelName}</td>
                  <td>{r.customerName}</td>
                  <td>{r.itemName}</td>
                  <td style={{ textAlign: 'right' }}>{r.quantity}</td>
                  <td style={{ textAlign: 'right' }}>{money(r.normalAmount)}</td>
                  <td style={{ textAlign: 'right' }}>{money(r.chargedAmount)}</td>
                  <td style={{ textAlign: 'right' }}>{money(r.difference)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th colSpan={4}>Total ({data.currencyCode})</th>
                <th style={{ textAlign: 'right' }}>{money(data.total.normalAmount)}</th>
                <th style={{ textAlign: 'right' }}>{money(data.total.chargedAmount)}</th>
                <th style={{ textAlign: 'right' }}>{money(data.total.difference)}</th>
              </tr>
            </tfoot>
          </HTMLTable>
        )}
      </div>
    </Dialog>
  );
}
