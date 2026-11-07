import { describe, expect, it } from 'vitest';
import type { AmortizationPayment, DebtPlanDebt } from '../../../src/types';
import {
  acceleratedFooterFigures,
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
    });

    it('keeps the accelerated payoff month solid', () => {
      expect(isPaymentAvoidedByAcceleration('2029-03-15', '2029-03-15')).toBe(false);
      expect(isPaymentAvoidedByAcceleration('2029-02-15', '2029-03-15')).toBe(false);
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

    it('derives accelerated total payments and amount over principal', () => {
      expect(
        acceleratedFooterFigures({
          principalBalance: 5111.1,
          acceleratedInterest: 2546.07,
          acceleratedPayoffDate: '2029-03-15',
          baselinePayments,
        })
      ).toEqual({
        totalPayments: 5111.1 + 2546.07,
        amountOverPrincipal: 2546.07,
        monthsToPayoff: 3,
      });
    });

    it('returns null months when the payment list is empty', () => {
      expect(
        acceleratedFooterFigures({
          principalBalance: 1000,
          acceleratedInterest: 100,
          acceleratedPayoffDate: '2029-03-15',
          baselinePayments: [],
        })
      ).toEqual({
        totalPayments: 1100,
        amountOverPrincipal: 100,
        monthsToPayoff: null,
      });
    });

    it('returns null months when accelerated payoff date is missing', () => {
      expect(
        acceleratedFooterFigures({
          principalBalance: 1000,
          acceleratedInterest: 100,
          acceleratedPayoffDate: null,
          baselinePayments,
        })
      ).toEqual({
        totalPayments: 1100,
        amountOverPrincipal: 100,
        monthsToPayoff: null,
      });
    });
  });
});
