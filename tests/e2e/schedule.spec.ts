import { test, expect } from './fixtures';
import { startInNamedBudget } from './helpers/app';
import {
  E2E_GOAL_FAR,
  E2E_GOAL_NEAR,
  E2E_INCOME_START,
  E2E_SCHEDULE_START,
} from './helpers/dates';
import { navigateTo, expectNoSpinner } from './helpers/nav';
import { dismissReconciliationIfPresent, pinScheduleStart } from './helpers/schedule';
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
      startDate: E2E_INCOME_START,
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
    await pinScheduleStart(window);

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
      startDate: E2E_INCOME_START,
      isActive: true,
    });
    await seedBill(window, {
      creditorName: 'Rent',
      budgetedAmount: 1500,
      dueDay: 1,
      isRecurring: true,
      priority: 'critical',
    });
    // Absolute far target forces the horizon past 12 months so the dropdown
    // exposes a distinct "Through <goal>" shortcut.
    await seedGoal(window, {
      name: 'New Car',
      targetAmount: 12000,
      targetDate: E2E_GOAL_FAR,
      alreadySaved: 0,
      priority: 1,
    });
    await reloadShell(window);
    await navigateTo(window, 'Schedule');
    await pinScheduleStart(window);

    await expect(window.getByRole('heading', { name: 'Payment Schedule' })).toBeVisible();

    const view = window.getByLabel('View');
    const goalOption = window.locator('#schedule-view option', { hasText: 'Through "New Car"' });
    await expect(goalOption).toHaveCount(1);
    await expect.poll(async () => goalOption.getAttribute('value')).not.toBe('12');
    const goalLabel = (await goalOption.textContent())?.trim();
    expect(goalLabel).toBeTruthy();
    await view.selectOption({ label: goalLabel! });
    await expect(view.locator('option:checked')).toHaveText(goalLabel!);
    await expectNoSpinner(window);
  });

  test('goal at risk: an underfunded goal flags the Goals Total summary @schedule.goal-at-risk', async ({ window }) => {
    await startInNamedBudget(window);

    await seedIncome(window, {
      sourceName: 'Acme Payroll',
      amount: 2400,
      cadence: 'biweekly',
      startDate: E2E_INCOME_START,
      isActive: true,
    });
    await seedGoal(window, {
      name: 'Impossible Dream',
      targetAmount: 999999,
      targetDate: E2E_GOAL_NEAR,
      alreadySaved: 0,
      priority: 1,
    });
    await reloadShell(window);
    await navigateTo(window, 'Schedule');
    await pinScheduleStart(window);

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
      startDate: E2E_INCOME_START,
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
    // Wait for auto-schedule settle (reconciliation overlay or remaining summary).
    await Promise.race([
      window.getByRole('button', { name: 'View Schedule Anyway' }).waitFor({ state: 'visible' }),
      window.getByText('Budget Remaining').first().waitFor({ state: 'visible' }),
    ]);
    // Do not pin/regenerate: shortfall auto-opens reconciliation and regenerating
    // races the overlay back over the Generate control.
    await dismissReconciliationIfPresent(window);
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
      startDate: E2E_SCHEDULE_START,
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
    await expect(window.getByRole('heading', { name: 'Payment Schedule' })).toBeVisible();
    await Promise.race([
      window.getByRole('button', { name: 'View Schedule Anyway' }).waitFor({ state: 'visible' }),
      window.getByText('Budget Remaining').first().waitFor({ state: 'visible' }),
    ]);
    // Same as shortfall: assert against the auto-opened schedule surface.
    await dismissReconciliationIfPresent(window);
    await expect(window.getByText(/Skip "/i)).toHaveCount(0);
    await expectNoSpinner(window);
  });
});
