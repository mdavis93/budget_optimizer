import { expect, type Page } from '@playwright/test';

/** Sidebar destinations, keyed by their visible nav label. */
export type NavTarget =
  | 'Dashboard'
  | 'Income'
  | 'Bills'
  | 'Debts'
  | 'Schedule'
  | 'Goals'
  | 'Summary'
  | 'Budgets'
  | 'Export'
  | 'Settings';

/**
 * Click a sidebar nav item and wait for the route's title bar to update.
 * The Layout title bar renders the lowercased route segment with CSS
 * capitalization, so match the DOM text case-insensitively.
 */
export async function navigateTo(window: Page, target: NavTarget): Promise<void> {
  // Scope to aside (Settings lives in the footer div, outside <nav>). Match the
  // label span only — draft dirty dots add an aria-label on the link.
  const sidebar = window.locator('aside');
  await sidebar
    .locator('a')
    .filter({ has: window.locator('span.flex-1', { hasText: target, exact: true }) })
    .click();
  await expect(window.getByRole('heading', { name: new RegExp(target, 'i') }).first()).toBeVisible();
  await expectNoSpinner(window);
}

/**
 * Assert the page has finished loading: no Tailwind `.animate-spin` spinner is
 * present. This is the load-regression guard the skipped specs lacked.
 */
export async function expectNoSpinner(window: Page): Promise<void> {
  await expect(window.locator('.animate-spin')).toHaveCount(0);
}
