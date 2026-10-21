import request = require('supertest');
import { faker } from '@faker-js/faker';
import { app } from './init-app-test';
import { authHeaders, cancelTransactionsLock, createServiceItem, getBaseCurrency } from './_utils/gl';

/**
 * Cambodian tax documents (DiTech, docs/ditech/compliance/cambodia-invoicing-design.md):
 * the document type follows the seller's profile and the buyer, issuing needs
 * the TINs and a riel rate, issued documents cannot be deleted, and the PDF
 * prints the title, TINs and riel amounts. The profile is switched off again
 * at the end so other suites run as before.
 */
describe('Tax compliance (e2e)', () => {
  const http = () => request(app.getHttpServer());
  const DATE = '2026-11-15'; // uses the GDT rate of 2026-10
  const RATE = 4100;
  let baseCurrency: string;
  let itemId: number;

  const saveProfile = (overrides: Record<string, any> = {}) =>
    http()
      .put('/tax-compliance/profile')
      .set(authHeaders())
      .send({
        enabled: true,
        tin: 'K001-100000001',
        taxpayerSize: 'medium',
        vatRegistered: true,
        companyNameKm: 'ក្រុមហ៊ុន តេស្ត',
        addressKm: 'ភ្នំពេញ',
        addressEn: 'Phnom Penh',
        documentLanguage: 'km_en',
        rateSource: 'gdt_monthly',
        gdtRates: [{ month: '2026-10', rate: RATE }],
        signatoryName: 'Sok Dara',
        signatoryTitle: 'Director',
        ...overrides,
      });

  const customer = async (fields: Record<string, any>) => {
    const res = await http()
      .post('/customers')
      .set(authHeaders())
      .send({ displayName: `Tax customer ${faker.string.alphanumeric(8)}`, customerType: 'business', currencyCode: baseCurrency, ...fields })
      .expect(201);
    return res.body.id;
  };

  const invoice = (customerId: number, body: Record<string, any> = {}) =>
    http()
      .post('/sale-invoices')
      .set(authHeaders())
      .send({
        customerId, invoiceDate: DATE, dueDate: DATE, invoiceNo: faker.string.uuid(), delivered: true,
        branchId: 1, warehouseId: 1, entries: [{ index: 1, itemId, quantity: 2, rate: 100 }], ...body,
      });

  const saved = async (id: number) => (await http().get(`/sale-invoices/${id}`).set(authHeaders()).expect(200)).body;

  beforeAll(async () => {
    await cancelTransactionsLock();
    baseCurrency = await getBaseCurrency();
    itemId = await createServiceItem();
  });

  afterAll(async () => {
    await saveProfile({ enabled: false }).expect(200);
  });

  it('saves and reads the tax profile', async () => {
    const res = await saveProfile().expect(200);
    expect(res.body).toMatchObject({ enabled: true, tin: 'K001-100000001', taxpayer_size: 'medium', vat_registered: true, rate_source: 'gdt_monthly' });
    expect(res.body.gdt_rates).toEqual([{ month: '2026-10', rate: RATE }]);
    const read = await http().get('/tax-compliance/profile').set(authHeaders()).expect(200);
    expect(read.body.company_name_km).toBe('ក្រុមហ៊ុន តេស្ត');
  });

  it('a registered buyer with a TIN gets a VAT invoice; others a commercial invoice; both record the riel rate', async () => {
    const registered = await customer({ taxNumber: 'K001-200000002', registeredTaxpayer: true, displayNameKm: 'អតិថិជន' });
    const consumer = await customer({});

    const vat = await saved((await invoice(registered).expect(201)).body.id);
    expect(vat).toMatchObject({ document_kind: 'vat_invoice', khr_rate_source: 'gdt_monthly' });
    expect(Number(vat.khr_rate)).toBe(RATE);

    const commercial = await saved((await invoice(consumer).expect(201)).body.id);
    expect(commercial.document_kind).toBe('commercial_invoice');
  });

  it('refuses to issue without the buyer TIN on a VAT invoice or without a riel rate; drafts are fine', async () => {
    const noTin = await customer({ registeredTaxpayer: true });
    const refused = await invoice(noTin).expect(400);
    expect(refused.body.errors[0].type).toBe('BUYER_TIN_MISSING');
    await invoice(noTin, { delivered: false }).expect(201);

    const consumer = await customer({});
    const noRate = await invoice(consumer, { invoiceDate: '2026-03-10', dueDate: '2026-03-10' }).expect(400);
    expect(noRate.body.errors[0].type).toBe('KHR_RATE_MISSING');
  });

  it('refuses to delete an issued invoice; a draft can be deleted', async () => {
    const consumer = await customer({});
    const issued = (await invoice(consumer).expect(201)).body.id;
    const res = await http().delete(`/sale-invoices/${issued}`).set(authHeaders()).expect(400);
    expect(res.body.errors[0].type).toBe('TAX_DOCUMENT_ISSUED');
    const draft = (await invoice(consumer, { delivered: false }).expect(201)).body.id;
    await http().delete(`/sale-invoices/${draft}`).set(authHeaders()).expect(200);
  });

  it('prints the title, both TINs, riel amounts and signatures', async () => {
    const registered = await customer({ taxNumber: 'K001-300000003', registeredTaxpayer: true });
    const id = (await invoice(registered).expect(201)).body.id;
    const block = await http().get(`/tax-compliance/documents/sale-invoices/${id}`).query({ total: 200, tax: 0 }).set(authHeaders()).expect(200);
    expect(block.body).toMatchObject({ title: 'វិក្កយបត្រអាករ\nVAT Invoice', seller: { tin: 'K001-100000001' }, buyer: { tin: 'K001-300000003' } });
    expect(block.body.khr).toMatchObject({ total: '820,000 ៛' });
    const res = await http().get(`/sale-invoices/${id}`).set(authHeaders()).set('accept', 'application/json+html').expect(200);
    const html: string = res.body.html_content ?? res.body.htmlContent;
    expect(html).toContain('វិក្កយបត្រអាករ');
    expect(html).toContain('VAT Invoice');
    expect(html).toContain('K001-100000001');
    expect(html).toContain('K001-300000003');
    // 2 x 100 = 200 USD at 4,100: 820,000 riel.
    expect(html).toContain('820,000 ៛');
    expect(html).toContain('Sok Dara');
  });

  it('with the profile off, documents print and delete as before', async () => {
    await saveProfile({ enabled: false }).expect(200);
    const consumer = await customer({});
    const id = (await invoice(consumer).expect(201)).body.id;
    expect((await saved(id)).document_kind).toBeNull();
    await http().delete(`/sale-invoices/${id}`).set(authHeaders()).expect(200);
  });
});
