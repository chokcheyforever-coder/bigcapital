// @ts-nocheck
// 103 DiTech part C: Reports › Tax reports. The monthly Cambodian tax figures
// (filed by the 20th of the next month): withholding tax, and the VAT books
// and return worksheet.
import { useState } from 'react';
import moment from 'moment';
import { Card, InputGroup, Tab, Tabs } from '@blueprintjs/core';
import { DashboardPageContent } from '@/components';
import { WithholdingTaxTab } from './WithholdingTaxTab';
import { VatBooksTab } from './VatBooksTab';
import { ReturnWorksheetTab } from './ReturnWorksheetTab';

export const TAX_REPORT_TABS = [
  { id: 'return', title: 'Monthly return', Component: ReturnWorksheetTab },
  { id: 'vat', title: 'VAT books', Component: VatBooksTab },
  { id: 'wht', title: 'Withholding tax', Component: WithholdingTaxTab },
];

export function TaxReportsPage() {
  const [month, setMonth] = useState(moment().subtract(1, 'month').format('YYYY-MM'));
  const [tab, setTab] = useState(TAX_REPORT_TABS[0].id);

  return (
    <DashboardPageContent>
      <div style={{ padding: 20, maxWidth: 1200 }} data-testid="tax-reports">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <label htmlFor={'tax-report-month'}>Month</label>
          <InputGroup id={'tax-report-month'} type={'month'} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} style={{ width: 180 }} />
        </div>
        <Card>
          <Tabs id={'tax-reports-tabs'} selectedTabId={tab} onChange={setTab} renderActiveTabPanelOnly>
            {TAX_REPORT_TABS.map(({ id, title, Component }) => (
              <Tab key={id} id={id} title={title} panel={<Component month={month} />} />
            ))}
          </Tabs>
        </Card>
      </div>
    </DashboardPageContent>
  );
}

export default TaxReportsPage;
