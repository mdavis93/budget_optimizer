import { describe, it, expect } from 'vitest';
import {
  getNextIncomeDate,
  getPaycheckDatesForIncome,
} from '../../../electron/utils/paycheck-calculator';
import { Income } from '../../../electron/services/database.service';
import { parseISO, format } from 'date-fns';

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
});
