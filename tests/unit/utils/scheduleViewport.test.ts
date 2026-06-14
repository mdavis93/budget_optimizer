import { describe, expect, it } from 'vitest';
import { applyScheduleViewport } from '../../../src/utils/scheduleViewport';
import { Bill, PaycheckEntry, ScheduleData } from '../../../src/types';
import { createMockBill, createMockPaycheck, createMockSchedule } from '../../mocks/electron-api.mock';

function buildMonthlyPaychecks(): PaycheckEntry[] {
  return Array.from({ length: 12 }, (_, idx) => {
    const month = String(idx + 1).padStart(2, '0');
    return createMockPaycheck({
      date: `2026-${month}-01`,
      totalIncome: 1000 + idx * 10,
      totalBills: 600 + idx * 5,
      savingsDeposit: 50,
      totalSavings: (idx + 1) * 50,
      budgetRemaining: idx === 7 ? -40 : 300 - idx * 10,
      isShortfall: idx === 7,
      bills: [
        {
          billId: `bill-${idx}`,
          creditorName: `Bill ${idx}`,
          amount: 100 + idx,
          dueDay: 1,
          priority: 'normal',
          billDate: `2026-${month}-01`,
        },
      ],
      goalDeposits: [],
      totalGoalDeposits: 0,
    });
  });
}

function buildSchedule(overrides: Partial<ScheduleData> = {}): ScheduleData {
  const fullPaychecks = buildMonthlyPaychecks();
  return createMockSchedule({
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    paychecks: fullPaychecks,
    fullPaychecks,
    viewportMonths: 12,
    reconciliation: {
      needsReconciliation: true,
      shortfalls: [
        {
          paycheckDate: '2026-08-01',
          deficit: 40,
          bills: [],
        },
      ],
      proposedFixes: [
        {
          id: 'fix-june',
          type: 'move_bill',
          billId: 'bill-6',
          billName: 'June Bill',
          billAmount: 100,
          fromPaycheckDate: '2026-06-01',
          toPaycheckDate: '2026-05-01',
          billDueDate: '2026-06-01',
          reason: 'avoid shortfall',
          impact: 100,
        },
        {
          id: 'fix-aug',
          type: 'skip_bill',
          billId: 'bill-8',
          billName: 'August Bill',
          billAmount: 120,
          fromPaycheckDate: '2026-08-01',
          billDueDate: '2026-08-01',
          reason: 'avoid shortfall',
          impact: 120,
        },
      ],
      canBeFullyResolved: false,
      totalDeficit: 40,
      estimatedResolution: 20,
    },
    ...overrides,
  }) as ScheduleData;
}

