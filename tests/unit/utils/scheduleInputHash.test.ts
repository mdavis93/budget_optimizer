import { describe, expect, it } from 'vitest';
import {
  buildBudgetFieldsHash,
  buildScheduleEntityHash,
  buildScheduleInputHash,
  buildScheduleOverlayHash,
} from '../../../src/utils/scheduleInputHash';
import { createMockBill, createMockIncome } from '../../mocks/electron-api.mock';

describe('scheduleInputHash', () => {
  it('changes overlay hash when schedule assignments change', () => {
    const base = {
      skippedBills: [],
      billAssignments: [],
      incomeOverrides: [],
    };

    const before = buildScheduleOverlayHash(base);
    const after = buildScheduleOverlayHash({
      ...base,
      billAssignments: [
        { billId: 'bill-1', billDueDate: '2026-01-15', paycheckDate: '2026-01-01' },
      ],
    });

    expect(before).not.toBe(after);
  });

  it('includes budget fields in schedule input hash', () => {
    const incomes = [createMockIncome()];
    const bills = [createMockBill()];

    const withoutBudget = buildScheduleInputHash({
      incomes,
      bills,
      skippedBills: [],
      billAssignments: [],
      incomeOverrides: [],
      budgetFields: null,
    });

    const withBudget = buildScheduleInputHash({
      incomes,
      bills,
      skippedBills: [],
      billAssignments: [],
      incomeOverrides: [],
      budgetFields: {
        name: 'Personal',
        startingBalance: 1000,
        targetCashOnHand: 250,
        minCashOnHand: 100,
        minSavingsPerPaycheck: 50,
        scheduleStartDate: '2026-01-01',
      },
    });

    expect(withoutBudget).not.toBe(withBudget);
    expect(buildBudgetFieldsHash(null)).toBe('');
  });

  it('includes leaves in schedule input hash', () => {
    const incomes = [createMockIncome()];
    const bills = [createMockBill()];
    const base = {
      incomes,
      bills,
      skippedBills: [] as [],
      billAssignments: [] as [],
      incomeOverrides: [] as [],
      budgetFields: null,
    };

    const withoutLeaves = buildScheduleInputHash(base);
    const withLeaves = buildScheduleInputHash({
      ...base,
      leaves: [
        {
          id: 'leave-1',
          budgetId: 'budget-1',
          incomeId: 'income-1',
          name: 'Medical',
          type: 'unpaid' as const,
          startDate: '2026-02-01',
          endDate: '2026-02-14',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    expect(withoutLeaves).not.toBe(withLeaves);
  });

  it('includes leave cash overrides in schedule entity hash', () => {
    const incomes = [createMockIncome()];
    const bills = [createMockBill()];
    const leaveBase = {
      id: 'leave-1',
      budgetId: 'budget-1',
      incomeId: 'income-1',
      name: 'Medical',
      type: 'unpaid' as const,
      startDate: '2026-02-01',
      endDate: '2026-02-14',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const withoutCash = buildScheduleEntityHash(incomes, bills, [leaveBase]);
    const withCash = buildScheduleEntityHash(incomes, bills, [
      { ...leaveBase, targetCashOnHand: 100, minCashOnHand: 40 },
    ]);

    expect(withoutCash).not.toBe(withCash);
  });

  it('changes when goals, debts, or isIncomeAttached change', () => {
    const frozen = new Date(2026, 7, 20, 12, 0, 0);
    const base = {
      incomes: [createMockIncome()],
      bills: [createMockBill()],
      skippedBills: [] as [],
      billAssignments: [] as [],
      incomeOverrides: [] as [],
      now: frozen,
    };

    const withoutGoals = buildScheduleInputHash(base);
    const withGoals = buildScheduleInputHash({
      ...base,
      goals: [
        {
          id: 'goal-1',
          budgetId: 'budget-1',
          name: 'Emergency',
          targetAmount: 1000,
          targetDate: '2026-12-01',
          alreadySaved: 0,
          priority: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    expect(withoutGoals).not.toBe(withGoals);

    const withoutDebts = buildScheduleInputHash(base);
    const withDebts = buildScheduleInputHash({
      ...base,
      debts: [
        {
          id: 'debt-1',
          budgetId: 'budget-1',
          billId: 'bill-1',
          principalBalance: 5000,
          apr: 0.199,
          monthlyPayment: 150,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    expect(withoutDebts).not.toBe(withDebts);

    const unattached = buildScheduleInputHash(base);
    const attached = buildScheduleInputHash({
      ...base,
      bills: [createMockBill({ isIncomeAttached: true, preferredIncomeSourceId: 'income-1' })],
    });
    expect(unattached).not.toBe(attached);
  });
});
