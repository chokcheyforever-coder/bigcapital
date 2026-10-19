import { test, expect } from '@playwright/test';
import { faker } from '@faker-js/faker';
import { fetchAccounts, readApiAuth } from './_api';

/**
 * 103 DiTech budgeting Phase 6 (design §15) in the browser: make a forecast
 * from the Version menu, see forecast vs budget, open the dashboard and the
 * notifications tab. The amounts themselves are checked by the server e2e.
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

test.describe('Budget forecasts and dashboard', () => {
  test('forecast from the Version menu, forecast vs budget, dashboard', async ({ page }) => {
    const expense = (await fetchAccounts(API_BASE, readApiAuth())).find((a) => a.name === 'Rent')!;
    const name = `Forecast flow ${faker.string.alphanumeric(6)}`;
    const budget = await apiSend('/budgets', 'POST', { name, type: 'operating_expenses', fiscalYear: 2045, startDate: '2045-01-01', endDate: '2045-12-31' });
    await apiSend(`/budgets/${budget.id}/versions/1/lines`, 'PUT', {
      lockVersion: 0,
      lines: [{ accountId: expense.id, amounts: Array.from({ length: 12 }, (_, i) => ({ month: `2045-${String(i + 1).padStart(2, '0')}`, amount: 100 })) }],
    });

    await page.goto(`/budgets/${budget.id}`);
    await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 30_000 });

    await page.getByTestId('version-menu').click();
    await page.getByTestId('new-forecast').click();
    await page.getByTestId('forecast-as-of').fill('2045-03');
    await page.getByTestId('forecast-method').selectOption('budget');
    await page.getByTestId('forecast-confirm').click();
    await expect(page.getByText(/Created forecast v2\./)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('forecast-summary')).toContainText('budget remainder', { timeout: 30_000 });
    // A forecast is never submitted.
    await expect(page.getByTestId('submit-version')).toHaveCount(0);

    await page.getByTestId('open-forecast-vs-budget').click();
    const table = page.getByTestId('forecast-table');
    await expect(table).toContainText('Rent', { timeout: 30_000 });
    // Budget 1,200; no actuals in Jan–Mar, then 9 months of budget: projected 900.
    await expect(table).toContainText('1,200.00');
    await expect(table).toContainText('900.00');
    await page.keyboard.press('Escape');

    await page.goto(`/budgets/dashboard?budgetId=${budget.id}&asOf=2045-03`);
    await expect(page.getByTestId('budget-dashboard')).toContainText(name, { timeout: 30_000 });
    await expect(page.getByTestId('kpi-expenses')).toContainText('300.00');
    await expect(page.getByTestId('dashboard-chart')).toBeVisible();
    await expect(page.getByTestId('dashboard-projection')).toContainText('900.00');

    await page.goto('/budgets/approvals?tab=notifications');
    await expect(page.getByRole('tab', { name: 'Notifications' })).toHaveAttribute('aria-selected', 'true', { timeout: 30_000 });
  });
});
