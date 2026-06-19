import { test, expect } from './fixtures';
import { startInNamedBudget } from './helpers/app';
import { E2E_PASSWORD } from './helpers/auth';

/**
 * Auth golden journeys (lock + unlock), driven entirely through the UI. Setup
 * is already exercised by the harness/smoke suite; this covers the returning
 * user path and a rejected password.
 */
test.describe('Lock and unlock', () => {
  test.beforeEach(async ({ window }) => {
    await startInNamedBudget(window);
  });

  test('happy: lock the app and unlock with the master password @auth.lock @auth.unlock', async ({ window }) => {
    await window.getByRole('button', { name: 'Lock App' }).click();
    await expect(window.getByRole('heading', { name: 'Welcome Back' })).toBeVisible();

    await window.locator('#password').fill(E2E_PASSWORD);
    await window.getByRole('button', { name: 'Unlock' }).click();

    // Unlocking returns to the app, possibly via the budget picker.
    const picker = window.getByRole('heading', { name: 'Select a Budget' });
    if (await picker.isVisible({ timeout: 5000 }).catch(() => false)) {
      await window.getByRole('button', { name: /^E2E Budget/ }).click();
    }
    await expect(window.getByRole('link', { name: 'Dashboard' })).toBeVisible();
  });

  test('sad: an incorrect master password keeps the app locked @auth.unlock-rejected', async ({ window }) => {
    await window.getByRole('button', { name: 'Lock App' }).click();
    await expect(window.getByRole('heading', { name: 'Welcome Back' })).toBeVisible();

    await window.locator('#password').fill('definitely-not-the-password');
    await window.getByRole('button', { name: 'Unlock' }).click();

    // Stays locked: the login screen remains and the app shell never appears.
    await expect(window.getByRole('link', { name: 'Dashboard' })).toBeHidden();
    await expect(window.getByRole('heading', { name: 'Welcome Back' })).toBeVisible();
  });
});
