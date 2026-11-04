import { addMonths, format } from 'date-fns';
import type { AmortizationSchedule } from '@shared/types';
import { fromCents, toCents } from './scheduler/money';
import {
  amortizationResultToDollars,
  monthlyInterestCents,
  simulateMonthlyAmortization,
} from './scheduler/debt/debtSimulator';

const MAX_CACHE_SIZE = 50;

export class DebtService {
  private cache = new Map<string, AmortizationSchedule>();

  private getCacheKey(
    principal: number,
    apr: number,
    monthlyPayment: number,
    extraAmount: number,
    extraType: 'none' | 'one-time' | 'monthly',
    startDate: Date
  ): string {
    return `${principal}-${apr}-${monthlyPayment}-${extraAmount}-${extraType}-${format(startDate, 'yyyy-MM-dd')}`;
  }

  clearCache(): void {
    this.cache.clear();
  }
  /**
   * Calculate monthly interest based on principal and APR
   */
  calculateMonthlyInterest(balance: number, apr: number): number {
    return fromCents(monthlyInterestCents(toCents(balance), apr));
  }

  /**
   * Calculate full amortization schedule for a debt
   * @param principal Current remaining principal balance
   * @param apr Annual Percentage Rate (e.g., 0.199 for 19.9%)
   * @param monthlyPayment Regular monthly payment amount
   * @param extraAmount Additional payment amount
   * @param extraType Type of extra payment: 'none', 'one-time', or 'monthly'
   * @param startDate Date to start calculations from (defaults to today)
   */
  calculateAmortization(
    principal: number,
    apr: number,
    monthlyPayment: number,
    extraAmount: number = 0,
    extraType: 'none' | 'one-time' | 'monthly' = 'none',
    startDate: Date = new Date(),
    dueDay?: number
  ): AmortizationSchedule {
    const cacheKey = this.getCacheKey(principal, apr, monthlyPayment, extraAmount, extraType, startDate);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const startIso = format(startDate, 'yyyy-MM-dd');
    const cents = simulateMonthlyAmortization({
      principalCents: toCents(principal),
      apr,
      monthlyPaymentCents: toCents(monthlyPayment),
      extraCents: toCents(extraAmount),
      extraType,
      startIso,
      dueDay: dueDay ?? startDate.getDate(),
    });
    const dollars = amortizationResultToDollars(cents);
    const result: AmortizationSchedule = {
      payments: dollars.payments,
      totalPayments: dollars.totalPayments,
      totalInterest: dollars.totalInterest,
      totalPrincipal: dollars.totalPrincipal,
      payoffDate: dollars.payoffDate,
      monthsToPayoff: dollars.monthsToPayoff,
    };

    if (this.cache.size >= MAX_CACHE_SIZE) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(cacheKey, result);

    return result;
  }

  /**
   * Get the payoff date for a debt
   * Returns null if debt can never be paid off
   */
  getPayoffDate(
    principal: number,
    apr: number,
    monthlyPayment: number,
    extraAmount: number = 0,
    extraType: 'none' | 'one-time' | 'monthly' = 'none',
    startDate: Date = new Date()
  ): Date | null {
    const schedule = this.calculateAmortization(
      principal,
      apr,
      monthlyPayment,
      extraAmount,
      extraType,
      startDate
    );

    if (schedule.monthsToPayoff === -1) {
      return null;
    }

    return addMonths(startDate, schedule.monthsToPayoff);
  }

  /**
   * Calculate total interest saved by making extra payments
   */
  calculateInterestSaved(
    principal: number,
    apr: number,
    monthlyPayment: number,
    extraAmount: number,
    extraType: 'one-time' | 'monthly'
  ): number {
    const withoutExtra = this.calculateAmortization(principal, apr, monthlyPayment);
    const withExtra = this.calculateAmortization(
      principal,
      apr,
      monthlyPayment,
      extraAmount,
      extraType
    );

    return Math.max(0, withoutExtra.totalInterest - withExtra.totalInterest);
  }

  /**
   * Calculate months saved by making extra payments
   */
  calculateMonthsSaved(
    principal: number,
    apr: number,
    monthlyPayment: number,
    extraAmount: number,
    extraType: 'one-time' | 'monthly'
  ): number {
    const withoutExtra = this.calculateAmortization(principal, apr, monthlyPayment);
    const withExtra = this.calculateAmortization(
      principal,
      apr,
      monthlyPayment,
      extraAmount,
      extraType
    );

    if (withoutExtra.monthsToPayoff === -1 || withExtra.monthsToPayoff === -1) {
      return 0;
    }

    return Math.max(0, withoutExtra.monthsToPayoff - withExtra.monthsToPayoff);
  }
}
