import fs from 'fs';
import os from 'os';
import path from 'path';
import { test, expect } from './fixtures';
import { startInNamedBudget } from './helpers/app';
import { E2E_INCOME_START } from './helpers/dates';
import { navigateTo, expectNoSpinner } from './helpers/nav';
import { reloadShell, seedBill, seedIncome } from './helpers/seed';

/**
 * Export journeys. The harness stubs the native save dialog as canceled;
 * this spec replaces that stub with a path under the home directory so
 * main can approve it and write the PDF.
 */
test.describe('Export', () => {
  test('happy: export the schedule to a PDF file @export.pdf', async ({ window, electronApp }) => {
    const directory = fs.mkdtempSync(path.join(os.homedir(), 'budget-e2e-pdf-'));
    const pdfPath = path.join(directory, 'budget-report.pdf');

    try {
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
      await navigateTo(window, 'Export');

      await electronApp.evaluate(({ dialog }, filePath) => {
        dialog.showSaveDialog = async () =>
          ({ canceled: false, filePath }) as Awaited<ReturnType<typeof dialog.showSaveDialog>>;
      }, pdfPath);

      const exportPdf = window.getByRole('button', { name: 'Export PDF' });
      await expect(exportPdf).toBeEnabled({ timeout: 20000 });
      await exportPdf.click();

      await expect(window.getByText(`PDF saved to ${pdfPath}`)).toBeVisible({ timeout: 20000 });
      expect(fs.statSync(pdfPath).size).toBeGreaterThan(0);
      await expectNoSpinner(window);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
