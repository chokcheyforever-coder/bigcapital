import { test, expect } from '@playwright/test';
import { faker } from '@faker-js/faker';
import { fetchAccounts, readApiAuth } from './_api';

/**
 * 103 DiTech budgeting Phase 5 (design §12–13) in the browser: submit and
 * approve a version, see it in the approvals list, create a revision and
 * compare it, and open availability and settings. Approval rules are
 * tenant-wide: this test lets the single test user approve, then restores them.
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

test.describe('Budget approvals', () => {
  let savedRules: any[] = [];

  test.beforeAll(async () => {
    const rules = await apiSend('/budgets/settings/approval-rules', 'GET');
    savedRules = rules.rules.map((r: any) => ({
      minAmount: r.min_amount,
      maxAmount: r.max_amount,
      preventSelfApproval: r.prevent_self_approval,
      steps: r.steps.map((s: any) => ({ order: s.order, roleId: s.role_id ?? null, label: s.label })),
    }));
  });

  test.afterAll(async () => {
    await apiSend('/budgets/settings/approval-rules', 'PUT', { rules: savedRules });
  });

  test('two-step approval, approvals list, revision and comparison', async ({ page }) => {
    // Settings page: one rule, two steps, self-approval allowed (single test user).
    await page.goto('/budgets/settings');
    await expect(page.getByText('Approval rules')).toBeVisible({ timeout: 30_000 });
    await apiSend('/budgets/settings/approval-rules', 'PUT', {
      rules: [{ minAmount: 0, maxAmount: null, preventSelfApproval: false, steps: [{ order: 1, label: 'Finance' }, { order: 2, label: 'Director' }] }],
    });
    await page.reload();
    await expect(page.getByTestId('approval-rule')).toHaveCount(1, { timeout: 30_000 });

    const expense = (await fetchAccounts(API_BASE, readApiAuth())).find((a) => a.name === 'Rent')!;
    const name = `Approval flow ${faker.string.alphanumeric(6)}`;
    const budget = await apiSend('/budgets', 'POST', { name, type: 'operating_expenses', fiscalYear: 2038, startDate: '2038-01-01', endDate: '2038-12-31' });
    await apiSend(`/budgets/${budget.id}/versions/1/lines`, 'PUT', {
      lockVersion: 0,
      lines: [{ accountId: expense.id, amounts: Array.from({ length: 12 }, (_, i) => ({ month: `2038-${String(i + 1).padStart(2, '0')}`, amount: 100 })) }],
    });

    await page.goto(`/budgets/${budget.id}`);
    await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 30_000 });

    await page.getByTestId('submit-version').click();
    await page.getByTestId('workflow-comment').fill('Please approve');
    await page.getByTestId('workflow-confirm').click();
    await expect(page.getByText('Submitted for approval.')).toBeVisible({ timeout: 30_000 });

    // Waiting for me lists it.
    await page.goto('/budgets/approvals');
    await expect(page.getByTestId('approvals-table')).toContainText(name, { timeout: 30_000 });
    await page.getByTestId('approvals-table').getByText(name).click();
    await expect(page).toHaveURL(new RegExp(`/budgets/${budget.id}$`));

    for (const step of ['Finance', 'Director']) {
      await page.getByTestId('approve-version').click();
      await expect(page.getByRole('dialog')).toContainText('Approve');
      await page.getByTestId('workflow-confirm').click();
      await expect(page.getByText('Approved.').first()).toBeVisible({ timeout: 30_000 });
      if (step === 'Finance') await expect(page.getByTestId('approve-version')).toContainText('Director', { timeout: 30_000 });
    }
    await expect(page.getByTestId('workflow-bar')).toContainText('active version', { timeout: 30_000 });

    // Revision: a new draft copy; change December, save, compare with the original.
    await page.getByTestId('version-menu').click();
    await page.getByText('New revision…').click();
    const dialog = page.getByRole('dialog', { name: 'New revision' });
    await dialog.locator('textarea').fill('Higher costs from December');
    await dialog.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText(/Created v2\./)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('budget-line')).toHaveCount(1, { timeout: 30_000 });

    await apiSend(`/budgets/${budget.id}/versions/2/lines`, 'PUT', {
      lockVersion: 0,
      lines: [{ accountId: expense.id, amounts: [{ month: '2038-12', amount: 400 }] }],
    });
    await page.reload();
    await page.getByTestId('version-menu').click();
    await page.getByText('Compare versions').click();
    const table = page.getByTestId('compare-table');
    await expect(table).toContainText('1,200.00', { timeout: 30_000 });
    await expect(table).toContainText('1,500.00');
    await expect(table).toContainText('300.00');
    await expect(table).toContainText('25.00%');
    await page.keyboard.press('Escape');

    // Availability of the active (original) version.
    await page.getByTestId('version-menu').click();
    await page.getByText('Available to spend').click();
    await expect(page.getByTestId('availability-table')).toBeVisible({ timeout: 30_000 });
  });

  test('the approvals page shows override requests and alerts', async ({ page }) => {
    await page.goto('/budgets/approvals?tab=overrides');
    await expect(page.getByTestId('request-override')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('tab', { name: 'Alerts' }).click();
    await expect(page.getByRole('tabpanel')).toBeVisible();
  });
});
