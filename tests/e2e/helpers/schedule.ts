import type { Page } from '@playwright/test';
import { E2E_SCHEDULE_START } from './dates';

/** Dismiss the reconciliation overlay when shortfalls auto-open it on Schedule. */
export async function dismissReconciliationIfPresent(window: Page): Promise<void> {
  const btn = window.getByRole('button', { name: 'View Schedule Anyway' });
  if (await btn.isVisible().catch(() => false)) {
    await btn.click();
  }
}

/**
 * Pin the schedule viewport start and regenerate so seeded dates are visible.
 * Shortfall budgets may auto-open reconciliation and hide the date control —
 * dismiss that first, then wait for the control.
 */
export async function pinScheduleStart(
  window: Page,
  date: string = E2E_SCHEDULE_START
): Promise<void> {
  const startDate = window.locator('#schedule-start-date');
  const viewAnyway = window.getByRole('button', { name: 'View Schedule Anyway' });

  await Promise.race([
    startDate.waitFor({ state: 'visible' }),
    viewAnyway.waitFor({ state: 'visible' }),
  ]);
  await dismissReconciliationIfPresent(window);
  await startDate.fill(date);
  // Filling can rebuild the schedule and re-open reconciliation; clear it again.
  await dismissReconciliationIfPresent(window);
  await window.getByRole('button', { name: 'Generate Schedule' }).click();
}
