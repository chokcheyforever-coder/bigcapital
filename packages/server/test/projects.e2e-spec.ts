import request = require('supertest');
import { faker } from '@faker-js/faker';
import { app } from './init-app-test';
import {
  authHeaders,
  cancelTransactionsLock,
  createCustomer,
  createServiceItem,
  createVendor,
  getBaseCurrency,
} from './_utils/gl';
import { findNode } from './_utils/balance-sheet';

/**
 * Projects as an accounting dimension (DiTech, docs/ditech/budgeting/phase-1-design.md §8a).
 * Every document type posts with a fresh project; the P&L filtered by that
 * project must equal the hand-computed total of exactly those lines.
 */
describe('Projects (e2e)', () => {
  const http = () => request(app.getHttpServer());
  const DATE = '2024-06-15';
  const PERIOD = { fromDate: '2024-01-01', toDate: '2024-12-31' };

  let customerId: number;
  let vendorId: number;
  let itemId: number;

  const createProject = async (overrides: Record<string, any> = {}) => {
    const res = await http()
      .post('/projects')
      .set(authHeaders())
      .send({ name: `Project ${faker.string.alphanumeric(8)}`, ...overrides })
      .expect(201);
    return res.body;
  };

  const netIncome = async (projectId: number) => {
    const res = await http()
      .get('/reports/profit-loss-sheet')
      .query({ ...PERIOD, projectsIds: [projectId] })
      .set(authHeaders());
    if (res.status !== 200) throw new Error(`P&L ${res.status}: ${JSON.stringify(res.body)}`);
    return Number(findNode(res.body.data, 'NET_INCOME')?.total?.amount ?? 0);
  };

  const invoice = (projectId: number | undefined, rate: number) =>
    http()
      .post('/sale-invoices')
      .set(authHeaders())
      .send({
        customerId,
        invoiceDate: DATE,
        dueDate: DATE,
        invoiceNo: faker.string.uuid(),
        delivered: true,
        branchId: 1,
        warehouseId: 1,
        projectId,
        entries: [{ index: 1, itemId, quantity: 1, rate }],
      });

  beforeAll(async () => {
    await cancelTransactionsLock();
    const baseCurrency = await getBaseCurrency();
    customerId = await createCustomer(baseCurrency);
    vendorId = await createVendor(baseCurrency);
    itemId = await createServiceItem();
  });

  describe('CRUD', () => {
    it('creates, lists, edits and closes a project', async () => {
      const code = `PRJ-${faker.string.alphanumeric(6)}`;
      const project = await createProject({ code, contactId: customerId, startDate: '2024-01-01', deadline: '2024-12-31' });
      expect(project).toMatchObject({ code, contact_id: customerId, status: 'active', start_date: '2024-01-01', deadline: '2024-12-31' });
      expect(project.customer_name).toBeTruthy();

      const list = await http().get('/projects').query({ search: code }).set(authHeaders()).expect(200);
      expect(list.body.map((p) => p.id)).toEqual([project.id]);

      const closed = await http()
        .put(`/projects/${project.id}`)
        .set(authHeaders())
        .send({ name: project.name, code, status: 'closed' })
        .expect(200);
      expect(closed.body.status).toBe('closed');

      const active = await http().get('/projects').query({ status: 'active', search: code }).set(authHeaders()).expect(200);
      expect(active.body).toEqual([]);
    });

    it('refuses a duplicate code and an unknown customer', async () => {
      const code = `PRJ-${faker.string.alphanumeric(6)}`;
      await createProject({ code });
      const dup = await http().post('/projects').set(authHeaders()).send({ name: 'Dup', code }).expect(400);
      expect(dup.body.errors[0].type).toBe('PROJECT_CODE_EXISTS');

      const noCustomer = await http().post('/projects').set(authHeaders()).send({ name: 'X', contactId: 999999 }).expect(400);
      expect(noCustomer.body.errors[0].type).toBe('PROJECT_CUSTOMER_NOT_FOUND');
    });

    it('returns 404 for an unknown project', async () => {
      await http().get('/projects/999999').set(authHeaders()).expect(404);
    });
  });

  describe('ledger and P&L by project', () => {
    it('tags every document type and the P&L by project matches exactly', async () => {
      const project = await createProject();
      const projectId = project.id;
      expect(await netIncome(projectId)).toBe(0);

      // Income: invoice 1,000 + receipt 2,000 − credit note 300.
      await invoice(projectId, 1000).expect(201);
      await http()
        .post('/sale-receipts')
        .set(authHeaders())
        .send({
          customerId, depositAccountId: 1000, receiptDate: DATE, receiptNumber: faker.string.uuid(),
          closed: true, branchId: 1, warehouseId: 1, projectId,
          entries: [{ index: 1, itemId, quantity: 1, rate: 2000 }],
        })
        .expect(201);
      await http()
        .post('/credit-notes')
        .set(authHeaders())
        .send({
          customerId, creditNoteDate: DATE, open: true, branchId: 1, warehouseId: 1, projectId,
          entries: [{ index: 1, itemId, quantity: 1, rate: 300 }],
        })
        .expect(201);

      // Costs: bill 400 − vendor credit 100.
      await http()
        .post('/bills')
        .set(authHeaders())
        .send({
          vendorId, billDate: DATE, dueDate: DATE, billNumber: faker.string.alphanumeric(10),
          open: true, branchId: 1, warehouseId: 1, projectId,
          entries: [{ index: 1, itemId, quantity: 1, rate: 400 }],
        })
        .expect(201);
      await http()
        .post('/vendor-credits')
        .set(authHeaders())
        .send({
          vendorId, exchangeRate: 1, vendorCreditNumber: faker.string.uuid(), vendorCreditDate: DATE,
          open: true, branchId: 1, warehouseId: 1, projectId,
          entries: [{ index: 1, itemId, quantity: 1, rate: 100 }],
        })
        .expect(201);

      // Line level: expense 150 on the project + 50 without; journal 70 on the project.
      await http()
        .post('/expenses')
        .set(authHeaders())
        .send({
          exchangeRate: 1, paymentAccountId: 1000, referenceNo: faker.string.alphanumeric(10),
          publish: true, paymentDate: DATE, branchId: 1,
          categories: [
            { index: 1, expenseAccountId: 1021, amount: 150, projectId },
            { index: 2, expenseAccountId: 1021, amount: 50 },
          ],
        })
        .expect(201);
      await http()
        .post('/manual-journals')
        .set(authHeaders())
        .send({
          date: DATE, journalNumber: `PRJ-${Date.now()}`, reference: faker.string.uuid(), publish: true, branchId: 1,
          entries: [
            { index: 1, accountId: 1021, debit: 70, credit: 0, projectId },
            { index: 2, accountId: 1000, debit: 0, credit: 70 },
          ],
        })
        .expect(201);

      // A document without a project must not count.
      const untagged = await invoice(undefined, 5000).expect(201);

      // 1000 + 2000 − 300 − 400 + 100 − 150 − 70 = 2180
      expect(await netIncome(projectId)).toBeCloseTo(2180, 2);

      // The General Ledger filtered by the project lists only its rows.
      const gl = await http()
        .get('/reports/general-ledger')
        .query({ ...PERIOD, projectsIds: [projectId] })
        .set(authHeaders());
      if (gl.status !== 200) throw new Error(`GL ${gl.status}: ${JSON.stringify(gl.body)}`);
      const glRows = (gl.body.data ?? []).flatMap((account) => account.transactions ?? []);
      expect(glRows.length).toBeGreaterThan(0);
      expect(
        glRows.some((row) => row.reference_type === 'SaleInvoice' && row.reference_id === untagged.body.id),
      ).toBe(false);
    });

    it('keeps the project when the document is edited and drops it when removed', async () => {
      const project = await createProject();
      const created = await invoice(project.id, 800).expect(201);
      expect(await netIncome(project.id)).toBeCloseTo(800, 2);

      const edit = (projectId: number | null, rate: number) =>
        http()
          .put(`/sale-invoices/${created.body.id}`)
          .set(authHeaders())
          .send({
            customerId, invoiceDate: DATE, dueDate: DATE, invoiceNo: faker.string.uuid(), delivered: true,
            branchId: 1, warehouseId: 1, projectId,
            entries: [{ index: 1, itemId, quantity: 1, rate }],
          });
      await edit(project.id, 900).expect(200);
      expect(await netIncome(project.id)).toBeCloseTo(900, 2);

      await http().delete(`/sale-invoices/${created.body.id}`).set(authHeaders()).expect(200);
      expect(await netIncome(project.id)).toBe(0);
    });
  });

  describe('validation', () => {
    it('refuses an unknown or closed project on new documents', async () => {
      const unknown = await invoice(999999, 100).expect(400);
      expect(unknown.body.errors[0].type).toBe('PROJECT_NOT_FOUND');

      const project = await createProject({ status: 'closed' });
      const closed = await invoice(project.id, 100).expect(400);
      expect(closed.body.errors[0].type).toBe('PROJECT_CLOSED');

      const expense = await http()
        .post('/expenses')
        .set(authHeaders())
        .send({
          exchangeRate: 1, paymentAccountId: 1000, publish: true, paymentDate: DATE, branchId: 1,
          categories: [{ index: 1, expenseAccountId: 1021, amount: 10, projectId: project.id }],
        })
        .expect(400);
      expect(expense.body.errors[0].type).toBe('PROJECT_CLOSED');
    });

    it('still lets a document that already used a project be edited after the project closes', async () => {
      const project = await createProject();
      const created = await invoice(project.id, 100).expect(201);
      await http().put(`/projects/${project.id}`).set(authHeaders()).send({ name: project.name, status: 'closed' }).expect(200);

      await http()
        .put(`/sale-invoices/${created.body.id}`)
        .set(authHeaders())
        .send({
          customerId, invoiceDate: DATE, dueDate: DATE, invoiceNo: faker.string.uuid(), delivered: true,
          branchId: 1, warehouseId: 1, projectId: project.id,
          entries: [{ index: 1, itemId, quantity: 1, rate: 120 }],
        })
        .expect(200);
    });

    it('deletes an unused project but not one with transactions', async () => {
      const unused = await createProject();
      await http().delete(`/projects/${unused.id}`).set(authHeaders()).expect(200);
      await http().get(`/projects/${unused.id}`).set(authHeaders()).expect(404);

      const used = await createProject();
      await invoice(used.id, 100).expect(201);
      const res = await http().delete(`/projects/${used.id}`).set(authHeaders()).expect(400);
      expect(res.body.errors[0].type).toBe('PROJECT_HAS_TRANSACTIONS');
    });
  });
});
