import { test, expect } from './fixtures';
import { completeSetup } from './helpers/auth';
import { createBudgetViaPicker } from './helpers/budget';
import { navigateTo, expectNoSpinner, type NavTarget } from './helpers/nav';

/**
 * Harness smoke + load-regression crawl.
 *
 * Proves the whole real boot path works end-to-end with no auth bypass:
 * pristine vault -> create master password -> acknowledge recovery key ->
 * create budget -> app shell. Then it visits every sidebar route asserting the
 * page renders without a stuck `.animate-spin` spinner — the exact failure mode
 * that previously shipped on Goals and Debts undetected.
 */
test.describe('Harness smoke', () => {
  test('first-run setup reaches the app shell', async ({ window }) => {
    await completeSetup(window);
    await createBudgetViaPicker(window);

    await expect(window.getByRole('link', { name: 'Dashboard' })).toBeVisible();
    await expectNoSpinner(window);
  });

  test('every sidebar route renders without a stuck spinner', async ({ window }) => {
    await completeSetup(window);
    await createBudgetViaPicker(window);

    const routes: NavTarget[] = [
      'Income',
      'Bills',
      'Debts',
      'Schedule',
      'Goals',
      'Summary',
      'Budgets',
      'Export',
      'Settings',
      'Dashboard',
    ];

    for (const route of routes) {
      await navigateTo(window, route);
    }
  });
});
