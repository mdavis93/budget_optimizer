import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import { BrowserWindow } from 'electron';

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
}));

import { PdfService } from '../../../electron/services/pdf.service';
import { ScheduleData } from '../../../electron/services/scheduler.service';

describe('PdfService.generateHtml', () => {
  const schedule: ScheduleData = {
    startDate: '2026-01-01',
    endDate: '2026-01-31',
    paychecks: [
      {
        date: '2026-01-15',
        incomeSources: [{ name: '<img src=x onerror=alert(1)>', amount: 1000 }],
        bills: [
          {
            billId: 'b1',
            billDate: '2026-01-20',
            creditorName: '<script>alert(1)</script>',
            amount: 100,
            dueDay: 20,
            priority: 'normal',
            isIncomeAttached: false,
          },
        ],
        goalDeposits: [{ goalName: '<evil>', amount: 50 }],
        totalIncome: 1000,
        totalBills: 100,
        totalGoalDeposits: 50,
        savingsDeposit: 0,
        budgetRemaining: 850,
        totalSavings: 0,
        isShortfall: false,
      },
    ],
    fullPaychecks: [],
    viewportMonths: 1,
    entries: [],
    summary: {
      totalIncome: 1000,
      totalExpenses: 150,
      netBalance: 850,
      finalSavingsBalance: 0,
      shortfallCount: 0,
    },
    recommendations: ['<img src=x onerror=alert(1)>'],
    maxBudgetRemaining: 850,
  };

  describe('happy', () => {
    it('renders report markup for valid schedule data', () => {
      const service = new PdfService();
      const html = service.generateHtml(schedule);

      expect(html).toContain('Budget Payment Schedule');
      expect(html).toContain('Payment Schedule by Paycheck');
      expect(html).toContain('$1,000.00');
    });
  });

  describe('sad', () => {
    it('returns failure when html export write fails', async () => {
      const service = new PdfService();
      vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {
        throw new Error('disk full');
      });

      const result = await service.generateHtmlFile(schedule, '/tmp/report.html');
      expect(result).toEqual({ success: false, error: 'disk full' });

      vi.restoreAllMocks();
    });

    it('returns failure when pdf generation throws', async () => {
      const service = new PdfService();
      const loadFile = vi.fn(async () => {});
      const printToPDF = vi.fn(async () => {
        throw new Error('pdf failure');
      });
      const destroy = vi.fn();
      const isDestroyed = vi.fn(() => false);

      vi.mocked(BrowserWindow).mockImplementation(
        () =>
          ({
            loadFile,
            webContents: { printToPDF },
            destroy,
            isDestroyed,
          }) as unknown as BrowserWindow
      );

      const result = await service.generatePdf(schedule, '/tmp/budget-report.pdf');
      expect(result).toEqual({ success: false, error: 'pdf failure' });
      expect(loadFile).toHaveBeenCalled();
      expect(destroy).toHaveBeenCalled();
    });
  });

  describe('hostile', () => {
    it('escapes script tags in creditor names and other user-controlled fields', () => {
      const service = new PdfService();
      const html = service.generateHtml(schedule);

      expect(html).not.toContain('<script>alert(1)</script>');
      expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
      expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
      expect(html).toContain('&lt;evil&gt;');
    });

    it('generates html safely when schedule has no paychecks', () => {
      const service = new PdfService();
      const emptyHtml = service.generateHtml({
        ...schedule,
        paychecks: [],
      });

      expect(emptyHtml).toContain('No paychecks in the selected period.');
      expect(emptyHtml).not.toContain('<script>alert(1)</script>');
    });

    it('writes PDF output when BrowserWindow succeeds', async () => {
      const service = new PdfService();
      const loadFile = vi.fn(async () => {});
      const printToPDF = vi.fn(async () => Buffer.from('pdf-bytes'));
      const destroy = vi.fn();
      const isDestroyed = vi.fn(() => false);
      const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);
      const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => undefined);
      const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);

      vi.mocked(BrowserWindow).mockImplementation(
        () =>
          ({
            loadFile,
            webContents: { printToPDF },
            destroy,
            isDestroyed,
          }) as unknown as BrowserWindow
      );

      const result = await service.generatePdf(schedule, '/tmp/budget-report');
      expect(result).toEqual({ success: true });
      expect(loadFile).toHaveBeenCalled();
      expect(printToPDF).toHaveBeenCalled();
      expect(writeSpy).toHaveBeenCalled();
      expect(unlinkSpy).toHaveBeenCalled();
      expect(existsSpy).toHaveBeenCalled();
      expect(destroy).toHaveBeenCalled();

      vi.restoreAllMocks();
    });
  });
});
