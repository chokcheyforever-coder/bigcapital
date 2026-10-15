import { test, expect, type Page } from '@playwright/test';
import { faker } from '@faker-js/faker';
import { readApiAuth } from './_api';

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
});
