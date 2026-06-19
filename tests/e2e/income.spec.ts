import { test, expect } from './fixtures';
import { startInNamedBudget } from './helpers/app';
import { navigateTo, expectNoSpinner } from './helpers/nav';
import { reloadShell } from './helpers/seed';

/**
 * Income domain journeys (named/draft budget).
 *
 * Touchpoints: add-income form, draft save bar, persistence, validation guard,
 * and untrusted-input rendering. Act + assert always happen through the UI.
 */
test.describe('Income', () => {
  test.beforeEach(async ({ window }) => {
    await startInNamedBudget(window);
    await navigateTo(window, 'Income');
  });

  test('happy: add income, save the draft, and it survives a reload', async ({ window }) => {
    await expect(window.getByRole('heading', { name: 'No income sources' })).toBeVisible();

    await window.getByRole('button', { name: 'Add Income' }).first().click();
    const dialog = window.getByRole('dialog', { name: 'Add Income Source' });
    await expect(dialog).toBeVisible();

    await dialog.locator('#income-source-name').fill('Acme Payroll');
    await dialog.locator('#income-amount').fill('2400');
    await dialog.locator('#income-cadence').selectOption('biweekly');
    await dialog.getByRole('button', { name: 'Add Income' }).click();

    // Row shows from the draft overlay; the save bar reveals the unsaved state.
    await expect(window.getByRole('heading', { name: 'Acme Payroll' })).toBeVisible();
    await expect(window.getByText('Unsaved changes on Income')).toBeVisible();

    await window.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await expect(window.getByText('Unsaved changes on Income')).toBeHidden();

    // Reload proves it persisted to the DB, not just the in-memory overlay.
    await reloadShell(window);
    await navigateTo(window, 'Income');
    await expect(window.getByRole('heading', { name: 'Acme Payroll' })).toBeVisible();
  });

  test('sad: an unsaved draft income is discarded on reload', async ({ window }) => {
    await window.getByRole('button', { name: 'Add Income' }).first().click();
    const dialog = window.getByRole('dialog', { name: 'Add Income Source' });
    await dialog.locator('#income-source-name').fill('Temp Gig');
    await dialog.locator('#income-amount').fill('500');
    await dialog.getByRole('button', { name: 'Add Income' }).click();

    await expect(window.getByRole('heading', { name: 'Temp Gig' })).toBeVisible();
    await expect(window.getByText('Unsaved changes on Income')).toBeVisible();

    // No save: reloading drops the overlay and the row is gone.
    await reloadShell(window);
    await navigateTo(window, 'Income');
    await expect(window.getByRole('heading', { name: 'Temp Gig' })).toBeHidden();
    await expect(window.getByRole('heading', { name: 'No income sources' })).toBeVisible();
  });

  test('sad: submitting with required fields empty keeps the form open', async ({ window }) => {
    await window.getByRole('button', { name: 'Add Income' }).first().click();
    const dialog = window.getByRole('dialog', { name: 'Add Income Source' });
    await expect(dialog).toBeVisible();

    // Leave the required name/amount blank; native validation blocks submit.
    await dialog.getByRole('button', { name: 'Add Income' }).click();

    await expect(dialog).toBeVisible();
    await expect(window.getByText('Unsaved changes on Income')).toBeHidden();
  });

  test('malicious: script-like source name is rendered as inert text', async ({ window }) => {
    const payload = '<img src=x onerror="window.__xss=1">';

    await window.getByRole('button', { name: 'Add Income' }).first().click();
    const dialog = window.getByRole('dialog', { name: 'Add Income Source' });
    await dialog.locator('#income-source-name').fill(payload);
    await dialog.locator('#income-amount').fill('100');
    await dialog.getByRole('button', { name: 'Add Income' }).click();
    await window.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await expect(window.getByText('Unsaved changes on Income')).toBeHidden();

    // Rendered verbatim as text, and the injected handler never ran.
    await expect(window.getByText(payload)).toBeVisible();
    expect(await window.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
    await expectNoSpinner(window);
  });
});
