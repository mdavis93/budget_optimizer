import { expect, type Page } from '@playwright/test';
import type { BillInput, DebtInput, IncomeInput, SavingsGoalInput } from '../../../shared/types';
import { E2E_PASSWORD, unlock } from './auth';

/**
 * Pre-seeding strategy (the "arrange" phase for non-setup journeys).
 *
 * Data is written through the *real* production IPC (`window.electronAPI.*`),
 * exactly what the renderer calls — there is no test-only backdoor. Because
 * the renderer caches a draft snapshot per budget, a direct DB write isn't
 * visible until the renderer reloads. `reloadShell` reloads the window; the
 * Electron main process keeps the unlocked session and selected budget, so the
 * app comes back to the shell with the freshly seeded data loaded.
 */

type ApiResult<T> = { success: boolean; data?: T; error?: string };

async function ipcCreate<T extends { id: string }>(
  window: Page,
  path: 'income' | 'bills' | 'goals' | 'debts',
  payload: unknown
): Promise<string> {
  const result = (await window.evaluate(
    async ({ apiPath, input }) => {
      const api = (window as unknown as { electronAPI: Record<string, { create: (i: unknown) => Promise<unknown> }> })
        .electronAPI;
      return api[apiPath].create(input);
    },
    { apiPath: path, input: payload }
  )) as ApiResult<T>;

  if (!result.success || !result.data) {
    throw new Error(`Seed via electronAPI.${path}.create failed: ${result.error ?? 'unknown error'}`);
  }
  return result.data.id;
}

export function seedIncome(window: Page, input: IncomeInput): Promise<string> {
  return ipcCreate(window, 'income', input);
}

export function seedBill(window: Page, input: BillInput): Promise<string> {
  return ipcCreate(window, 'bills', input);
}

export function seedGoal(window: Page, input: SavingsGoalInput): Promise<string> {
  return ipcCreate(window, 'goals', input);
}

export function seedDebt(window: Page, input: DebtInput): Promise<string> {
  return ipcCreate(window, 'debts', input);
}

export type ReloadOptions = {
  password?: string;
  /** Budget to reselect from the picker after reload (defaults to the harness budget). */
  budgetName?: string;
};

/**
 * Reload the renderer and return to the app shell. Reloading drops the
 * renderer's in-memory budget selection (the main process keeps the unlocked
 * session), so this mirrors the real relaunch path: unlock if prompted, then
 * reselect the budget from the picker. Use after IPC seeding so the draft
 * snapshot is re-read from the DB with the freshly written rows.
 */
export async function reloadShell(window: Page, options: ReloadOptions = {}): Promise<void> {
  const { password = E2E_PASSWORD, budgetName = 'E2E Budget' } = options;

  await window.reload();
  await window.waitForLoadState('domcontentloaded');

  const dashboardLink = window.getByRole('link', { name: 'Dashboard' });
  const loginHeading = window.getByRole('heading', { name: 'Welcome Back' });
  const pickerHeading = window.getByRole('heading', { name: 'Select a Budget' });

  await expect(dashboardLink.or(loginHeading).or(pickerHeading)).toBeVisible({ timeout: 15000 });

  if (await loginHeading.isVisible().catch(() => false)) {
    await unlock(window, password);
  }

  if (await pickerHeading.isVisible({ timeout: 5000 }).catch(() => false)) {
    await window.getByRole('button', { name: new RegExp(`^${budgetName}`) }).click();
  }

  await expect(dashboardLink).toBeVisible({ timeout: 15000 });
}
