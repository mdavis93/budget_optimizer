import { describe, expect, it } from 'vitest';
import {
  filterBreakGlassPlansByDryRun,
  isBreakGlassPlanDryRunSafe,
  preferredMapFromPlanSteps,
} from '../../../electron/services/scheduler/breakGlassDryRun';
import type {
  BreakGlassAdvisorReport,
  BreakGlassPlan,
  PaycheckEntry,
  ScheduleData,
} from '@shared/types';

function paycheck(
  overrides: Partial<PaycheckEntry> & Pick<PaycheckEntry, 'date' | 'budgetRemaining'>
): PaycheckEntry {
  return {
    incomeSources: [{ id: 'inc-1', name: 'Pay', amount: 2000 }],
    totalIncome: 2000,
    bills: [],
    totalBills: 0,
    goalDeposits: [],
    totalGoalDeposits: 0,
    savingsDeposit: 0,
    totalSavings: 0,
    isShortfall: overrides.budgetRemaining < 100,
    targetCashOnHand: 250,
    minCashOnHand: 100,
    unpayableCount: 0,
    hasUnpayableBills: false,
    ...overrides,
  };
}

function scheduleOf(paychecks: PaycheckEntry[]): ScheduleData {
  return {
    startDate: '2026-08-01',
    endDate: '2026-12-31',
    paychecks,
    fullPaychecks: paychecks,
    viewportMonths: 12,
    entries: [],
    summary: {
      totalIncome: 0,
      totalExpenses: 0,
      totalSavingsDeposits: 0,
      finalSavingsBalance: 0,
      netBalance: 0,
      shortfallCount: paychecks.filter((p) => p.isShortfall).length,
      averageBalance: 0,
      lowestBalance: 0,
      highestBalance: 0,
    },
    recommendations: [],
    maxBudgetRemaining: 250,
    minCashOnHand: 100,
  };
}

function plan(overrides: Partial<BreakGlassPlan> = {}): BreakGlassPlan {
  return {
    id: 'break-glass-2026-08-21',
    targetPaycheckDate: '2026-08-21',
    headline: 'Clear Break-Glass on Aug 21, 2026',
    maxDaysEarly: 14,
    clearsBreakGlass: true,
    steps: [
      {
        billId: 'sw',
        billName: 'CC: SW [A]',
        billAmount: 125,
        billDueDate: '2026-08-21',
        fromPaycheckDate: '2026-08-21',
        toPaycheckDate: '2026-08-07',
        daysEarly: 14,
        requiresConfirmation: false,
      },
    ],
    ...overrides,
  };
}

describe('breakGlassDryRun', () => {
  it('builds preferred map from plan steps', () => {
    const map = preferredMapFromPlanSteps(plan().steps);
    expect(map.get('sw-2026-08-21')).toBe('2026-08-07');
  });

  it('rejects dry-runs that create unpayable shortfalls (Aug 7 style)', () => {
    const baseline = scheduleOf([
      paycheck({ date: '2026-08-07', budgetRemaining: 250 }),
      paycheck({
        date: '2026-08-21',
        budgetRemaining: 150,
        bills: [
          {
            billId: 'sw',
            creditorName: 'CC: SW [A]',
            amount: 125,
            dueDay: 21,
            priority: 'normal',
            billDate: '2026-08-21',
            isIncomeAttached: false,
            isUnpayable: false,
            isSkipped: false,
          },
        ],
      }),
    ]);

    const trial = scheduleOf([
      paycheck({
        date: '2026-08-07',
        budgetRemaining: -140,
        isShortfall: true,
        hasUnpayableBills: true,
        unpayableCount: 1,
        bills: [
          {
            billId: 'jeep',
            creditorName: 'Car (Jeep)',
            amount: 425,
            dueDay: 7,
            priority: 'critical',
            billDate: '2026-08-07',
            isIncomeAttached: true,
            isUnpayable: true,
            isSkipped: false,
          },
          {
            billId: 'sw',
            creditorName: 'CC: SW [A]',
            amount: 125,
            dueDay: 21,
            priority: 'normal',
            billDate: '2026-08-21',
            isIncomeAttached: false,
            isUnpayable: false,
            isSkipped: false,
          },
        ],
      }),
      paycheck({ date: '2026-08-21', budgetRemaining: 250 }),
    ]);

    expect(isBreakGlassPlanDryRunSafe(baseline, trial, '2026-08-21')).toBe(false);
  });

  it('accepts dry-runs that clear Break-Glass without new shortfalls', () => {
    const baseline = scheduleOf([
      paycheck({ date: '2026-08-07', budgetRemaining: 400 }),
      paycheck({ date: '2026-08-21', budgetRemaining: 150 }),
    ]);
    const trial = scheduleOf([
      paycheck({ date: '2026-08-07', budgetRemaining: 275 }),
      paycheck({ date: '2026-08-21', budgetRemaining: 250 }),
    ]);

    expect(isBreakGlassPlanDryRunSafe(baseline, trial, '2026-08-21')).toBe(true);
  });

  it('filters out unsafe plans via dry-run callback', () => {
    const baseline = scheduleOf([
      paycheck({ date: '2026-08-07', budgetRemaining: 250 }),
      paycheck({ date: '2026-08-21', budgetRemaining: 150 }),
    ]);
    const report: BreakGlassAdvisorReport = { plans: [plan()] };

    const filtered = filterBreakGlassPlansByDryRun(report, baseline, () =>
      scheduleOf([
        paycheck({
          date: '2026-08-07',
          budgetRemaining: -140,
          isShortfall: true,
          hasUnpayableBills: true,
          unpayableCount: 1,
        }),
        paycheck({ date: '2026-08-21', budgetRemaining: 250 }),
      ])
    );

    expect(filtered.plans).toEqual([]);
  });

  it('keeps safe plans and accumulates preferred for later dry-runs', () => {
    const baseline = scheduleOf([
      paycheck({ date: '2026-08-07', budgetRemaining: 500 }),
      paycheck({ date: '2026-08-21', budgetRemaining: 150 }),
      paycheck({ date: '2026-09-25', budgetRemaining: 150 }),
    ]);
    const report: BreakGlassAdvisorReport = {
      plans: [
        plan(),
        plan({
          id: 'break-glass-2026-09-25',
          targetPaycheckDate: '2026-09-25',
          headline: 'Clear Break-Glass on Sep 25, 2026',
          steps: [
            {
              billId: 'electric',
              billName: 'Electric',
              billAmount: 250,
              billDueDate: '2026-09-25',
              fromPaycheckDate: '2026-09-25',
              toPaycheckDate: '2026-09-11',
              daysEarly: 14,
              requiresConfirmation: false,
            },
          ],
        }),
      ],
    };

    const preferredSeen: Array<string[]> = [];
    const filtered = filterBreakGlassPlansByDryRun(report, baseline, (preferred) => {
      preferredSeen.push([...preferred.keys()]);
      return scheduleOf([
        paycheck({ date: '2026-08-07', budgetRemaining: 375 }),
        paycheck({ date: '2026-08-21', budgetRemaining: 250 }),
        paycheck({ date: '2026-09-25', budgetRemaining: 250 }),
      ]);
    });

    expect(filtered.plans).toHaveLength(2);
    expect(preferredSeen[0]).toEqual(['sw-2026-08-21']);
    expect(preferredSeen[1]).toEqual(['sw-2026-08-21', 'electric-2026-09-25']);
  });
});
