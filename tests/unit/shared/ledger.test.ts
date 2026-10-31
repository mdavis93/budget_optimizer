import { describe, expect, it } from 'vitest';
import { convertToLegacyEntries } from '@shared/schedulePresentation';
import type { PaycheckEntry } from '@shared/types';

function paycheck(overrides: Partial<PaycheckEntry> & Pick<PaycheckEntry, 'date'>): PaycheckEntry {
  return {
    id: `operating-${overrides.date}`,
    purpose: 'operating',
    incomeSources: [{ id: 'job', name: 'Job', amount: 1000 }],
    totalIncome: 1000,
    bills: [],
    totalBills: 0,
    goalDeposits: [],
    totalGoalDeposits: 0,
    savingsDeposit: 0,
    totalSavings: 0,
    budgetRemaining: 200,
    isShortfall: false,
    ...overrides,
  };
}

describe('convertToLegacyEntries', () => {
  it('resets the running balance at each operating paycycle and spends petty cash', () => {
    const entries = convertToLegacyEntries(
      [
        paycheck({ date: '2026-01-02', budgetRemaining: 200 }),
        paycheck({ date: '2026-01-16', budgetRemaining: 150 }),
      ],
      100
    );

    const firstIncome = entries.find((entry) => entry.date === '2026-01-02' && entry.type === 'income');
    const secondIncome = entries.find((entry) => entry.date === '2026-01-16' && entry.type === 'income');
    const petty = entries.filter((entry) => entry.type === 'pettyCash');

    expect(firstIncome?.runningBalance).toBe(1100);
    expect(secondIncome?.runningBalance).toBe(1000);
    expect(petty.map((entry) => entry.amount)).toEqual([200, 150]);
    expect(petty[0].runningBalance).toBe(900);
    expect(petty[1].runningBalance).toBe(850);
  });

  it('does not deduct skipped bills and flags unpayable bills', () => {
    const entries = convertToLegacyEntries(
      [
        paycheck({
          date: '2026-01-02',
          budgetRemaining: -50,
          bills: [
            {
              billId: 'skip',
              creditorName: 'Skipped',
              amount: 80,
              dueDay: 2,
              priority: 'low',
              billDate: '2026-01-02',
              isSkipped: true,
            },
            {
              billId: 'gap',
              creditorName: 'Unpayable',
              amount: 40,
              dueDay: 2,
              priority: 'high',
              billDate: '2026-01-02',
              isUnpayable: true,
              unfundableReason: 'no_eligible_paycheck_in_window',
            },
          ],
        }),
      ],
      0
    );

    const skipped = entries.find((entry) => entry.description === 'Skipped (skipped)');
    const unpayable = entries.find((entry) => entry.description === 'Unpayable');
    expect(skipped?.runningBalance).toBe(1000);
    expect(unpayable?.runningBalance).toBe(960);
    expect(unpayable?.isShortfall).toBe(true);
    expect(unpayable?.recommendation).toBe('no_eligible_paycheck_in_window');
    expect(entries.some((entry) => entry.type === 'pettyCash')).toBe(false);
  });
});