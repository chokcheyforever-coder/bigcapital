import { test, expect } from '@playwright/test';
import { faker } from '@faker-js/faker';
import { createCustomerViaApi, createItemViaApi, readApiAuth } from './_api';
import { selectCustomer, selectEntryItem, waitForInvoiceForm } from './_invoices';

/**
 * 103 DiTech price levels in the browser: the level shows on the Price levels
 * page, a customer's default level fills an invoice's header and line rate,
 * and the saved invoice carries both. The formula itself is checked by the
 * server tests (design §6).
 */
const API_BASE = process.env.PLAYWRIGHT_TEST_API_URL || process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://localhost:3000';

async function apiSend(path: string, method: string, body?: unknown) {
  const auth = readApiAuth();
  const res = await fetch(`${API_BASE}/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${auth.accessToken}`, 'organization-id': auth.organizationId },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

test.describe('Price levels', () => {
  test('a customer\'s price level fills the invoice rates', async ({ page }) => {
    const run = faker.string.alphanumeric(6);
    const auth = readApiAuth();
    const itemName = `Laptop PL ${run}`;
    const customerName = `Wholesale customer ${run}`;
    const levelName = `Wholesale ${run}`;

    await createItemViaApi(API_BASE, auth, { name: itemName, type: 'service', sellPrice: 900, costPrice: 650 });
    const customer = await createCustomerViaApi(API_BASE, auth, { displayName: customerName });
    const level = await apiSend('/price-levels', 'POST', { name: levelName, type: 'sales', method: 'percentage', percentage: -15, rounding: 'x.99' });
    await apiSend(`/price-levels/${level.id}/assign`, 'POST', { contactIds: [customer.id] });

    await page.goto('/price-levels');
    const row = page.getByRole('row', { name: new RegExp(levelName) });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row).toContainText('−15% (ends in .99)');
    await expect(row).toContainText('1 customers');

    await page.goto('/invoices/new');
    await waitForInvoiceForm(page, 'New Invoice');
    await selectCustomer(page, customerName);
    await expect(page.getByRole('button', { name: `Price level: ${levelName}` })).toBeVisible({ timeout: 30_000 });

    await selectEntryItem(page, itemName);
    // 900 − 15% = 765, ending in .99.
    await expect
      .poll(() => page.evaluate(() => Array.from(document.querySelectorAll('input')).some((i) => i.value.replace(/,/g, '') === '764.99')), { timeout: 30_000 })
      .toBe(true);

    const createRequest = page.waitForRequest(
      (req) => new URL(req.url()).pathname === '/api/sale-invoices' && req.method() === 'POST',
      { timeout: 20_000 },
    );
    await page.getByRole('button', { name: 'Save as Draft' }).click();
    const body = (await createRequest).postDataJSON();
    expect(body.price_level_id ?? body.priceLevelId).toBe(level.id);
    expect(Number(body.entries[0].rate)).toBe(764.99);
  });
});
