import { test, expect } from './fixtures';
import { startInNamedBudget } from './helpers/app';
import { navigateTo } from './helpers/nav';
import { reloadShell } from './helpers/seed';
import type { Page } from '@playwright/test';

/**
 * Cross-cutting: the unsaved-changes navigation guard (a seam shared by every
 * draft-backed domain). Starting a draft on Income and then clicking another
 * sidebar destination must prompt, and each choice (Cancel / Discard All /
 * Save All Changes) must behave correctly.
 */
async function startDraftIncome(window: Page): Promise<void> {
  await navigateTo(window, 'Income');
  await window.getByRole('button', { name: 'Add Income' }).first().click();
  const dialog = window.getByRole('dialog', { name: 'Add Income Source' });
  await dialog.locator('#income-source-name').fill('Guard Salary');
  await dialog.locator('#income-amount').fill('1000');
  await dialog.getByRole('button', { name: 'Add Income' }).click();
  await expect(window.getByText('Unsaved changes on Income')).toBeVisible();
}

test.describe('Unsaved-changes navigation guard', () => {
  test.beforeEach(async ({ window }) => {
    await startInNamedBudget(window);
  });

  test('Cancel keeps you on the page with the draft intact @draft.guard-cancel', async ({ window }) => {
    await startDraftIncome(window);

    await window.getByRole('link', { name: 'Bills' }).click();
    const guard = window.getByRole('dialog', { name: 'Unsaved changes' });
    await expect(guard).toBeVisible();
    await guard.getByRole('button', { name: 'Cancel' }).click();

    await expect(guard).toBeHidden();
    await expect(window.getByRole('heading', { name: 'Income Sources' })).toBeVisible();
    await expect(window.getByRole('heading', { name: 'Guard Salary' })).toBeVisible();
    await expect(window.getByText('Unsaved changes on Income')).toBeVisible();
  });

  test('Discard All proceeds and drops the draft @draft.guard-discard', async ({ window }) => {
    await startDraftIncome(window);

    await window.getByRole('link', { name: 'Bills' }).click();
    const guard = window.getByRole('dialog', { name: 'Unsaved changes' });
    await guard.getByRole('button', { name: 'Discard All' }).click();

    await expect(window.getByRole('heading', { name: 'Bills & Expenses' })).toBeVisible();
    await navigateTo(window, 'Income');
    await expect(window.getByRole('heading', { name: 'Guard Salary' })).toBeHidden();
    await expect(window.getByRole('heading', { name: 'No income sources' })).toBeVisible();
  });

  test('Save All Changes proceeds and persists the draft @draft.guard-save', async ({ window }) => {
    await startDraftIncome(window);

    await window.getByRole('link', { name: 'Bills' }).click();
    const guard = window.getByRole('dialog', { name: 'Unsaved changes' });
    await guard.getByRole('button', { name: 'Save All Changes' }).click();

    await expect(window.getByRole('heading', { name: 'Bills & Expenses' })).toBeVisible();

    // Persisted across a reload, not just held in the overlay.
    await reloadShell(window);
    await navigateTo(window, 'Income');
    await expect(window.getByRole('heading', { name: 'Guard Salary' })).toBeVisible();
  });
});
