import { test, expect } from './fixtures';
import { startInNamedBudget } from './helpers/app';
import { navigateTo, expectNoSpinner } from './helpers/nav';
import { reloadShell } from './helpers/seed';

/**
 * Goals domain journeys (named/draft budget).
 *
 * Touchpoints: create-goal form (disabled-until-valid submit), draft save +
 * persistence, untrusted-input rendering. Also guards the historical Goals
 * "perpetual spinner" regression via expectNoSpinner.
 */
test.describe('Goals', () => {
  test.beforeEach(async ({ window }) => {
    await startInNamedBudget(window);
    await navigateTo(window, 'Goals');
  });

  test('happy: create a goal, save, and it survives a reload', async ({ window }) => {
    await expect(window.getByRole('heading', { name: 'No savings goals yet' })).toBeVisible();

    await window.getByRole('button', { name: 'Add Goal' }).click();
    const dialog = window.getByRole('dialog', { name: 'Create Savings Goal' });
    await expect(dialog).toBeVisible();

    await dialog.getByLabel('Goal Name').fill('Emergency Fund');
    await dialog.getByLabel('Target Amount').fill('5000');
    await dialog.getByLabel('Target Date').fill('2027-06-30');
    await dialog.getByRole('button', { name: 'Create Goal' }).click();

    await expect(window.getByRole('heading', { name: 'Emergency Fund' })).toBeVisible();
    await expect(window.getByText('Unsaved changes on Goals')).toBeVisible();

    await window.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await expect(window.getByText('Unsaved changes on Goals')).toBeHidden();

    await reloadShell(window);
    await navigateTo(window, 'Goals');
    await expect(window.getByRole('heading', { name: 'Emergency Fund' })).toBeVisible();
    await expectNoSpinner(window);
  });

  test('sad: the create button stays disabled until name, amount, and date are valid', async ({ window }) => {
    await window.getByRole('button', { name: 'Add Goal' }).click();
    const dialog = window.getByRole('dialog', { name: 'Create Savings Goal' });
    const submit = dialog.getByRole('button', { name: 'Create Goal' });

    await expect(submit).toBeDisabled();

    await dialog.getByLabel('Goal Name').fill('Vacation');
    await expect(submit).toBeDisabled();

    // Amount gate: a non-positive target keeps the form locked.
    await dialog.getByLabel('Target Amount').fill('3000');
    await expect(submit).toBeEnabled();

    // Date gate: clearing the (auto-filled) target date locks it again.
    await dialog.getByLabel('Target Date').fill('');
    await expect(submit).toBeDisabled();
  });

  test('malicious: script-like goal name is rendered as inert text', async ({ window }) => {
    const payload = '<img src=x onerror="window.__goalxss=1">';

    await window.getByRole('button', { name: 'Add Goal' }).click();
    const dialog = window.getByRole('dialog', { name: 'Create Savings Goal' });
    await dialog.getByLabel('Goal Name').fill(payload);
    await dialog.getByLabel('Target Amount').fill('1000');
    await dialog.getByLabel('Target Date').fill('2027-12-31');
    await dialog.getByRole('button', { name: 'Create Goal' }).click();
    await window.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await expect(window.getByText('Unsaved changes on Goals')).toBeHidden();

    // Name appears in the card title and the achievability copy; the title is enough.
    await expect(window.getByText(payload).first()).toBeVisible();
    expect(await window.evaluate(() => (window as unknown as { __goalxss?: number }).__goalxss)).toBeUndefined();
    await expectNoSpinner(window);
  });
});
