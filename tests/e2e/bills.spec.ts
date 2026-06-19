import { test, expect } from './fixtures';
import { startInNamedBudget } from './helpers/app';
import { navigateTo, expectNoSpinner } from './helpers/nav';
import { reloadShell } from './helpers/seed';

/**
 * Bills domain journeys (named/draft budget).
 *
 * Touchpoints: add-bill form (due-date vs per-paycheck), draft save +
 * persistence, conditional required income source, untrusted-input rendering.
 */
test.describe('Bills', () => {
  test.beforeEach(async ({ window }) => {
    await startInNamedBudget(window);
    await navigateTo(window, 'Bills');
  });

  test('happy: add a due-date bill, save, and it survives a reload', async ({ window }) => {
    await expect(window.getByRole('heading', { name: 'No bills added' })).toBeVisible();

    await window.getByRole('button', { name: 'Add Bill' }).first().click();
    const dialog = window.getByRole('dialog', { name: 'Add Bill' });
    await expect(dialog).toBeVisible();

    await dialog.locator('#bill-creditor-name').fill('Electric Company');
    await dialog.locator('#bill-budgeted-amount').fill('140');
    await dialog.getByRole('button', { name: 'Add Bill' }).click();

    await expect(window.getByText('Electric Company')).toBeVisible();
    await expect(window.getByText('Unsaved changes on Bills')).toBeVisible();

    await window.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await expect(window.getByText('Unsaved changes on Bills')).toBeHidden();

    await reloadShell(window);
    await navigateTo(window, 'Bills');
    await expect(window.getByText('Electric Company')).toBeVisible();
  });

  test('sad: a per-paycheck bill needs an income source before it can be saved', async ({ window }) => {
    await window.getByRole('button', { name: 'Add Bill' }).first().click();
    const dialog = window.getByRole('dialog', { name: 'Add Bill' });

    await dialog.locator('#bill-creditor-name').fill('Streaming');
    await dialog.locator('#bill-budgeted-amount').fill('16');
    await dialog.getByRole('button', { name: 'Per Paycheck' }).click();

    // No income exists yet, so the required attach-to-income select blocks submit.
    await expect(dialog.locator('#bill-attached-income')).toBeVisible();
    await dialog.getByRole('button', { name: 'Add Bill' }).click();

    await expect(dialog).toBeVisible();
    await expect(window.getByText('Unsaved changes on Bills')).toBeHidden();
  });

  test('malicious: script-like creditor name is rendered as inert text', async ({ window }) => {
    const payload = '<script>window.__billxss=1</script>';

    await window.getByRole('button', { name: 'Add Bill' }).first().click();
    const dialog = window.getByRole('dialog', { name: 'Add Bill' });
    await dialog.locator('#bill-creditor-name').fill(payload);
    await dialog.locator('#bill-budgeted-amount').fill('10');
    await dialog.getByRole('button', { name: 'Add Bill' }).click();
    await window.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await expect(window.getByText('Unsaved changes on Bills')).toBeHidden();

    await expect(window.getByText(payload)).toBeVisible();
    expect(await window.evaluate(() => (window as unknown as { __billxss?: number }).__billxss)).toBeUndefined();
    await expectNoSpinner(window);
  });
});
