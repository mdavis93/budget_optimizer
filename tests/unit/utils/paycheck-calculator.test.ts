import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getNextIncomeDate,
  getPaycheckDatesForIncome,
  getPaycheckDatesInRange,
  countPaychecksInRange,
  countPaychecksUntilDate,
  getPaycheckDatesUntilGoal,
  calculateAveragePaycheckIncome,
  calculateGlidePath,
  calculateAllocationMultiplier,
  estimateAchievableAmount,
} from '../../../electron/utils/paycheck-calculator';
import { Income } from '../../../electron/services/database.service';
import { parseISO, format, addWeeks, addMonths } from 'date-fns';

describe('paycheck-calculator', () => {
  describe('getNextIncomeDate', () => {
    it('adds 1 week for weekly cadence', () => {
      const date = parseISO('2026-01-01');
      const next = getNextIncomeDate(date, 'weekly');
      expect(format(next, 'yyyy-MM-dd')).toBe('2026-01-08');
    });

    it('adds 2 weeks for biweekly cadence', () => {
      const date = parseISO('2026-01-01');
      const next = getNextIncomeDate(date, 'biweekly');
      expect(format(next, 'yyyy-MM-dd')).toBe('2026-01-15');
    });

    it('handles semimonthly from 1st to 15th', () => {
      const date = parseISO('2026-01-01');
      const next = getNextIncomeDate(date, 'semimonthly');
      expect(format(next, 'yyyy-MM-dd')).toBe('2026-01-15');
    });

    it('handles semimonthly from 15th to next month 1st', () => {
      const date = parseISO('2026-01-15');
      const next = getNextIncomeDate(date, 'semimonthly');
      expect(format(next, 'yyyy-MM-dd')).toBe('2026-02-01');
    });

    it('handles semimonthly mid-month before the 15th', () => {
      const date = parseISO('2026-01-10');
      const next = getNextIncomeDate(date, 'semimonthly');
      expect(format(next, 'yyyy-MM-dd')).toBe('2026-01-15');
    });

    it('handles semimonthly mid-month after the 15th', () => {
      const date = parseISO('2026-01-20');
      const next = getNextIncomeDate(date, 'semimonthly');
      expect(format(next, 'yyyy-MM-dd')).toBe('2026-02-01');
    });

    it('falls back to monthly cadence for unknown cadence values', () => {
      const date = parseISO('2026-01-15');
      const next = getNextIncomeDate(date, 'unknown' as Income['cadence']);
      expect(format(next, 'yyyy-MM-dd')).toBe('2026-02-15');
    });

    it('adds 1 month for monthly cadence', () => {
      const date = parseISO('2026-01-15');
      const next = getNextIncomeDate(date, 'monthly');
      expect(format(next, 'yyyy-MM-dd')).toBe('2026-02-15');
    });
  });

  describe('getPaycheckDatesForIncome', () => {
    const baseIncome: Income = {
      id: 'income-1',
      sourceName: 'Salary',
      amount: 2000,
      cadence: 'biweekly',
      startDate: '2026-01-01',
      isActive: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    it('returns empty array for inactive income', () => {
      const inactive = { ...baseIncome, isActive: false };
      const result = getPaycheckDatesForIncome(
        inactive,
        parseISO('2026-01-01'),
        parseISO('2026-03-01')
      );
      expect(result).toHaveLength(0);
    });

    it('generates correct paychecks for biweekly income', () => {
      const result = getPaycheckDatesForIncome(
        baseIncome,
        parseISO('2026-01-01'),
        parseISO('2026-01-31')
      );
      
      // Jan has ~2 biweekly paychecks from Jan 1
      expect(result.length).toBeGreaterThanOrEqual(2);
      expect(result[0].amount).toBe(2000);
      expect(result[0].incomeName).toBe('Salary');
    });

    it('includes paycheck metadata', () => {
      const result = getPaycheckDatesForIncome(
        baseIncome,
        parseISO('2026-01-01'),
        parseISO('2026-01-15')
      );
      
      expect(result[0].incomeId).toBe('income-1');
      expect(result[0].incomeName).toBe('Salary');
      expect(result[0].amount).toBe(2000);
    });

    it('stops at income endDate when set', () => {
      const income = { ...baseIncome, endDate: '2026-01-15' };
      const result = getPaycheckDatesForIncome(
        income,
        parseISO('2026-01-01'),
        parseISO('2026-03-01')
      );

      expect(result.length).toBeGreaterThan(0);
      result.forEach(p => {
        expect(p.date.getTime()).toBeLessThanOrEqual(parseISO('2026-01-15').getTime());
      });
    });
  });

  describe('getPaycheckDatesInRange', () => {
    it('returns unique dates from multiple income sources', () => {
      const income1: Income = {
        id: 'income-1',
        sourceName: 'Salary',
        amount: 2000,
        cadence: 'biweekly',
        startDate: '2026-01-01',
        isActive: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };

      const income2: Income = {
        id: 'income-2',
        sourceName: 'Side Job',
        amount: 500,
        cadence: 'weekly',
        startDate: '2026-01-01',
        isActive: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };

      const result = getPaycheckDatesInRange(
        [income1, income2],
        parseISO('2026-01-01'),
        parseISO('2026-01-31')
      );
      
      // Weekly has more dates than biweekly
      expect(result.length).toBeGreaterThanOrEqual(4);
      
      // Dates should be sorted
      for (let i = 1; i < result.length; i++) {
        expect(result[i].getTime()).toBeGreaterThan(result[i - 1].getTime());
      }
    });

    it('returns sorted dates', () => {
      const income: Income = {
        id: 'income-1',
        sourceName: 'Salary',
        amount: 2000,
        cadence: 'weekly',
        startDate: '2026-01-01',
        isActive: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };

      const result = getPaycheckDatesInRange(
        [income],
        parseISO('2026-01-01'),
        parseISO('2026-02-28')
      );
      
      for (let i = 1; i < result.length; i++) {
        expect(result[i].getTime()).toBeGreaterThanOrEqual(result[i - 1].getTime());
      }
    });
  });

  describe('countPaychecksInRange', () => {
    it('counts paychecks correctly', () => {
      const income: Income = {
        id: 'income-1',
        sourceName: 'Salary',
        amount: 2000,
        cadence: 'biweekly',
        startDate: '2026-01-01',
        isActive: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };

      const count = countPaychecksInRange(
        [income],
        parseISO('2026-01-01'),
        parseISO('2026-06-30')
      );
      
      // 6 months biweekly = ~13 paychecks
      expect(count).toBeGreaterThanOrEqual(12);
      expect(count).toBeLessThanOrEqual(14);
    });
  });

  describe('getPaycheckDatesUntilGoal', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns paycheck dates from today through the goal deadline', () => {
      const income: Income = {
        id: 'income-1',
        sourceName: 'Salary',
        amount: 2000,
        cadence: 'biweekly',
        startDate: '2026-01-01',
        isActive: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };

      const dates = getPaycheckDatesUntilGoal([income], parseISO('2026-03-01'));
      expect(dates.length).toBeGreaterThanOrEqual(4);
      expect(dates[0].getTime()).toBeLessThanOrEqual(parseISO('2026-03-01').getTime());
    });
  });

  describe('calculateAveragePaycheckIncome', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns zero when no incomes are provided', () => {
      expect(calculateAveragePaycheckIncome([])).toBe(0);
    });

    it('ignores inactive incomes when averaging paycheck income', () => {
      const active: Income = {
        id: 'income-1',
        sourceName: 'Salary',
        amount: 2000,
        cadence: 'monthly',
        startDate: '2026-01-01',
        isActive: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };
      const inactive: Income = {
        ...active,
        id: 'income-2',
        sourceName: 'Side',
        amount: 5000,
        isActive: false,
      };

      const average = calculateAveragePaycheckIncome([active, inactive]);
      expect(average).toBe(2000);
    });

    it('averages income across unique paycheck dates in a three-month window', () => {
      const income: Income = {
        id: 'income-1',
        sourceName: 'Salary',
        amount: 3000,
        cadence: 'monthly',
        startDate: '2026-01-01',
        isActive: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };

      const average = calculateAveragePaycheckIncome([income]);
      expect(average).toBeGreaterThan(0);
      expect(average).toBeLessThanOrEqual(3000);
    });
  });

  describe('countPaychecksUntilDate', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('counts paychecks from today until goal deadline', () => {
      const income: Income = {
        id: 'income-1',
        sourceName: 'Salary',
        amount: 2000,
        cadence: 'biweekly',
        startDate: '2026-01-01',
        isActive: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };

      const count = countPaychecksUntilDate(
        [income],
        parseISO('2026-12-31')
      );
      
      // 12 months biweekly = ~26 paychecks
      expect(count).toBeGreaterThanOrEqual(24);
      expect(count).toBeLessThanOrEqual(27);
    });
  });

  describe('calculateGlidePath', () => {
    it('creates equal contribution points', () => {
      const totalToSave = 5000;
      const dates = [
        parseISO('2026-01-15'),
        parseISO('2026-01-29'),
        parseISO('2026-02-12'),
        parseISO('2026-02-26'),
        parseISO('2026-03-12'),
      ];

      const glidePath = calculateGlidePath(totalToSave, dates);
      
      expect(glidePath.length).toBe(5);
      expect(glidePath[0].idealContribution).toBe(1000);
      expect(glidePath[0].expectedProgress).toBe(1000);
      expect(glidePath[4].expectedProgress).toBe(5000);
    });

    it('returns empty array for no paychecks', () => {
      const glidePath = calculateGlidePath(5000, []);
      expect(glidePath).toHaveLength(0);
    });

    it('includes paycheck dates', () => {
      const dates = [parseISO('2026-01-15'), parseISO('2026-01-29')];
      const glidePath = calculateGlidePath(2000, dates);
      
      expect(glidePath[0].paycheckDate).toEqual(dates[0]);
      expect(glidePath[1].paycheckDate).toEqual(dates[1]);
    });
  });

  describe('calculateAllocationMultiplier', () => {
    it('returns 1.5 when significantly behind (< 80%)', () => {
      const multiplier = calculateAllocationMultiplier(700, 1000);
      expect(multiplier).toBe(1.5);
    });

    it('returns 1.2 when slightly behind (80-100%)', () => {
      const multiplier = calculateAllocationMultiplier(900, 1000);
      expect(multiplier).toBe(1.2);
    });

    it('returns 1.0 when on track (100-120%)', () => {
      const multiplier = calculateAllocationMultiplier(1100, 1000);
      expect(multiplier).toBe(1.0);
    });

    it('returns 0.7 when ahead (> 120%)', () => {
      const multiplier = calculateAllocationMultiplier(1300, 1000);
      expect(multiplier).toBe(0.7);
    });

    it('returns 1.0 when expected is zero', () => {
      const multiplier = calculateAllocationMultiplier(100, 0);
      expect(multiplier).toBe(1.0);
    });
  });

  describe('estimateAchievableAmount', () => {
    it('calculates correctly with no min savings', () => {
      const amount = estimateAchievableAmount(10, 500, 0);
      expect(amount).toBe(5000);
    });

    it('respects minimum savings per paycheck', () => {
      const amount = estimateAchievableAmount(10, 500, 100);
      expect(amount).toBe(4000); // (500-100) * 10
    });

    it('returns 0 when surplus is less than min savings', () => {
      const amount = estimateAchievableAmount(10, 50, 100);
      expect(amount).toBe(0);
    });
  });
});
