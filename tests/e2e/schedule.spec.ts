import { test, expect } from './fixtures';
import { startInNamedBudget } from './helpers/app';
import { navigateTo, expectNoSpinner } from './helpers/nav';
import { reloadShell, seedBill, seedIncome } from './helpers/seed';

/**
 * Schedule domain journeys — the seam where income + bills become a paycheck
 * plan. Seeds the upstream data via IPC, then asserts the schedule renders.
 */
test.describe('Schedule', () => {
  test('happy: a schedule renders once income and bills exist', async ({ window }) => {
    await startInNamedBudget(window);

    await seedIncome(window, {
      sourceName: 'Acme Payroll',
      amount: 2400,
      cadence: 'biweekly',
      startDate: '2026-01-02',
      isActive: true,
    });
    await seedBill(window, {
      creditorName: 'Rent',
      budgetedAmount: 1500,
      dueDay: 1,
      isRecurring: true,
      priority: 'critical',
    });
    await reloadShell(window);
    await navigateTo(window, 'Schedule');

    await expect(window.getByRole('heading', { name: 'Payment Schedule' })).toBeVisible();
    await expect(window.getByRole('heading', { name: 'No Schedule Available' })).toBeHidden();
    await expect(window.getByText('Total Income')).toBeVisible();
    await expectNoSpinner(window);
  });

  test('empty: no income or bills shows the empty schedule state', async ({ window }) => {
    await startInNamedBudget(window);
    await navigateTo(window, 'Schedule');

    await expect(window.getByRole('heading', { name: 'No Schedule Available' })).toBeVisible();
    await expectNoSpinner(window);
  });
});
