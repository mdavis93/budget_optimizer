import { expect, type Page } from '@playwright/test';

/** Deterministic, throwaway master password used across the E2E suite. */
export const E2E_PASSWORD = 'e2e-master-pass-9281';

/**
 * Drive the real first-run setup UI: create a master password, acknowledge the
 * recovery key, and skip biometric enrollment if the platform offers it.
 *
 * This is the "golden journey" entrypoint — no IPC shortcut. After it resolves
 * the app is unlocked and sitting on the budget picker.
 */
export async function completeSetup(window: Page, password: string = E2E_PASSWORD): Promise<void> {
  await expect(window.getByRole('heading', { name: 'Create Master Password' })).toBeVisible();

  await window.locator('#password').fill(password);
  await window.locator('#confirmPassword').fill(password);
  await window.getByRole('button', { name: 'Create Password' }).click();

  // Recovery-key acknowledgement gate.
  await expect(window.getByRole('heading', { name: 'Save Your Recovery Key' })).toBeVisible();
  await window.locator('#confirmSaved').check();
  await window.getByRole('button', { name: 'Continue' }).click();

  // Biometric step only appears when the OS reports Touch ID / Hello as
  // available (true on some macOS dev machines, false in Linux CI).
  const skipBiometric = window.getByRole('button', { name: 'Skip for now' });
  if (await skipBiometric.isVisible({ timeout: 2000 }).catch(() => false)) {
    await skipBiometric.click();
  }
}

/**
 * Unlock an existing vault from the login screen with the master password.
 */
export async function unlock(window: Page, password: string = E2E_PASSWORD): Promise<void> {
  await expect(window.getByRole('heading', { name: 'Welcome Back' })).toBeVisible();
  await window.locator('#password').fill(password);
  await window.getByRole('button', { name: 'Unlock' }).click();
  await expect(window.getByRole('link', { name: 'Dashboard' })).toBeVisible({ timeout: 15000 });
}
