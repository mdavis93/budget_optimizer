import { expect, type Page } from '@playwright/test';

export type CreateBudgetOptions = {
  name?: string;
  startingBalance?: string;
  targetCash?: string;
  minCash?: string;
};

/**
 * Create and open a budget through the real budget-picker UI. After setup the
 * app routes here because `BudgetRequiredRoute` blocks the app shell until a
 * budget exists.
 */
export async function createBudgetViaPicker(
  window: Page,
  options: CreateBudgetOptions = {}
): Promise<void> {
  const { name = 'E2E Budget', startingBalance = '2000', targetCash = '250', minCash = '100' } =
    options;

  await expect(window.getByRole('heading', { name: 'Select a Budget' })).toBeVisible();
  await window.getByRole('button', { name: /Create New Budget/ }).click();

  await window.locator('#picker-budget-name').fill(name);
  await window.locator('#picker-starting-balance').fill(startingBalance);
  await window.locator('#picker-target-cash').fill(targetCash);
  await window.locator('#picker-min-cash').fill(minCash);

  await window.getByRole('button', { name: 'Create & Open' }).click();

  // App shell is up once the sidebar nav renders.
  await expect(window.getByRole('link', { name: 'Dashboard' })).toBeVisible();
}
