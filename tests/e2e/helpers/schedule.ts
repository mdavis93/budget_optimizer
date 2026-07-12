import type { Page } from '@playwright/test';
import { E2E_SCHEDULE_START } from './dates';

/** Dismiss the reconciliation overlay when shortfalls auto-open it on Schedule. */
export async function dismissReconciliationIfPresent(window: Page): Promise<void> {
  const btn = window.getByRole('button', { name: 'View Schedule Anyway' });
  if (await btn.isVisible().catch(() => false)) {
    await btn.click();
  }
}

/** Pin the schedule viewport start and regenerate so seeded dates are visible. */
export async function pinScheduleStart(
  window: Page,
  date: string = E2E_SCHEDULE_START
): Promise<void> {
  await window.locator('#schedule-start-date').fill(date);
  await window.getByRole('button', { name: 'Generate Schedule' }).click();
}
