import { test, expect } from './fixtures';
import { startInNamedBudget } from './helpers/app';
import { navigateTo, expectNoSpinner } from './helpers/nav';
import { reloadShell, seedBill } from './helpers/seed';

/**
 * Debts domain journeys (named/draft budget).
 *
 * Debt tracking requires a Debt-category bill first, so the happy path uses
 * IPC pre-seed for that prerequisite, then drives the tracking UI. Also guards
 * the historical Debts "perpetual spinner" regression via expectNoSpinner.
 */
test.describe('Debts', () => {
  test.beforeEach(async ({ window }) => {
    await startInNamedBudget(window);
  });

  test('sad: Add Debt is disabled until a Debt-category bill exists', async ({ window }) => {
    await navigateTo(window, 'Debts');

    await expect(window.getByRole('button', { name: 'Add Debt' })).toBeDisabled();
    await expect(window.getByRole('heading', { name: 'No debts to track' })).toBeVisible();
  });

  test('happy: track a seeded debt bill, save, and it survives a reload', async ({ window }) => {
    await seedBill(window, {
      creditorName: 'Visa Card',
      budgetedAmount: 200,
      dueDay: 15,
      category: 'Debt',
      isRecurring: true,
      priority: 'high',
    });
    await reloadShell(window);
    await navigateTo(window, 'Debts');

    const addDebt = window.getByRole('button', { name: 'Add Debt' });
    await expect(addDebt).toBeEnabled();
    await addDebt.click();

    const dialog = window.getByRole('dialog', { name: 'Add Debt' });
    await dialog.locator('#debt-bill').selectOption({ index: 1 });
    await dialog.locator('#debt-principal').fill('4000');
    await dialog.locator('#debt-apr').fill('18.5');
    await dialog.locator('#debt-monthly-payment').fill('200');
    await dialog.getByRole('button', { name: 'Add Debt' }).click();

    await expect(window.getByText('Unsaved changes on Debts')).toBeVisible();
    await window.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await expect(window.getByText('Unsaved changes on Debts')).toBeHidden();

    await reloadShell(window);
    await navigateTo(window, 'Debts');

    // Persisted: the tracked total reflects the saved debt.
    await expect(window.getByText('Total Debt Balance')).toBeVisible();
    await expect(window.getByText('$4,000.00').first()).toBeVisible();

    // Tracked debts group is a collapsed <details>; expand it to see the card.
    await window.locator('summary').first().click();
    await expect(window.getByRole('heading', { name: 'Visa Card' })).toBeVisible();
    await expectNoSpinner(window);
  });
});
