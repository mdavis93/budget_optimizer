import { test, expect } from './fixtures';
import { startInNamedBudget } from './helpers/app';
import { navigateTo, expectNoSpinner } from './helpers/nav';
import { reloadShell, seedBill, seedGoal, seedIncome } from './helpers/seed';

/**
 * Schedule domain journeys — the seam where income + bills become a paycheck
 * plan. Seeds the upstream data via IPC, then asserts the schedule renders.
 */
test.describe('Schedule', () => {
  test('happy: a schedule renders once income and bills exist @schedule.render', async ({ window }) => {
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

  test('empty: no income or bills shows the empty schedule state @schedule.empty', async ({ window }) => {
    await startInNamedBudget(window);
    await navigateTo(window, 'Schedule');

    await expect(window.getByRole('heading', { name: 'No Schedule Available' })).toBeVisible();
    await expectNoSpinner(window);
  });

  test('viewport: the View selector offers a per-goal term option @schedule.viewport-goal-options', async ({ window }) => {
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
    // A goal ~2 years out forces the horizon past 12 months, so the dropdown
    // should expose a distinct "Through <goal>" shortcut.
    const target = new Date();
    target.setFullYear(target.getFullYear() + 2);
    const targetDate = target.toISOString().slice(0, 10);
    await seedGoal(window, {
      name: 'New Car',
      targetAmount: 12000,
      targetDate,
      alreadySaved: 0,
      priority: 1,
    });
    await reloadShell(window);
    await navigateTo(window, 'Schedule');

    await expect(window.getByRole('heading', { name: 'Payment Schedule' })).toBeVisible();

    const view = window.getByLabel('View');
    const goalOption = window.locator('#schedule-view option', { hasText: 'Through "New Car"' });
    await expect(goalOption).toHaveCount(1);

    const goalValue = await goalOption.getAttribute('value');
    expect(goalValue).toBeTruthy();
    await view.selectOption(goalValue as string);
    await expect(view).toHaveValue(goalValue as string);
    await expectNoSpinner(window);
  });

  test('goal at risk: an underfunded goal flags the Goals Total summary @schedule.goal-at-risk', async ({ window }) => {
    await startInNamedBudget(window);

    await seedIncome(window, {
      sourceName: 'Acme Payroll',
      amount: 2400,
      cadence: 'biweekly',
      startDate: '2026-01-02',
      isActive: true,
    });
    // A large goal with a near deadline cannot be funded -> at risk.
    const target = new Date();
    target.setMonth(target.getMonth() + 6);
    const targetDate = target.toISOString().slice(0, 10);
    await seedGoal(window, {
      name: 'Impossible Dream',
      targetAmount: 999999,
      targetDate,
      alreadySaved: 0,
      priority: 1,
    });
    await reloadShell(window);
    await navigateTo(window, 'Schedule');

    await expect(window.getByRole('heading', { name: 'Payment Schedule' })).toBeVisible();
    await expect(window.getByRole('img', { name: 'Goals at risk' })).toBeVisible();
    await expectNoSpinner(window);
  });

  test('shortfall: a tight budget shows negative budget remaining @schedule.shortfall', async ({ window }) => {
    await startInNamedBudget(window);

    await seedIncome(window, {
      sourceName: 'Part Time',
      amount: 800,
      cadence: 'biweekly',
      startDate: '2026-01-02',
      isActive: true,
    });
    await seedBill(window, {
      creditorName: 'Rent',
      budgetedAmount: 2000,
      dueDay: 1,
      isRecurring: true,
      priority: 'critical',
    });
    await reloadShell(window);
    await navigateTo(window, 'Schedule');

    await expect(window.getByRole('heading', { name: 'Payment Schedule' })).toBeVisible();
    await expect(window.getByText('Budget Remaining').first()).toBeVisible();
    await expect(window.getByText(/-\$[\d,]+\.\d{2}/).first()).toBeVisible();
    await expectNoSpinner(window);
  });

  test('reconciliation: proposed fixes never suggest skipping a bill @schedule.no-skip-suggest', async ({ window }) => {
    await startInNamedBudget(window);

    await seedIncome(window, {
      sourceName: 'Tight Pay',
      amount: 900,
      cadence: 'monthly',
      startDate: '2026-01-01',
      isActive: true,
    });
    await seedBill(window, {
      creditorName: 'Rent',
      budgetedAmount: 1500,
      dueDay: 1,
      isRecurring: true,
      priority: 'critical',
    });
    await seedBill(window, {
      creditorName: 'Utilities',
      budgetedAmount: 300,
      dueDay: 15,
      isRecurring: true,
      priority: 'normal',
    });
    await reloadShell(window);
    await navigateTo(window, 'Schedule');

    await expect(window.getByRole('heading', { name: 'Payment Schedule' }).or(
      window.getByText('Some shortfalls need manual changes')
    )).toBeVisible({ timeout: 15000 });
    await expect(window.getByText(/Skip "/i)).toHaveCount(0);
    await expectNoSpinner(window);
  });
});
