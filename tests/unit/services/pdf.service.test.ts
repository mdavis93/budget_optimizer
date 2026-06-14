import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
}));

import { PdfService } from '../../../electron/services/pdf.service';
import { ScheduleData } from '../../../electron/services/scheduler.service';

describe('PdfService.generateHtml', () => {
  it('escapes user-controlled strings to prevent XSS', () => {
    const service = new PdfService();
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

    const html = service.generateHtml(schedule);

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&lt;evil&gt;');
  });
});
