import { describe, it, expect } from 'vitest';
import { movableBillCapacity } from '@shared/reconciliationSurplus';
import type { PaycheckEntry, ScheduleData } from '@shared/types';
import { analyzeAndProposeFixes } from '../../../electron/services/scheduler/reconciliation';

function buildPaycheck(overrides: Partial<PaycheckEntry>): PaycheckEntry {
  return {
    date: '2027-01-01',
    incomeSources: [{ id: 'inc-1', name: 'Paycheck', amount: 1000 }],
    totalIncome: 1000,
    bills: [],
    totalBills: 0,
    goalDeposits: [],
    totalGoalDeposits: 0,
    budgetRemaining: 250,
    savingsDeposit: 0,
    totalSavings: 0,
    isShortfall: false,
    ...overrides,
  };
}

describe('movableBillCapacity', () => {
  it('returns zero at target with no spare room', () => {
    expect(movableBillCapacity(250, 250, 100, false)).toBe(0);
  });

  it('returns surplus above target when healthy', () => {
    expect(movableBillCapacity(400, 250, 100, false)).toBe(150);
  });

  it('returns break-glass movable capacity between min and target', () => {
    expect(movableBillCapacity(150, 250, 100, false)).toBe(50);
  });

  it('returns zero below minimum or on shortfall', () => {
    expect(movableBillCapacity(80, 250, 100, false)).toBe(0);
    expect(movableBillCapacity(150, 250, 100, true)).toBe(0);
  });
});

describe('analyzeAndProposeFixes', () => {
  it('does not treat target paychecks as having $200 movable surplus', () => {
    const schedule: ScheduleData = {
      startDate: '2027-01-01',
      endDate: '2027-12-31',
      paychecks: [
        buildPaycheck({ date: '2027-01-15', budgetRemaining: 250 }),
        buildPaycheck({
          date: '2027-02-01',
          budgetRemaining: -50,
          isShortfall: true,
          bills: [{
            billId: 'bill-1',
            creditorName: 'Rent',
            amount: 200,
            dueDay: 1,
            priority: 'low',
            billDate: '2027-02-01',
            isIncomeAttached: false,
          }],
        }),
      ],
      fullPaychecks: [],
      viewportMonths: 12,
      entries: [],
      summary: {
        totalIncome: 0,
        totalExpenses: 0,
        totalSavingsDeposits: 0,
        finalSavingsBalance: 0,
        netBalance: 0,
        shortfallCount: 1,
        averageBalance: 0,
        lowestBalance: 0,
        highestBalance: 0,
      },
      recommendations: [],
      maxBudgetRemaining: 250,
      minCashOnHand: 100,
    };
    schedule.fullPaychecks = schedule.paychecks;

    const report = analyzeAndProposeFixes(schedule);
    expect(report.proposedFixes).toHaveLength(0);
  });

  it('proposes moves only from break-glass or above-target surplus', () => {
    const schedule: ScheduleData = {
      startDate: '2027-01-01',
      endDate: '2027-12-31',
      paychecks: [
        buildPaycheck({
          date: '2027-01-15',
          budgetRemaining: 150,
          bills: [],
        }),
        buildPaycheck({
          date: '2027-02-01',
          budgetRemaining: -50,
          isShortfall: true,
          bills: [{
            billId: 'bill-1',
            creditorName: 'Utility',
            amount: 40,
            dueDay: 5,
            priority: 'low',
            billDate: '2027-01-28',
            isIncomeAttached: false,
          }],
        }),
      ],
      fullPaychecks: [],
      viewportMonths: 12,
      entries: [],
      summary: {
        totalIncome: 0,
        totalExpenses: 0,
        totalSavingsDeposits: 0,
        finalSavingsBalance: 0,
        netBalance: 0,
        shortfallCount: 1,
        averageBalance: 0,
        lowestBalance: 0,
        highestBalance: 0,
      },
      recommendations: [],
      maxBudgetRemaining: 250,
      minCashOnHand: 100,
    };
    schedule.fullPaychecks = schedule.paychecks;

    const report = analyzeAndProposeFixes(schedule);
    expect(report.proposedFixes).toHaveLength(1);
    expect(report.proposedFixes[0].toPaycheckDate).toBe('2027-01-15');
  });
});
