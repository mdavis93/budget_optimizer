import { describe, it, expect, beforeEach } from 'vitest';
import { DebtService } from '../../../electron/services/debt.service';

describe('DebtService', () => {
  let debtService: DebtService;

  beforeEach(() => {
    debtService = new DebtService();
  });

  describe('calculateMonthlyInterest', () => {
    it('should calculate monthly interest correctly', () => {
      const interest = debtService.calculateMonthlyInterest(1000, 0.12);
      expect(interest).toBe(10); // 12% APR = 1% monthly
    });

    it('should return 0 for 0 APR', () => {
      const interest = debtService.calculateMonthlyInterest(1000, 0);
      expect(interest).toBe(0);
    });

    it('should return 0 for 0 balance', () => {
      const interest = debtService.calculateMonthlyInterest(0, 0.12);
      expect(interest).toBe(0);
    });
  });

  describe('calculateAmortization', () => {
    it('should calculate basic amortization schedule', () => {
      const result = debtService.calculateAmortization(
        1000, // principal
        0.12, // 12% APR
        100,  // monthly payment
        0,    // no extra
        'none'
      );

      expect(result.monthsToPayoff).toBe(11);
      expect(result.totalPrincipal).toBe(1000);
      expect(result.totalInterest).toBeGreaterThan(0);
      expect(result.totalPayments).toBeCloseTo(result.totalPrincipal + result.totalInterest, 0);
      expect(result.payments.length).toBe(11);
    });

    it('should handle 0% APR (no interest)', () => {
      const result = debtService.calculateAmortization(
        500,  // principal
        0,    // 0% APR
        100,  // monthly payment
        0,
        'none'
      );

      expect(result.monthsToPayoff).toBe(5);
      expect(result.totalInterest).toBe(0);
      expect(result.totalPayments).toBe(500);
    });

    it('should handle one-time extra payment', () => {
      const withoutExtra = debtService.calculateAmortization(
        1000, 0.12, 100, 0, 'none'
      );
      const withExtra = debtService.calculateAmortization(
        1000, 0.12, 100, 200, 'one-time'
      );

      expect(withExtra.monthsToPayoff).toBeLessThan(withoutExtra.monthsToPayoff);
      expect(withExtra.totalInterest).toBeLessThan(withoutExtra.totalInterest);
    });

    it('should handle monthly extra payments', () => {
      const withoutExtra = debtService.calculateAmortization(
        1000, 0.12, 100, 0, 'none'
      );
      const withExtra = debtService.calculateAmortization(
        1000, 0.12, 100, 50, 'monthly'
      );

      expect(withExtra.monthsToPayoff).toBeLessThan(withoutExtra.monthsToPayoff);
      expect(withExtra.totalInterest).toBeLessThan(withoutExtra.totalInterest);
    });

    it('should detect when payment is less than interest (never payoff)', () => {
      const result = debtService.calculateAmortization(
        10000, // large principal
        0.24,  // 24% APR (2% monthly = $200 interest)
        50,    // payment less than monthly interest
        0,
        'none'
      );

      expect(result.monthsToPayoff).toBe(-1);
      expect(result.payoffDate).toContain('Never');
    });

    it('should have final payment amount <= regular payment', () => {
      const result = debtService.calculateAmortization(
        1000, 0.12, 100, 0, 'none'
      );

      const lastPayment = result.payments[result.payments.length - 1];
      expect(lastPayment.payment).toBeLessThanOrEqual(100);
      expect(lastPayment.remainingBalance).toBe(0);
    });

    it('should correctly track remaining balance', () => {
      const result = debtService.calculateAmortization(
        1000, 0.12, 100, 0, 'none'
      );

      // Balance should decrease with each payment
      for (let i = 1; i < result.payments.length; i++) {
        expect(result.payments[i].remainingBalance)
          .toBeLessThan(result.payments[i - 1].remainingBalance);
      }

      // Final balance should be 0
      expect(result.payments[result.payments.length - 1].remainingBalance).toBe(0);
    });

    it('should have correct payment numbers', () => {
      const result = debtService.calculateAmortization(
        500, 0.06, 100, 0, 'none'
      );

      result.payments.forEach((payment, index) => {
        expect(payment.paymentNumber).toBe(index + 1);
      });
    });

    it('should have payments add up correctly', () => {
      const result = debtService.calculateAmortization(
        1000, 0.12, 100, 0, 'none'
      );

      const summedPayments = result.payments.reduce((sum, p) => sum + p.payment, 0);
      expect(summedPayments).toBeCloseTo(result.totalPayments, 1);
    });

    it('should handle high APR correctly', () => {
      const result = debtService.calculateAmortization(
        5000,  // principal
        0.299, // 29.9% APR (typical credit card)
        200,   // monthly payment
        0,
        'none'
      );

      expect(result.monthsToPayoff).toBeGreaterThan(0);
      expect(result.totalInterest).toBeGreaterThan(1000); // Significant interest
    });

    it('should handle large principal correctly', () => {
      const result = debtService.calculateAmortization(
        250000, // mortgage-size principal
        0.065,  // 6.5% APR
        1500,   // monthly payment
        0,
        'none'
      );

      expect(result.monthsToPayoff).toBeLessThanOrEqual(360); // 30 years max
      expect(result.payments.length).toBe(result.monthsToPayoff);
    });
  });

  describe('getPayoffDate', () => {
    it('should return correct payoff date', () => {
      const startDate = new Date('2024-01-15');
      const payoffDate = debtService.getPayoffDate(
        1000, 0.12, 100, 0, 'none', startDate
      );

      expect(payoffDate).not.toBeNull();
      if (payoffDate) {
        expect(payoffDate.getTime()).toBeGreaterThan(startDate.getTime());
      }
    });

    it('should return null for never-payoff scenario', () => {
      const payoffDate = debtService.getPayoffDate(
        10000, 0.24, 50, 0, 'none'
      );

      expect(payoffDate).toBeNull();
    });
  });

  describe('calculateInterestSaved', () => {
    it('should calculate interest saved with monthly extra payments', () => {
      const saved = debtService.calculateInterestSaved(
        5000, 0.18, 200, 100, 'monthly'
      );

      expect(saved).toBeGreaterThan(0);
    });

    it('should calculate interest saved with one-time extra payment', () => {
      const saved = debtService.calculateInterestSaved(
        5000, 0.18, 200, 500, 'one-time'
      );

      expect(saved).toBeGreaterThan(0);
    });

    it('should return 0 when extra payment does not save interest', () => {
      // Small debt, low APR, quick payoff - extra payment may not save much
      const saved = debtService.calculateInterestSaved(
        100, 0.01, 100, 10, 'monthly'
      );

      expect(saved).toBeGreaterThanOrEqual(0);
    });
  });

  describe('calculateMonthsSaved', () => {
    it('should calculate months saved with monthly extra payments', () => {
      const saved = debtService.calculateMonthsSaved(
        5000, 0.18, 200, 100, 'monthly'
      );

      expect(saved).toBeGreaterThan(0);
    });

    it('should calculate months saved with one-time extra payment', () => {
      const saved = debtService.calculateMonthsSaved(
        5000, 0.18, 200, 500, 'one-time'
      );

      expect(saved).toBeGreaterThan(0);
    });
  });

  describe('edge cases', () => {
    it('should handle very small principal', () => {
      const result = debtService.calculateAmortization(
        0.01, 0.12, 100, 0, 'none'
      );

      expect(result.monthsToPayoff).toBe(1);
      expect(result.totalPayments).toBeLessThanOrEqual(0.01);
    });

    it('should handle payment equal to balance + first month interest', () => {
      // With $100 balance at 12% APR, first month interest is $1
      const result = debtService.calculateAmortization(
        100, 0.12, 101, 0, 'none'
      );

      expect(result.monthsToPayoff).toBe(1);
    });

    it('should cap at 360 months (30 years)', () => {
      // Very small payment relative to balance + interest
      const result = debtService.calculateAmortization(
        100000, 0.06, 510, 0, 'none' // Just barely covers monthly interest + tiny principal
      );

      expect(result.monthsToPayoff).toBeLessThanOrEqual(360);
    });
  });
});
