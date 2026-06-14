import { describe, it, expect } from 'vitest';
import {
  getCadenceMonthlyMultiplier,
  getMonthlyBillEquivalent,
  getMonthlyIncomeEquivalent,
} from '../../../src/utils/cadence';
import { Bill, Income } from '../../../src/types';

function makeIncome(overrides: Partial<Income> = {}): Income {
  return {
    id: 'income-1',
    sourceName: 'Salary',
    amount: 1000,
    cadence: 'biweekly',
    startDate: '2026-01-01',
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeBill(overrides: Partial<Bill> = {}): Bill {
  return {
    id: 'bill-1',
    creditorName: 'Test Bill',
    budgetedAmount: 100,
    dueDay: 1,
    isRecurring: true,
    priority: 'normal',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('cadence', () => {
  describe('getCadenceMonthlyMultiplier', () => {
    it('returns expected multipliers for each cadence', () => {
      expect(getCadenceMonthlyMultiplier('weekly')).toBe(4.33);
      expect(getCadenceMonthlyMultiplier('biweekly')).toBe(2.17);
      expect(getCadenceMonthlyMultiplier('semimonthly')).toBe(2);
      expect(getCadenceMonthlyMultiplier('monthly')).toBe(1);
    });
  });

  describe('getMonthlyIncomeEquivalent', () => {
    it('scales income by cadence multiplier', () => {
      expect(getMonthlyIncomeEquivalent(makeIncome({ amount: 100, cadence: 'biweekly' }))).toBe(217);
    });
  });

  describe('getMonthlyBillEquivalent', () => {
    it('returns raw amount for due-date bills', () => {
      const bill = makeBill({ budgetedAmount: 150, isIncomeAttached: false });
      expect(getMonthlyBillEquivalent(bill, [])).toBe(150);
    });

    it('scales per-paycheck bills by attached income cadence', () => {
      const income = makeIncome({ id: 'pay-1', cadence: 'biweekly' });
      const bill = makeBill({
        budgetedAmount: 300,
        isIncomeAttached: true,
        preferredIncomeSourceId: 'pay-1',
      });

      expect(getMonthlyBillEquivalent(bill, [income])).toBeCloseTo(651, 2);
    });

    it('scales semimonthly per-paycheck bills by 2', () => {
      const income = makeIncome({ id: 'pay-1', cadence: 'semimonthly' });
      const bill = makeBill({
        budgetedAmount: 75,
        isIncomeAttached: true,
        preferredIncomeSourceId: 'pay-1',
      });

      expect(getMonthlyBillEquivalent(bill, [income])).toBe(150);
    });

    it('falls back to raw amount when attached income is missing', () => {
      const bill = makeBill({
        budgetedAmount: 200,
        isIncomeAttached: true,
        preferredIncomeSourceId: 'missing-income',
      });

      expect(getMonthlyBillEquivalent(bill, [makeIncome()])).toBe(200);
    });

    it('falls back to raw amount when attached income is inactive', () => {
      const income = makeIncome({ id: 'pay-1', isActive: false });
      const bill = makeBill({
        budgetedAmount: 200,
        isIncomeAttached: true,
        preferredIncomeSourceId: 'pay-1',
      });

      expect(getMonthlyBillEquivalent(bill, [income])).toBe(200);
    });

    it('sums two biweekly per-paycheck bills to monthly equivalent', () => {
      const income = makeIncome({ id: 'pay-1', cadence: 'biweekly' });
      const bills = [
        makeBill({
          id: 'bill-a',
          budgetedAmount: 300,
          isIncomeAttached: true,
          preferredIncomeSourceId: 'pay-1',
        }),
        makeBill({
          id: 'bill-b',
          budgetedAmount: 200,
          isIncomeAttached: true,
          preferredIncomeSourceId: 'pay-1',
        }),
      ];

      const total = bills.reduce(
        (sum, bill) => sum + getMonthlyBillEquivalent(bill, [income]),
        0
      );

      expect(total).toBeCloseTo(1085, 2);
      expect(total).not.toBe(500);
    });
  });
});
