import type { Page } from '@playwright/test';

/** Dismiss the reconciliation overlay when shortfalls auto-open it on Schedule. */
export async function dismissReconciliationIfPresent(window: Page): Promise<void> {
  const btn = window.getByRole('button', { name: 'View Schedule Anyway' });
  if (await btn.isVisible().catch(() => false)) {
    await btn.click();
  }
}
