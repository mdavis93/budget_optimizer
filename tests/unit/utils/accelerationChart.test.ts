import { describe, expect, it } from 'vitest';
import type { AmortizationPayment, DebtPlanDebt } from '../../../src/types';
import {
  acceleratedFooterFigures,
  buildPayoffChartPortions,
  interestSavedTextClass,
  isAccelerationPositive,
  isPaymentAvoidedByAcceleration,
} from '../../../src/components/debts/accelerationChart';

function planDebt(partial: Partial<DebtPlanDebt> = {}): DebtPlanDebt {
  return {
    debtId: 'debt-1',
    billId: 'bill-1',
    creditorName: 'CC: Amazon',
    baselinePayoffDate: '2031-05-15',
    acceleratedPayoffDate: '2029-03-15',
    baselineInterest: 3897.39,
    acceleratedInterest: 2546.07,
    ...partial,
  };
}

function payment(date: string, paymentNumber = 1): AmortizationPayment {
  return {
    paymentNumber,
    date,
    payment: 165,
    principal: 50,
    interest: 115,
    remainingBalance: 5000,
  };
}

describe('accelerationChart', () => {
  describe('isAccelerationPositive', () => {
    it('is true when accelerated payoff is before baseline', () => {
      expect(isAccelerationPositive(planDebt())).toBe(true);
    });

    it('is true when baseline never pays off but acceleration does', () => {
      expect(
        isAccelerationPositive(
          planDebt({ baselinePayoffDate: null, acceleratedPayoffDate: '2029-03-15' })
        )
      ).toBe(true);
    });

    it('is false when dates are equal', () => {
      expect(
        isAccelerationPositive(
          planDebt({
            baselinePayoffDate: '2029-03-15',
            acceleratedPayoffDate: '2029-03-15',
          })
        )
      ).toBe(false);
    });

    it('is false when accelerated date is missing or plan is absent', () => {
      expect(isAccelerationPositive(undefined)).toBe(false);
      expect(isAccelerationPositive(planDebt({ acceleratedPayoffDate: null }))).toBe(false);
    });
  });

  describe('isPaymentAvoidedByAcceleration', () => {
    it('marks payments after the accelerated payoff as avoided', () => {
      expect(isPaymentAvoidedByAcceleration('2029-04-15', '2029-03-15')).toBe(true);
      expect(isPaymentAvoidedByAcceleration('2031-05-15', '2029-03-15')).toBe(true);
      expect(isPaymentAvoidedByAcceleration('2029-04-01', '2029-03-31')).toBe(true);
    });

    it('keeps the accelerated payoff month solid', () => {
      expect(isPaymentAvoidedByAcceleration('2029-03-15', '2029-03-15')).toBe(false);
      expect(isPaymentAvoidedByAcceleration('2029-02-15', '2029-03-15')).toBe(false);
      // Due date later in the payoff month is still that month's payment.
      expect(isPaymentAvoidedByAcceleration('2029-03-28', '2029-03-02')).toBe(false);
    });

    it('is false when accelerated payoff is missing', () => {
      expect(isPaymentAvoidedByAcceleration('2029-04-15', null)).toBe(false);
      expect(isPaymentAvoidedByAcceleration('2029-04-15', undefined)).toBe(false);
    });
  });

  describe('acceleratedFooterFigures', () => {
    const baselinePayments = [
      payment('2029-01-15', 1),
      payment('2029-02-15', 2),
      payment('2029-03-15', 3),
      payment('2029-04-15', 4),
      payment('2029-05-15', 5),
    ];

    it('derives accelerated total payments and interest saved', () => {
      expect(
        acceleratedFooterFigures({
          principalBalance: 5111.1,
          baselineInterest: 3897.39,
          acceleratedInterest: 2546.07,
          acceleratedPayoffDate: '2029-03-15',
          baselinePayments,
        })
      ).toEqual({
        totalPayments: 7657.17,
        interestSaved: 1351.32,
        monthsToPayoff: 3,
      });
    });

    it('counts the payoff month when the due date is later that month', () => {
      expect(
        acceleratedFooterFigures({
          principalBalance: 1000,
          baselineInterest: 200,
          acceleratedInterest: 150,
          acceleratedPayoffDate: '2029-03-02',
          baselinePayments,
        })
      ).toEqual({
        totalPayments: 1150,
        interestSaved: 50,
        monthsToPayoff: 3,
      });
    });

    it('returns null months when the payment list is empty', () => {
      expect(
        acceleratedFooterFigures({
          principalBalance: 1000,
          baselineInterest: 150,
          acceleratedInterest: 100,
          acceleratedPayoffDate: '2029-03-15',
          baselinePayments: [],
        })
      ).toEqual({
        totalPayments: 1100,
        interestSaved: 50,
        monthsToPayoff: null,
      });
    });

    it('returns null months when accelerated payoff date is missing', () => {
      expect(
        acceleratedFooterFigures({
          principalBalance: 1000,
          baselineInterest: 100,
          acceleratedInterest: 100,
          acceleratedPayoffDate: null,
          baselinePayments,
        })
      ).toEqual({
        totalPayments: 1100,
        interestSaved: 0,
        monthsToPayoff: null,
      });
    });
  });

  describe('interestSavedTextClass', () => {
    it('uses contrasting green for a positive savings amount', () => {
      expect(interestSavedTextClass(13.35)).toBe('text-success-800 dark:text-success-400');
    });

    it('uses a neutral color when nothing is saved', () => {
      expect(interestSavedTextClass(0)).toBe('text-(--color-text-secondary)');
    });

    it('uses contrasting red when accelerated interest is higher', () => {
      expect(interestSavedTextClass(-1)).toBe('text-danger-700 dark:text-danger-300');
    });
  });

  describe('buildPayoffChartPortions', () => {
    it('keeps a same-month payoff visible and splits the unpaid slice', () => {
      const schedule = Array.from({ length: 15 }, (_, index) => {
        const monthIndex = 10 + index;
        const year = 2026 + Math.floor(monthIndex / 12);
        const month = (monthIndex % 12) + 1;
        return {
          paymentNumber: index + 1,
          date: `${year}-${String(month).padStart(2, '0')}-26`,
          payment: 30,
          principal: 20,
          interest: 10,
          remainingBalance: 0,
        };
      });
      schedule.push({
        paymentNumber: 16,
        date: '2028-02-26',
        payment: 28.58,
        principal: 27.88,
        interest: 0.7,
        remainingBalance: 0,
      });

      const portions = buildPayoffChartPortions({
        payments: schedule,
        acceleratedPayoffDate: '2028-02-10',
        principalBalance: 390.72,
        acceleratedInterest: 74.51,
      });

      expect(portions).toHaveLength(16);
      expect(portions.slice(0, 15).every((portion) => portion.avoided === false)).toBe(true);
      expect(portions[15]).toMatchObject({
        date: '2028-02-26',
        avoided: false,
        principal: 14.53,
        interest: 0.7,
        avoidedPrincipal: 13.35,
        avoidedInterest: 0,
      });
      expect(
        acceleratedFooterFigures({
          principalBalance: 390.72,
          baselineInterest: 87.86,
          acceleratedInterest: 74.51,
          acceleratedPayoffDate: '2028-02-10',
          baselinePayments: schedule,
        })
      ).toMatchObject({ monthsToPayoff: 16, interestSaved: 13.35 });
    });

    it('fades only months after an earlier payoff and keeps the payoff month solid', () => {
      const schedule = Array.from({ length: 8 }, (_, index) => {
        const monthIndex = 10 + index;
        const year = 2026 + Math.floor(monthIndex / 12);
        const month = (monthIndex % 12) + 1;
        return {
          paymentNumber: index + 1,
          date: `${year}-${String(month).padStart(2, '0')}-26`,
          payment: 40,
          principal: 30,
          interest: 10,
          remainingBalance: 0,
        };
      });
      schedule.push(
        {
          paymentNumber: 9,
          date: '2027-07-26',
          payment: 40,
          principal: 37.37,
          interest: 2.63,
          remainingBalance: 50.26,
        },
        {
          paymentNumber: 10,
          date: '2027-08-26',
          payment: 40,
          principal: 38.49,
          interest: 1.51,
          remainingBalance: 11.77,
        },
        {
          paymentNumber: 11,
          date: '2027-09-26',
          payment: 12.12,
          principal: 11.77,
          interest: 0.35,
          remainingBalance: 0,
        },
      );

      const portions = buildPayoffChartPortions({
        payments: schedule,
        acceleratedPayoffDate: '2027-07-03',
        principalBalance: 350,
        acceleratedInterest: 48.2,
      });

      expect(portions.slice(0, 8).every((portion) => portion.avoided === false)).toBe(true);
      expect(portions[8]).toMatchObject({
        date: '2027-07-26',
        avoided: false,
        principal: 37.37,
        interest: 2.63,
        avoidedPrincipal: 0,
        avoidedInterest: 0,
      });
      expect(portions[9].avoided).toBe(true);
      expect(portions[10]).toMatchObject({
        avoided: true,
        principal: 11.77,
        interest: 0.35,
        avoidedPrincipal: 0,
        avoidedInterest: 0,
      });
      expect(
        acceleratedFooterFigures({
          principalBalance: 350,
          baselineInterest: 62.12,
          acceleratedInterest: 48.2,
          acceleratedPayoffDate: '2027-07-03',
          baselinePayments: schedule,
        })
      ).toMatchObject({ monthsToPayoff: 9, interestSaved: 13.92 });
    });

    it('keeps the payoff month solid when earlier baseline payments already exceed the accelerated total', () => {
      const schedule = [payment('2026-11-26', 1), payment('2026-12-26', 2)];
      const portions = buildPayoffChartPortions({
        payments: schedule,
        acceleratedPayoffDate: '2026-12-02',
        principalBalance: 50,
        acceleratedInterest: 10,
      });

      expect(portions[1]).toMatchObject({
        avoided: false,
        principal: 50,
        interest: 115,
        avoidedPrincipal: 0,
        avoidedInterest: 0,
      });
    });

    it('does not mark any month avoided when there is no accelerated payoff', () => {
      const schedule = [payment('2026-11-26', 1), payment('2026-12-26', 2)];
      const portions = buildPayoffChartPortions({
        payments: schedule,
        acceleratedPayoffDate: null,
        principalBalance: 100,
        acceleratedInterest: 10,
      });
      expect(portions.every((portion) => portion.avoided === false && portion.avoidedPrincipal === 0)).toBe(
        true
      );
    });
  });
});
