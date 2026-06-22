import { test, expect } from './fixtures';
import { startInNamedBudget } from './helpers/app';
import { navigateTo } from './helpers/nav';
import { unlock } from './helpers/auth';
import type { Page } from '@playwright/test';

/**
 * Cross-cutting: the unsaved-changes guard (a seam shared by every draft-backed
 * domain). The contract is:
 *   - In-app navigation NEVER prompts. The draft lives in DraftProvider (above
 *     the routed pages), so users can switch pages and simulate the impact of
 *     uncommitted edits as much as they like.
 *   - Only *exit* actions (Lock App / Quit App) prompt, offering Cancel (go back
 *     and review), Discard All (drop and proceed), or Save All Changes (persist
 *     and proceed).
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

    // Switching pages must NOT prompt — the whole point is free simulation.
    await navigateTo(window, 'Bills');
    await expect(window.getByRole('dialog', { name: 'Unsaved changes' })).toBeHidden();
    await expect(window.getByRole('heading', { name: 'Bills & Expenses' })).toBeVisible();

    // Returning shows the still-pending draft (held in the overlay, not lost).
    await navigateTo(window, 'Income');
    await expect(window.getByRole('heading', { name: 'Guard Salary' })).toBeVisible();
    await expect(window.getByText('Unsaved changes on Income')).toBeVisible();
  });

  test('Cancel on exit keeps you in the app with the draft intact @draft.guard-cancel', async ({ window }) => {
    await startDraftIncome(window);

    await window.getByRole('button', { name: 'Lock App' }).click();
    const guard = window.getByRole('dialog', { name: 'Unsaved changes' });
    await expect(guard).toBeVisible();
    await guard.getByRole('button', { name: 'Cancel' }).click();

    await expect(guard).toBeHidden();
    await expect(window.getByRole('heading', { name: 'Income Sources' })).toBeVisible();
    await expect(window.getByRole('heading', { name: 'Guard Salary' })).toBeVisible();
    await expect(window.getByText('Unsaved changes on Income')).toBeVisible();
  });

  test('Discard All on exit drops the draft and locks @draft.guard-discard', async ({ window }) => {
    await startDraftIncome(window);

    await window.getByRole('button', { name: 'Lock App' }).click();
    const guard = window.getByRole('dialog', { name: 'Unsaved changes' });
    await guard.getByRole('button', { name: 'Discard All' }).click();

    // Locks back to the login screen; on unlock the draft is gone.
    await unlock(window);
    await navigateTo(window, 'Income');
    await expect(window.getByRole('heading', { name: 'Guard Salary' })).toBeHidden();
    await expect(window.getByRole('heading', { name: 'No income sources' })).toBeVisible();
  });

  test('Save All Changes on exit persists the draft and locks @draft.guard-save', async ({ window }) => {
    await startDraftIncome(window);

    await window.getByRole('button', { name: 'Lock App' }).click();
    const guard = window.getByRole('dialog', { name: 'Unsaved changes' });
    await guard.getByRole('button', { name: 'Save All Changes' }).click();

    // Persisted across the lock/unlock cycle, not just held in the overlay.
    await unlock(window);
    await navigateTo(window, 'Income');
    await expect(window.getByRole('heading', { name: 'Guard Salary' })).toBeVisible();
  });
});