describe('applyScheduleViewport', () => {
  const bills: Bill[] = [createMockBill({ id: 'bill-source', priority: 'critical' })];

  describe('happy', () => {
    it('slices 3 and 6 month viewports from full paychecks', () => {
      const fullSchedule = buildSchedule();

      const threeMonth = applyScheduleViewport(fullSchedule, 3, bills, 1000);
      const sixMonth = applyScheduleViewport(fullSchedule, 6, bills, 1000);

      expect(threeMonth.paychecks).toHaveLength(4);
      expect(threeMonth.paychecks.at(-1)?.date).toBe('2026-04-01');
      expect(threeMonth.endDate).toBe('2026-04-01');

      expect(sixMonth.paychecks).toHaveLength(7);
      expect(sixMonth.paychecks.at(-1)?.date).toBe('2026-07-01');
      expect(sixMonth.endDate).toBe('2026-07-01');
    });

    it('keeps full 12 month view unchanged', () => {
      const fullSchedule = buildSchedule();
      const viewport = applyScheduleViewport(fullSchedule, 12, bills, 1000);

      expect(viewport.paychecks).toHaveLength(fullSchedule.fullPaychecks.length);
      expect(viewport.endDate).toBe(fullSchedule.endDate);
      expect(viewport.viewportMonths).toBe(12);
    });

    it('recalculates summary from sliced viewport paychecks', () => {
      const fullSchedule = buildSchedule({
        summary: {
          totalIncome: 999_999,
          totalExpenses: 999_999,
          totalSavingsDeposits: 999_999,
          finalSavingsBalance: 999_999,
          netBalance: 999_999,
          shortfallCount: 999,
          averageBalance: 999_999,
          lowestBalance: -999_999,
          highestBalance: 999_999,
        },
      });

      const viewport = applyScheduleViewport(fullSchedule, 3, bills, 1000);

      expect(viewport.summary.totalIncome).toBe(4060);
      expect(viewport.summary.totalExpenses).toBe(2430);
      expect(viewport.summary.totalSavingsDeposits).toBe(200);
      expect(viewport.summary.shortfallCount).toBe(0);
      expect(viewport.summary.finalSavingsBalance).toBe(200);
      expect(viewport.summary.netBalance).toBe(1630);
    });
  });

  describe('sad', () => {
    it('filters reconciliation details to viewport range', () => {
      const fullSchedule = buildSchedule();
      const viewport = applyScheduleViewport(fullSchedule, 6, bills, 1000);

      expect(viewport.reconciliation?.shortfalls).toEqual([]);
      expect(viewport.reconciliation?.proposedFixes.map((fix) => fix.id)).toEqual(['fix-june']);
      expect(viewport.reconciliation?.needsReconciliation).toBe(false);
      expect(viewport.reconciliation?.totalDeficit).toBe(0);
    });

    it('returns a stable schedule with empty paychecks', () => {
      const fullSchedule = buildSchedule({
        paychecks: [],
        fullPaychecks: [],
        reconciliation: undefined,
      });
      const viewport = applyScheduleViewport(fullSchedule, 3, bills, 500);

      expect(viewport.paychecks).toEqual([]);
      expect(viewport.summary.averageBalance).toBe(500);
      expect(viewport.summary.lowestBalance).toBe(500);
      expect(viewport.summary.highestBalance).toBe(500);
      expect(viewport.reconciliation).toBeUndefined();
    });
  });

  describe('hostile', () => {
    it('treats out-of-range viewport months as full schedule', () => {
      const fullSchedule = buildSchedule();
      const viewport = applyScheduleViewport(fullSchedule, 99, bills, 1000);

      expect(viewport.paychecks).toHaveLength(fullSchedule.fullPaychecks.length);
      expect(viewport.endDate).toBe(fullSchedule.endDate);
      expect(viewport.reconciliation?.shortfalls).toHaveLength(1);
      expect(viewport.reconciliation?.needsReconciliation).toBe(true);
    });

    it('builds legacy entries for income, goals, and savings transfers', () => {
      const fullSchedule = buildSchedule({
        paychecks: [
          createMockPaycheck({
            date: '2026-01-01',
            incomeSources: [
              { id: 'income-1', name: 'Salary', amount: 2000 },
              { id: 'income-2', name: 'Bonus', amount: 200 },
            ],
            goalDeposits: [{ goalId: 'goal-1', goalName: 'Trip', amount: 100 }],
            savingsDeposit: 50,
            totalIncome: 2200,
            totalBills: 500,
            totalGoalDeposits: 100,
            budgetRemaining: 1550,
            totalSavings: 0,
            isShortfall: false,
          }),
        ],
        fullPaychecks: [
          createMockPaycheck({
            date: '2026-01-01',
            incomeSources: [
              { id: 'income-1', name: 'Salary', amount: 2000 },
              { id: 'income-2', name: 'Bonus', amount: 200 },
            ],
            goalDeposits: [{ goalId: 'goal-1', goalName: 'Trip', amount: 100 }],
            savingsDeposit: 50,
            totalIncome: 2200,
            totalBills: 500,
            totalGoalDeposits: 100,
            budgetRemaining: 1550,
            totalSavings: 0,
            isShortfall: false,
          }),
        ],
      });

      const viewport = applyScheduleViewport(fullSchedule, 3, [], 1000);
      expect(viewport.entries.some((entry) => entry.type === 'income')).toBe(true);
      expect(viewport.entries.some((entry) => entry.description.includes('Goal:'))).toBe(true);
      expect(viewport.entries.some((entry) => entry.description === 'Transfer to Savings')).toBe(true);
      expect(viewport.recommendations.some((rec) => rec.includes('Your budget looks balanced'))).toBe(true);
    });

    it('keeps reconciliation fixes without paycheck dates', () => {
      const fullSchedule = buildSchedule({
        reconciliation: {
          needsReconciliation: false,
          shortfalls: [],
          proposedFixes: [{
            id: 'fix-no-date',
            type: 'move_bill',
            billId: 'bill-1',
            billName: 'Bill',
            billAmount: 10,
            fromPaycheckDate: undefined as unknown as string,
            billDueDate: '2026-01-01',
            reason: 'x',
            impact: 1,
          }],
          canBeFullyResolved: true,
          totalDeficit: 0,
          estimatedResolution: 0,
        },
      });

      const viewport = applyScheduleViewport(fullSchedule, 3, [], 1000);
      expect(viewport.reconciliation?.proposedFixes).toHaveLength(1);
    });

    it('adds rebalanced and heavy-paycheck recommendations', () => {
      const fullSchedule = buildSchedule({
        paychecks: [
          createMockPaycheck({
            date: '2026-01-01',
            totalIncome: 1000,
            totalBills: 1100,
            savingsDeposit: 0,
            budgetRemaining: 50,
            isShortfall: false,
          }),
        ],
        fullPaychecks: [
          createMockPaycheck({
            date: '2026-01-01',
            totalIncome: 1000,
            totalBills: 1100,
            savingsDeposit: 0,
            budgetRemaining: 50,
            isShortfall: false,
          }),
        ],
        reconciliation: undefined,
      });

      const viewport = applyScheduleViewport(fullSchedule, 3, [], 1000);
      expect(viewport.recommendations.some((rec) => rec.includes('Budget optimized'))).toBe(true);
      expect(viewport.recommendations.some((rec) => rec.includes('over 90% of income'))).toBe(true);
    });
  });
});
