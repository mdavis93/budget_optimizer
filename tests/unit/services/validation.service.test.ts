import { describe, it, expect } from 'vitest';
import {
  validateIncome,
  validateBill,
  validateSettings,
  assertValid,
  validateGoal,
  validateDebt,
  validateBudget,
  validateDraftOverlay,
  validateReconciliationFix,
  validateReconciliationFixes,
  validateSkippedBill,
  validateBillAssignment,
} from '../../../electron/services/validation.service';

describe('validation.service', () => {
  describe('happy', () => {
    it('accepts valid income payload', () => {
      const result = validateIncome({
        sourceName: 'Primary Salary',
        amount: 3500,
        cadence: 'biweekly',
        startDate: '2026-01-15',
        isActive: true,
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('accepts valid bill payload', () => {
      const result = validateBill({
        creditorName: 'Mortgage',
        budgetedAmount: 1800,
        dueDay: 1,
        category: 'Housing',
        isRecurring: true,
        priority: 'critical',
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('accepts budget scheduleStartDate in YYYY-MM-DD format', () => {
      const result = validateBudget({
        name: 'Personal',
        scheduleStartDate: '2026-06-01',
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('sad', () => {
    it('throws ValidationError from assertValid when payload is invalid', () => {
      expect(() =>
        assertValid(
          validateIncome({
            sourceName: '',
            amount: -1,
            cadence: 'weekly',
            startDate: '2026-01-01',
            isActive: true,
          } as never),
          'Income validation'
        )
      ).toThrow('Income validation');
    });

    it('rejects dangerous and unknown settings keys', () => {
      const result = validateSettings(
        JSON.parse('{"__proto__":{"polluted":true},"unknownKey":"value"}') as Record<string, unknown>
      );

      expect(result.valid).toBe(false);
      expect(result.errors.some(error => error.includes('__proto__'))).toBe(true);
      expect(result.errors.some(error => error.includes('unknownKey'))).toBe(true);
    });

    it('rejects malformed draft overlay assignments', () => {
      const result = validateDraftOverlay({
        billAssignments: [{
          billId: 'bad',
          billDueDate: 'not-a-date',
          paycheckDate: '2026-01-01',
        }],
      });

      expect(result.valid).toBe(false);
    });

    it('rejects invalid income payload fields', () => {
      const result = validateIncome({
        sourceName: '',
        amount: -1,
        cadence: 'hourly',
        startDate: '06-01-2026',
        isActive: true,
      } as never);

      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(expect.arrayContaining([
        'Source name is required',
        'Amount must be greater than 0',
        'Cadence must be one of: weekly, biweekly, semimonthly, monthly',
        'Start date must be in YYYY-MM-DD format',
      ]));
    });

    it('rejects invalid bill payload fields', () => {
      const result = validateBill({
        creditorName: '   ',
        budgetedAmount: Number.NaN,
        dueDay: 0,
        category: 'x'.repeat(60),
        isRecurring: true,
        priority: 'urgent',
      } as never);

      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(expect.arrayContaining([
        'Creditor name is required',
        'Budgeted amount must be a number',
        'Due day must be between 1 and 31',
        'Category must be 50 characters or less',
        'Priority must be one of: critical, high, normal, low',
      ]));
    });

    it('rejects invalid budget scheduleStartDate format', () => {
      const result = validateBudget({
        name: 'Household',
        scheduleStartDate: '2026/06/01',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('scheduleStartDate must be in YYYY-MM-DD format');
    });

    it('validates reconciliation fix payloads', () => {
      expect(validateReconciliationFix({
        id: 'fix-1',
        type: 'move_bill',
        billId: 'draft-12345678-abcd',
        billDueDate: '2026-03-15',
        fromPaycheckDate: '2026-03-01',
        toPaycheckDate: '2026-02-15',
      }).valid).toBe(true);

      expect(validateReconciliationFix({
        id: 'fix-bad-type',
        type: 'invalid' as 'move_bill',
        billId: 'draft-12345678-abcd',
        billDueDate: '2026-03-15',
        fromPaycheckDate: '2026-03-01',
      }).valid).toBe(false);

      expect(validateReconciliationFixes([{
        id: 'fix-bad',
        type: 'move_bill',
        billId: 'bad',
        billDueDate: '2026-03-15',
        fromPaycheckDate: '2026-03-01',
      }]).valid).toBe(false);
    });

    it('rejects malformed reconciliation fix and fixes lists', () => {
      const badMove = validateReconciliationFix({
        id: '',
        type: 'move_bill',
        billId: 'bad',
        billDueDate: '2026/03/15',
        fromPaycheckDate: 'bad-date',
      } as never);
      expect(badMove.valid).toBe(false);
      expect(badMove.errors.join(' ')).toContain('toPaycheckDate');

      const notArray = validateReconciliationFixes('oops' as never);
      expect(notArray.valid).toBe(false);
      expect(notArray.errors[0]).toContain('array');

      const tooMany = validateReconciliationFixes(
        Array.from({ length: 101 }, (_, i) => ({
          id: `fix-${i}`,
          type: 'move_bill' as const,
          billId: 'draft-12345678-abcd',
          billDueDate: '2026-03-15',
          fromPaycheckDate: '2026-03-01',
          toPaycheckDate: '2026-02-15',
        }))
      );
      expect(tooMany.valid).toBe(false);
      expect(tooMany.errors.join(' ')).toContain('Too many fixes');
    });
  });

  describe('hostile', () => {
    it('rejects prototype-polluting settings payload', () => {
      const payload = JSON.parse('{"constructor":{"prototype":{"polluted":true}}}');
      const result = validateSettings(payload as Record<string, unknown>);

      expect(result.valid).toBe(false);
      expect(result.errors.some((error) => error.includes('constructor'))).toBe(true);
    });

    it('rejects bill amount over maximum and non-integer due day', () => {
      expect(validateBill({
        creditorName: 'Big Bill',
        budgetedAmount: 1_000_001,
        dueDay: 15,
        isRecurring: true,
        priority: 'normal',
      }).valid).toBe(false);

      expect(validateBill({
        creditorName: 'Rent',
        budgetedAmount: 100,
        dueDay: 1.5 as never,
        isRecurring: true,
        priority: 'normal',
      }).valid).toBe(false);
    });

    it('rejects income with oversized name and NaN amount', () => {
      expect(validateIncome({
        sourceName: 'x'.repeat(101),
        amount: 100,
        cadence: 'weekly',
        startDate: '2026-01-01',
        isActive: true,
      }).valid).toBe(false);

      expect(validateIncome({
        sourceName: 'Salary',
        amount: Number.NaN,
        cadence: 'weekly',
        startDate: '2026-01-01',
        isActive: true,
      }).valid).toBe(false);
    });

    it('rejects invalid reconciliation fix type and oversized budget name', () => {
      expect(validateReconciliationFix({
        id: 'fix-bad-type',
        type: 'unknown' as never,
        billId: 'draft-12345678-abcd',
        billDueDate: '2026-01-01',
        fromPaycheckDate: '2026-01-01',
      }).valid).toBe(false);

      expect(validateBudget({ name: 'x'.repeat(101) }).valid).toBe(false);
    });

    it('rejects hostile income overflow and invalid date value', () => {
      const result = validateIncome({
        sourceName: 'Attack Income',
        amount: 10_000_001,
        cadence: 'weekly',
        startDate: '2026-13-99',
        isActive: true,
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Amount cannot exceed 10,000,000');
    });

    it('rejects hostile bill values and oversized creditor field', () => {
      const result = validateBill({
        creditorName: 'x'.repeat(101),
        budgetedAmount: 0,
        dueDay: 999,
        category: 'Utilities',
        isRecurring: true,
        priority: 'critical',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(expect.arrayContaining([
        'Creditor name must be 100 characters or less',
        'Budgeted amount must be greater than 0',
        'Due day must be between 1 and 31',
      ]));
    });

    it('validates goal, debt, and minimal budget payloads', () => {
      expect(validateGoal({
        name: 'Emergency Fund',
        targetAmount: 1000,
        targetDate: '2026-12-31',
      }).valid).toBe(true);

      expect(validateDebt({
        billId: 'draft-12345678-abcd',
        principalBalance: 5000,
        apr: 12.5,
        monthlyPayment: 150,
      }).valid).toBe(true);

      expect(validateBudget({ name: 'Personal' }).valid).toBe(true);
    });

    it('rejects assertValid failures for invalid bill payloads', () => {
      expect(() =>
        assertValid(
          validateBill({
            creditorName: 'Rent',
            budgetedAmount: 2_000_000,
            dueDay: 15,
            isRecurring: true,
            priority: 'normal',
          }),
          'Bill validation'
        )
      ).toThrow('Bill validation');
    });

    it('rejects invalid goal, debt, budget, settings, and draft overlay payloads', () => {
      const badGoal = validateGoal({
        name: 'x'.repeat(101),
        targetAmount: 0,
        targetDate: '12/31/2026',
        alreadySaved: -1,
        priority: 6,
      } as never);
      expect(badGoal.valid).toBe(false);

      const badDebt = validateDebt({
        billId: 'bad',
        principalBalance: -10,
        apr: 101,
        monthlyPayment: -2,
      });
      expect(badDebt.valid).toBe(false);

      const badBudget = validateBudget({
        name: '',
        startingBalance: -1,
        targetCashOnHand: Number.NaN,
        minCashOnHand: -1,
        minSavingsPerPaycheck: -1,
      } as never);
      expect(badBudget.valid).toBe(false);

      const badSettings = validateSettings({
        theme: 'neon',
        autoLockMinutes: 2000,
        defaultScheduleMonths: 99,
        savingsAPY: -5,
        currency: 'TOO-LONG-CURRENCY',
      });
      expect(badSettings.valid).toBe(false);

      const badOverlay = validateDraftOverlay({
        skippedBills: [{ billId: 'bad', skipDate: '2026/01/01' }],
        billAssignments: [{ billId: 'bad', billDueDate: 'oops', paycheckDate: 'still-bad' }],
        incomeOverrides: [{ incomeId: 'bad', paycheckDate: 'nope', amount: -1 }],
        startingBalance: Number.NaN,
        targetCashOnHand: -1,
        minCashOnHand: -1,
        minSavingsPerPaycheck: -1,
      } as never);
      expect(badOverlay.valid).toBe(false);
    });
  });

  describe('validateSkippedBill', () => {
    it('accepts valid skip payload', () => {
      const result = validateSkippedBill({
        billId: 'bill-12345678',
        skipDate: '2026-03-15',
      });
      expect(result.valid).toBe(true);
    });

    it('rejects invalid billId and skipDate', () => {
      const result = validateSkippedBill({ billId: 'bad', skipDate: '2026/03/15' });
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('validateBillAssignment', () => {
    it('accepts valid assignment payload', () => {
      const result = validateBillAssignment({
        billId: 'bill-12345678',
        billDueDate: '2026-03-15',
        paycheckDate: '2026-03-01',
      });
      expect(result.valid).toBe(true);
    });

    it('rejects invalid dates and billId', () => {
      const result = validateBillAssignment({
        billId: 'x',
        billDueDate: 'bad',
        paycheckDate: 'also-bad',
      });
      expect(result.valid).toBe(false);
    });
  });
});
