import request = require('supertest');
import { faker } from '@faker-js/faker';
import { app } from './init-app-test';
import { authHeaders, cancelTransactionsLock, createCustomer, createServiceItem, getBaseCurrency } from './_utils/gl';

/**
 * Invoice designer (DiTech, docs/ditech/compliance/cambodia-invoicing-design.md §4):
 * a branding template's `layout` decides the order and visibility of the
 * printed blocks and table columns, the designer preview renders the same
 * HTML, and on a tax document the required blocks cannot be hidden.
 */
describe('Invoice designer (e2e)', () => {
  const http = () => request(app.getHttpServer());

  // Notes first, line items before the seller/buyer block, no totals, a custom
  // text, and the quantity column hidden.
  const layout = {
    version: 1,
    blocks: [
      { id: 'notes', visible: true },
      { id: 'header', visible: true },
      { id: 'lines', visible: true },
      { id: 'parties', visible: true },
      { id: 'totals', visible: false },
      { id: 'text1', visible: true, text: 'Pay to ABA 000 111 222' },
    ],
    columns: [
      { id: 'total', visible: true },
      { id: 'item', visible: true },
      { id: 'quantity', visible: false },
      { id: 'rate', visible: true },
    ],
    fontSize: 13,
  };
  const attributes = { termsConditions: 'TERMS-MARK', statement: 'STATEMENT-MARK', billedToLabel: 'BILLED-MARK', totalLabel: 'TOTAL-MARK', lineQuantityLabel: 'QTY-MARK', lineTotalLabel: 'AMOUNT-MARK', lineItemLabel: 'ITEM-MARK' };

  const preview = async (body: Record<string, any>) => {
    const res = await http().post('/tax-compliance/preview/invoice').set(authHeaders()).send({ attributes: body }).expect(200);
    return (res.body.html_content ?? res.body.htmlContent) as string;
  };
  const before = (html: string, a: string, b: string) => html.indexOf(a) >= 0 && html.indexOf(b) >= 0 && html.indexOf(a) < html.indexOf(b);

  beforeAll(async () => {
    await cancelTransactionsLock();
  });

  it('the preview follows the layout: order, hidden blocks and columns, custom text, font size', async () => {
    const html = await preview({ ...attributes, layout });
    expect(before(html, 'TERMS-MARK', 'ITEM-MARK')).toBe(true); // notes first
    expect(before(html, 'ITEM-MARK', 'BILLED-MARK')).toBe(true); // lines before parties
    expect(before(html, 'AMOUNT-MARK', 'ITEM-MARK')).toBe(true); // amount column first
    expect(html).not.toContain('QTY-MARK');
    expect(html).not.toContain('TOTAL-MARK');
    expect(html).toContain('Pay to ABA 000 111 222');
    expect(html).toContain('font-size:13px');
  });

  it('without a layout the preview keeps the default order', async () => {
    const html = await preview(attributes);
    expect(before(html, 'ITEM-MARK', 'TERMS-MARK')).toBe(true);
    expect(before(html, 'BILLED-MARK', 'ITEM-MARK')).toBe(true);
    expect(html).toContain('QTY-MARK');
    expect(html).toContain('TOTAL-MARK');
  });

  it('a saved template layout is what the invoice prints', async () => {
    const template = await http()
      .post('/pdf-templates')
      .set(authHeaders())
      .send({ resource: 'SaleInvoice', templateName: `Designer ${faker.string.alphanumeric(6)}`, attributes: { ...attributes, layout } })
      .expect(201);
    const templateId = template.body.data?.id ?? template.body.id;
    const customerId = await createCustomer(await getBaseCurrency());
    const itemId = await createServiceItem();
    const invoice = await http()
      .post('/sale-invoices')
      .set(authHeaders())
      .send({
        customerId, invoiceDate: '2026-11-15', dueDate: '2026-11-15', invoiceNo: faker.string.uuid(), delivered: false,
        branchId: 1, warehouseId: 1, pdfTemplateId: templateId, entries: [{ index: 1, itemId, quantity: 1, rate: 10 }],
      })
      .expect(201);
    const res = await http().get(`/sale-invoices/${invoice.body.id}`).set(authHeaders()).set('accept', 'application/json+html').expect(200);
    const html: string = res.body.html_content ?? res.body.htmlContent;
    expect(html).toContain('Pay to ABA 000 111 222');
    expect(html).not.toContain('QTY-MARK');
  });

  it('receipts and credit notes follow the layout too', async () => {
    for (const document of ['receipt', 'credit-note']) {
      const res = await http()
        .post(`/tax-compliance/preview/${document}`)
        .set(authHeaders())
        .send({ attributes: { ...attributes, layout } })
        .expect(200);
      const html: string = res.body.html_content ?? res.body.htmlContent;
      expect(html).toContain('Pay to ABA 000 111 222');
      expect(before(html, 'TERMS-MARK', 'ITEM-MARK')).toBe(true);
      expect(before(html, 'AMOUNT-MARK', 'ITEM-MARK')).toBe(true);
      expect(html).not.toContain('QTY-MARK');
    }
    await http().post('/tax-compliance/preview/bill').set(authHeaders()).send({ attributes: {} }).expect(400);
  });

  describe('with Cambodian tax documents on', () => {
    beforeAll(async () => {
      await http()
        .put('/tax-compliance/profile')
        .set(authHeaders())
        .send({ enabled: true, tin: 'K001-100000001', taxpayerSize: 'medium', vatRegistered: true, rateSource: 'gdt_monthly', gdtRates: [] })
        .expect(200);
    });

    afterAll(async () => {
      await http().put('/tax-compliance/profile').set(authHeaders()).send({ enabled: false, vatRegistered: false }).expect(200);
    });

    it('locks the required blocks and columns on and shows the sample tax block', async () => {
      const locked = {
        ...layout,
        blocks: [...layout.blocks.filter((b) => b.id !== 'parties'), { id: 'parties', visible: false }],
      };
      const html = await preview({ ...attributes, layout: locked });
      expect(html).toContain('វិក្កយបត្រអាករ'); // sample VAT invoice title
      expect(html).toContain('K001-100000001'); // parties shown although hidden
      expect(html).toContain('K001-000000000'); // sample buyer TIN
      expect(html).toContain('Grand Total'); // totals forced on (bilingual label)
    });

    it('the sample endpoint answers with the tax block', async () => {
      const res = await http().get('/tax-compliance/sample').set(authHeaders()).expect(200);
      expect(res.body).toMatchObject({ seller: { tin: 'K001-100000001' }, buyer: { tin: 'K001-000000000' } });
    });
  });
});
