import { test, expect } from './fixtures';
import { startInNamedBudget } from './helpers/app';
import { navigateTo } from './helpers/nav';
import { unlock } from './helpers/auth';
import { requestNativeWindowClose } from './helpers/electron';
import type { Page } from '@playwright/test';

/**
 * Cross-cutting: the unsaved-changes guard.
 *   - In-app navigation NEVER prompts (free simulation).
 *   - Lock App NEVER prompts — privacy lock preserves the draft across unlock.
 *   - Quit App / native window close prompt Save / Discard / Cancel.
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

test.describe('Unsaved-changes guard', () => {
  test.beforeEach(async ({ window }) => {
    await startInNamedBudget(window);
  });

  test('in-app navigation is unguarded and preserves the draft for simulation @draft.nav-free', async ({ window }) => {
    await startDraftIncome(window);

    await navigateTo(window, 'Bills');
    await expect(window.getByRole('dialog', { name: 'Unsaved changes' })).toBeHidden();
    await expect(window.getByRole('heading', { name: 'Bills & Expenses' })).toBeVisible();

    await navigateTo(window, 'Income');
    await expect(window.getByText('Guard Salary')).toBeVisible();
    await expect(window.getByText('Unsaved changes on Income')).toBeVisible();
  });

  test('Lock App preserves the draft across unlock without prompting @draft.lock-preserves', async ({ window }) => {
    await startDraftIncome(window);

    await window.getByRole('button', { name: 'Lock App' }).click();
    await expect(window.getByRole('dialog', { name: 'Unsaved changes' })).toBeHidden();
    await expect(window.getByRole('heading', { name: 'Welcome Back' })).toBeVisible({ timeout: 15000 });

    await unlock(window);
    await navigateTo(window, 'Income');
    await expect(window.getByText('Guard Salary')).toBeVisible();
    await expect(window.getByText('Unsaved changes on Income')).toBeVisible();
  });

  test('Cancel on Quit keeps you in the app with the draft intact @draft.guard-cancel', async ({ window }) => {
    await startDraftIncome(window);

    await window.getByRole('button', { name: 'Quit App' }).click();
    const guard = window.getByRole('dialog', { name: 'Unsaved changes' });
    await expect(guard).toBeVisible();
    await guard.getByRole('button', { name: 'Cancel' }).click();

    await expect(guard).toBeHidden();
    await expect(window.getByRole('heading', { name: 'Income Sources' })).toBeVisible();
    await expect(window.getByText('Guard Salary')).toBeVisible();
    await expect(window.getByText('Unsaved changes on Income')).toBeVisible();
  });

  test('Discard All on Quit drops the draft and exits @draft.guard-discard', async ({ window, electronApp }) => {
    await startDraftIncome(window);

    await window.getByRole('button', { name: 'Quit App' }).click();
    const guard = window.getByRole('dialog', { name: 'Unsaved changes' });
    const closed = electronApp.waitForEvent('close');
    await guard.getByRole('button', { name: 'Discard All' }).click();
    await closed;
  });

  test('Save All Changes on Quit persists then exits @draft.guard-save', async ({ window, electronApp }) => {
    await startDraftIncome(window);

    await window.getByRole('button', { name: 'Quit App' }).click();
    const guard = window.getByRole('dialog', { name: 'Unsaved changes' });
    await expect(guard).toBeVisible();
    // Do not assert modal hide — quit tears down the page (same as Discard).
    const closed = electronApp.waitForEvent('close');
    await guard.getByRole('button', { name: 'Save All Changes' }).click();
    await closed;
  });

  test('Cancel on native close keeps the app open with the draft intact @draft.native-close-cancel', async ({ window, electronApp }) => {
    await startDraftIncome(window);

    await requestNativeWindowClose(electronApp);
    const guard = window.getByRole('dialog', { name: 'Unsaved changes' });
    await expect(guard).toBeVisible();
    await guard.getByRole('button', { name: 'Cancel' }).click();

    await expect(guard).toBeHidden();
    await expect(window.getByRole('heading', { name: 'Income Sources' })).toBeVisible();
    await expect(window.getByText('Guard Salary')).toBeVisible();
    await expect(window.getByText('Unsaved changes on Income')).toBeVisible();
  });

  test('Discard All on native close exits the app @draft.native-close-discard', async ({ window, electronApp }) => {
    await startDraftIncome(window);

    await requestNativeWindowClose(electronApp);
    const guard = window.getByRole('dialog', { name: 'Unsaved changes' });
    await expect(guard).toBeVisible();
    const closed = electronApp.waitForEvent('close');
    await guard.getByRole('button', { name: 'Discard All' }).click();
    await closed;
  });

  test('Save All Changes on native close exits after persisting @draft.native-close-save', async ({ window, electronApp }) => {
    await startDraftIncome(window);

    await requestNativeWindowClose(electronApp);
    const guard = window.getByRole('dialog', { name: 'Unsaved changes' });
    await expect(guard).toBeVisible();
    const closed = electronApp.waitForEvent('close');
    await guard.getByRole('button', { name: 'Save All Changes' }).click();
    await expect(guard).toBeHidden({ timeout: 15000 });
    await closed;
  });

  test('native close with a clean draft exits without prompting @draft.native-close-clean', async ({ window, electronApp }) => {
    await navigateTo(window, 'Income');
    await expect(window.getByRole('heading', { name: 'No income sources' })).toBeVisible();

    const closed = electronApp.waitForEvent('close');
    await requestNativeWindowClose(electronApp);
    await expect(window.getByRole('dialog', { name: 'Unsaved changes' })).toBeHidden();
    await closed;
  });
});
