import { describe, expect, it } from 'vitest';
import type { Bill, Income, SavingsGoal } from '@shared/types';
import {
  assignPreparedHorizon,
  prepareScheduleHorizon,
} from '../../../electron/services/scheduler/scheduleBuild';
import { calculateSummary, convertToLegacyEntries } from '@shared/schedulePresentation';

const timestamps = {
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function operatingIncome(overrides: Partial<Income> = {}): Income {
  return {
    id: 'inc-op',
    sourceName: 'Salary',
    amount: 2000,
    cadence: 'monthly',
    startDate: '2026-01-15',
    isActive: true,
    purpose: 'operating',
    ...timestamps,
    ...overrides,
  };
}

function reservedIncome(overrides: Partial<Income> = {}): Income {
  return {
    id: 'inc-sg',
    sourceName: 'Bonus Pool',
    amount: 500,
    cadence: 'monthly',
    startDate: '2026-01-15',
    isActive: true,
    purpose: 'savingsAndGoals',
    ...timestamps,
    ...overrides,
  };
}

function rent(): Bill {
  return {
    id: 'bill-rent',
    creditorName: 'Rent',
    budgetedAmount: 1800,
    dueDay: 20,
    isRecurring: true,
    priority: 'critical',
    ...timestamps,
  };
}

function goal(): SavingsGoal {
  return {
    id: 'goal-1',
    budgetId: 'budget-1',
    name: 'Emergency',
    targetAmount: 5000,
    targetDate: '2026-12-31',
    alreadySaved: 0,
    priority: 1,
    createdAt: timestamps.createdAt,
  };
}

describe('savings-and-goals reserved income', () => {
  describe('happy', () => {
    it('keeps reserved deposits off bill slots and operating income totals', () => {
      const prepared = prepareScheduleHorizon({
        incomes: [operatingIncome(), reservedIncome()],
        bills: [rent()],
        startDateStr: '2026-01-01',
        startingBalance: 250,
        maxBudgetRemaining: 250,
        minCashOnHand: 100,
        goals: [goal()],
      });

      expect(prepared.paycheckDates).toHaveLength(prepared.operatingIncomes.length > 0 ? prepared.paycheckDates.length : 0);
      expect(prepared.operatingIncomes.every((income) => income.purpose !== 'savingsAndGoals')).toBe(true);
      expect(prepared.reservedIncomes.every((income) => income.purpose === 'savingsAndGoals')).toBe(true);

      const paychecks = assignPreparedHorizon(prepared);
      const reserved = paychecks.filter((p) => p.purpose === 'savingsAndGoals');
      const operating = paychecks.filter((p) => p.purpose !== 'savingsAndGoals');

      expect(reserved.length).toBeGreaterThan(0);
      expect(reserved.every((p) => p.bills.length === 0)).toBe(true);
      expect(reserved.every((p) => p.id?.startsWith('sg:'))).toBe(true);
      expect(operating.some((p) => p.bills.some((b) => b.billId === 'bill-rent'))).toBe(true);

      const sameDay = paychecks.filter((p) => p.date === '2026-01-15');
      expect(sameDay.map((p) => p.purpose).sort()).toEqual(['operating', 'savingsAndGoals']);

      const summary = calculateSummary(paychecks, 250, 250);
      const reservedTotal = reserved.reduce((sum, p) => sum + p.totalIncome, 0);
      expect(summary.totalIncome).toBeLessThan(operating.reduce((s, p) => s + p.totalIncome, 0) + reservedTotal);
      expect(summary.totalIncome).toBe(operating.reduce((s, p) => s + p.totalIncome, 0));

      const firstReserved = reserved.find((p) => p.date === '2026-01-15');
      const firstOperating = operating.find((p) => p.date === '2026-01-15');
      expect(firstReserved?.budgetRemaining).toBe(firstOperating?.budgetRemaining);
      expect(firstReserved!.totalGoalDeposits + firstReserved!.savingsDeposit).toBe(500);
    });
  });

  describe('sad', () => {
    it('does not invent bill dates when only reserved income exists', () => {
      const prepared = prepareScheduleHorizon({
        incomes: [reservedIncome()],
        bills: [rent()],
        startDateStr: '2026-01-01',
        startingBalance: 1000,
        maxBudgetRemaining: 250,
        minCashOnHand: 100,
      });

      expect(prepared.paycheckDates).toEqual([]);
      const paychecks = assignPreparedHorizon(prepared);
      expect(paychecks.every((p) => p.purpose === 'savingsAndGoals')).toBe(true);
      expect(paychecks.every((p) => p.bills.length === 0)).toBe(true);
      expect(paychecks[0]?.budgetRemaining).toBe(1000);
    });

    it('ignores inactive reserved sources and stale bill attachments', () => {
      const prepared = prepareScheduleHorizon({
        incomes: [
          operatingIncome(),
          reservedIncome({ isActive: false }),
        ],
        bills: [{
          ...rent(),
          isIncomeAttached: true,
          preferredIncomeSourceId: 'inc-sg',
        }],
        startDateStr: '2026-01-01',
        startingBalance: 250,
      });

      expect(prepared.reservedIncomes).toEqual([]);
      expect(prepared.incomeAttachedBillsRaw).toEqual([]);
    });
  });

  describe('hostile', () => {
    it('does not treat reserved deposits as spendable income in legacy entries', () => {
      const prepared = prepareScheduleHorizon({
        incomes: [reservedIncome({ sourceName: '<script>alert(1)</script>' })],
        bills: [],
        startDateStr: '2026-01-01',
        startingBalance: 0,
      });
      const paychecks = assignPreparedHorizon(prepared);
      const entries = convertToLegacyEntries(paychecks, 0);
      expect(entries.every((entry) => entry.type === 'savings')).toBe(true);
      expect(entries.some((entry) => entry.description.includes('<script>'))).toBe(true);
      expect(entries.every((entry) => entry.runningBalance === 0)).toBe(true);
    });
  });
});
