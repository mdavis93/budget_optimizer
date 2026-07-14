import type { Page } from '@playwright/test';
import { E2E_SCHEDULE_START } from './dates';

/** Dismiss the reconciliation overlay when shortfalls auto-open it on Schedule. */
export async function dismissReconciliationIfPresent(window: Page): Promise<void> {
  const btn = window.getByRole('button', { name: 'View Schedule Anyway' });
  if (await btn.isVisible().catch(() => false)) {
    await btn.click();
  }
}

/** Dismiss Break Glass Advisor panels when present on Schedule. */
export async function dismissBreakGlassAdvisorIfPresent(window: Page): Promise<void> {
  const declines = window.getByRole('button', { name: 'Decline' });
  while (await declines.first().isVisible().catch(() => false)) {
    await declines.first().click();
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
  await dismissBreakGlassAdvisorIfPresent(window);
  await startDate.fill(date);
  // Filling rebuilds the schedule (and may re-open reconciliation); clear it again.
  await dismissReconciliationIfPresent(window);
  await dismissBreakGlassAdvisorIfPresent(window);
  const refresh = window.getByRole('button', { name: 'Refresh' });
  if (await refresh.isVisible().catch(() => false)) {
    await refresh.click();
    await dismissReconciliationIfPresent(window);
    await dismissBreakGlassAdvisorIfPresent(window);
  }
}
