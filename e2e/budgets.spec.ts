import { test, expect, type Page } from '@playwright/test';
import { faker } from '@faker-js/faker';
import { createExpenseViaApi, fetchAccounts, readApiAuth } from './_api';

/**
 * 103 DiTech budgeting (Phase 3 acceptance, docs/ditech/budgeting/phase-1-design.md §8):
 * build a 12-month budget by pasting from a spreadsheet, save, reload; bad
 * cells and bad import rows are shown and nothing wrong is saved.
 */
const API_BASE = process.env.PLAYWRIGHT_TEST_API_URL || process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://localhost:3000';

async function api(path: string) {
  const auth = readApiAuth();
  const res = await fetch(`${API_BASE}/api${path}`, {
    headers: { authorization: `Bearer ${auth.accessToken}`, 'organization-id': auth.organizationId },
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function apiSend(path: string, method: string, body: unknown) {
  const auth = readApiAuth();
  const res = await fetch(`${API_BASE}/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${auth.accessToken}`, 'organization-id': auth.organizationId },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function createBudgetViaUi(page: Page, name: string) {
  await page.goto('/budgets');
  await page.getByTestId('new-budget').first().click();
  const dialog = page.getByRole('dialog', { name: 'New budget' });
  await dialog.getByPlaceholder('e.g. Operating budget 2027').fill(name);
  await dialog.getByRole('button', { name: 'Create budget' }).click();
  await expect(page).toHaveURL(/\/budgets\/\d+$/, { timeout: 30_000 });
  await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 30_000 });
  return Number(page.url().split('/').pop());
}

async function addFirstLines(page: Page, count: number) {
  await page.getByTestId('add-lines').first().click();
  const dialog = page.getByRole('dialog', { name: 'Add lines' });
  const boxes = dialog.locator('input[type="checkbox"]:not([disabled])');
  await expect(boxes.first()).toBeVisible({ timeout: 30_000 });
  for (let i = 0; i < count; i++) await boxes.nth(i).check({ force: true });
  await dialog.getByRole('button', { name: new RegExp(`^Add ${count} lines?$`) }).click();
  await expect(page.getByTestId('budget-line')).toHaveCount(count);
}

/** Pastes tab-separated text on a cell, the way a spreadsheet copy arrives. */
async function pasteInto(page: Page, row: number, col: number, text: string) {
  const cell = page.locator(`input[data-row="${row}"][data-col="${col}"]`);
  await cell.click();
  await cell.evaluate((el, data) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', data);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, text);
}

test.describe('Budgets', () => {
  test('builds a 12-month budget from a pasted block and saves it', async ({ page }) => {
    const name = `Paste budget ${faker.string.alphanumeric(6)}`;
    const budgetId = await createBudgetViaUi(page, name);
    await addFirstLines(page, 2);

    const row1 = Array.from({ length: 12 }, (_, i) => String((i + 1) * 100)).join('\t'); // 100 … 1200 = 7,800
    const row2 = Array(12).fill('1,000.50').join('\t'); // 12,006.00
    await pasteInto(page, 0, 0, `${row1}\n${row2}\n`);

    await expect(page.getByTestId('unsaved-count')).toHaveText(/24 changed cells/);
    await page.getByTestId('save-budget').click();
    await expect(page.getByText('Budget saved.')).toBeVisible({ timeout: 30_000 });

    await page.reload();
    const lines = page.getByTestId('budget-line');
    await expect(lines).toHaveCount(2, { timeout: 30_000 });
    await expect(page.locator('tfoot')).toContainText('19,806.00');

    const detail = await api(`/budgets/${budgetId}/versions/1`);
    const totals = detail.lines.map((l: any) => l.total).sort((a: number, b: number) => a - b);
    expect(totals).toEqual([7800, 12006]);
    expect(detail.totals.grand.total).toBe(19806);
    expect(detail.version.lock_version).toBe(1);
  });

  test('marks a pasted cell that is not an amount and does not save it', async ({ page }) => {
    const budgetId = await createBudgetViaUi(page, `Bad paste ${faker.string.alphanumeric(6)}`);
    await addFirstLines(page, 1);
    await pasteInto(page, 0, 0, '100\tabc\t1.005\n');

    await expect(page.getByText(/2 cells are not a valid amount/)).toBeVisible();
    await expect(page.locator('input.is-invalid')).toHaveCount(2);
    await page.getByTestId('save-budget').click();
    await expect(page.getByText(/Fix the 2 cells marked in red first/)).toBeVisible();

    const detail = await api(`/budgets/${budgetId}/versions/1`);
    expect(detail.lines).toEqual([]);
  });

  test('previews an import file with a bad row and imports nothing', async ({ page }) => {
    const budgetId = await createBudgetViaUi(page, `Import ${faker.string.alphanumeric(6)}`);
    const budget = await api(`/budgets/${budgetId}`);
    const month = String(budget.months[0]).slice(0, 7);
    const accounts = await api('/accounts');
    const income = (Array.isArray(accounts) ? accounts : accounts.accounts).find((a: any) => a.account_type === 'income');

    await page.getByRole('button', { name: 'Import' }).click();
    const dialog = page.getByRole('dialog', { name: 'Import from Excel or CSV' });
    await dialog.locator('input[type="file"]').setInputFiles({
      name: 'budget.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(`Account code,${month}\n${income.code},500\nNO-SUCH-CODE,10\n`),
    });
    await dialog.getByRole('button', { name: 'Check file' }).click();
    await expect(dialog.getByText(/2 rows: 1 ready, 1 with errors/)).toBeVisible({ timeout: 30_000 });
    await expect(dialog.getByText('No account "NO-SUCH-CODE".')).toBeVisible();
    await expect(dialog.getByRole('button', { name: /^Import/ })).toBeDisabled();

    const detail = await api(`/budgets/${budgetId}/versions/1`);
    expect(detail.lines).toEqual([]);
  });

  test('budget vs actual: a posted expense against its budget, exceptions, drill-down and export', async ({ page }) => {
    const auth = readApiAuth();
    const rent = (await fetchAccounts(API_BASE, auth)).find((a) => a.name === 'Rent');
    if (!rent) throw new Error('No Rent account in the seeded chart.');
    await createExpenseViaApi(API_BASE, auth, { referenceNo: `BVA-${faker.string.alphanumeric(6)}`, amount: 450, paymentDate: '2036-03-15' });
    const name = `BvA ${faker.string.alphanumeric(6)}`;
    const budget = await apiSend('/budgets', 'POST', { name, type: 'profit_loss', fiscalYear: 2036, startDate: '2036-01-01', endDate: '2036-12-31' });
    await apiSend(`/budgets/${budget.id}/versions/1/lines`, 'PUT', { lockVersion: 0, lines: [{ accountId: rent.id, amounts: [{ month: '2036-03', amount: 300 }] }] });

    // From the editor.
    await page.goto(`/budgets/${budget.id}`);
    await page.getByTestId('open-reports').click();
    await expect(page).toHaveURL(new RegExp(`/budgets/${budget.id}/reports`));
    const rentRow = page.getByTestId('report-row').filter({ hasText: 'Rent' }).first();
    await expect(rentRow).toContainText('300.00', { timeout: 30_000 });
    await expect(rentRow).toContainText('450.00');
    await expect(rentRow).toContainText('150.00'); // variance
    await expect(rentRow).toContainText('50%');
    await expect(page.locator('tfoot')).toContainText('Net income');

    // Expense utilization marks it over budget; exceptions lists it.
    await page.getByTestId('report-select').selectOption('expense-utilization');
    await expect(page.getByTestId('report-row').filter({ hasText: 'Rent' }).first()).toContainText('Over budget', { timeout: 30_000 });
    await page.getByTestId('report-select').selectOption('exceptions');
    await expect(page.getByTestId('report-row').filter({ hasText: 'Rent' }).first()).toBeVisible({ timeout: 30_000 });

    // Monthly view keeps the filters in the URL.
    await page.getByTestId('report-select').selectOption('monthly-variance');
    await expect(page).toHaveURL(/report=monthly-variance/);
    await expect(page.locator('th.period').first()).toHaveText('Jan 2036', { timeout: 30_000 });

    // Export downloads a file.
    await page.getByRole('button', { name: 'Export' }).click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByText('Excel (.xlsx)').click()]);
    expect(download.suggestedFilename()).toMatch(/monthly-variance\.xlsx$/);

    // Drill-down opens the General Ledger for the account and period.
    await page.getByTestId('report-select').selectOption('budget-vs-actual');
    await page.getByRole('link', { name: 'General Ledger for Rent' }).first().click();
    await expect(page).toHaveURL(new RegExp(`/financial-reports/general-ledger\\?.*accountsIds=${rent.id}`));
    await expect(page).toHaveURL(/fromDate=2036-01-01/);
  });
});
