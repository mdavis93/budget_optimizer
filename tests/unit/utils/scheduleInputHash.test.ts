import { describe, expect, it } from 'vitest';
import {
  buildBudgetFieldsHash,
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
});
