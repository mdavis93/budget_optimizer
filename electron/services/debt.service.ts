import { addMonths, format } from 'date-fns';

export interface AmortizationPayment {
  paymentNumber: number;
  date: string;
  payment: number;
  principal: number;
  interest: number;
  remainingBalance: number;
}

export interface AmortizationSchedule {
  payments: AmortizationPayment[];
  totalPayments: number;
  totalInterest: number;
  totalPrincipal: number;
  payoffDate: string;
  monthsToPayoff: number;
}

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
    return balance * (apr / 12);
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
    startDate: Date = new Date()
  ): AmortizationSchedule {
    // Check cache first
    const cacheKey = this.getCacheKey(principal, apr, monthlyPayment, extraAmount, extraType, startDate);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const payments: AmortizationPayment[] = [];
    let balance = principal;
    let totalInterest = 0;
    let month = 0;
    let oneTimeApplied = false;
    const maxMonths = 360; // 30 years maximum

    // Handle edge case: if monthly payment is less than first month's interest
    const firstMonthInterest = this.calculateMonthlyInterest(balance, apr);
    if (monthlyPayment <= firstMonthInterest && apr > 0) {
      // Payment doesn't cover interest - debt will never be paid off
      // Return a single payment showing this situation
      return {
        payments: [{
          paymentNumber: 1,
          date: format(addMonths(startDate, 1), 'yyyy-MM-dd'),
          payment: monthlyPayment,
          principal: 0,
          interest: firstMonthInterest,
          remainingBalance: balance + (firstMonthInterest - monthlyPayment),
        }],
        totalPayments: monthlyPayment,
        totalInterest: firstMonthInterest,
        totalPrincipal: 0,
        payoffDate: 'Never (payment less than interest)',
        monthsToPayoff: -1,
      };
    }

    while (balance > 0 && month < maxMonths) {
      month++;
      const paymentDate = addMonths(startDate, month);
      const interest = this.calculateMonthlyInterest(balance, apr);
      totalInterest += interest;
      
      // Calculate extra payment for this month
      let extra = 0;
      if (extraType === 'monthly') {
        extra = extraAmount;
      } else if (extraType === 'one-time' && !oneTimeApplied) {
        extra = extraAmount;
        oneTimeApplied = true;
      }
      
      // Total payment is regular + extra, but capped at remaining balance + interest
      const totalPayment = Math.min(balance + interest, monthlyPayment + extra);
      const principalPaid = Math.max(0, totalPayment - interest);
      balance = Math.max(0, balance - principalPaid);
      
      payments.push({
        paymentNumber: month,
        date: format(paymentDate, 'yyyy-MM-dd'),
        payment: Math.round(totalPayment * 100) / 100,
        principal: Math.round(principalPaid * 100) / 100,
        interest: Math.round(interest * 100) / 100,
        remainingBalance: Math.round(balance * 100) / 100,
      });
    }

    const lastPayment = payments[payments.length - 1];
    const totalPaid = payments.reduce((sum, p) => sum + p.payment, 0);

    const result: AmortizationSchedule = {
      payments,
      totalPayments: Math.round(totalPaid * 100) / 100,
      totalInterest: Math.round(totalInterest * 100) / 100,
      totalPrincipal: Math.round(principal * 100) / 100,
      payoffDate: lastPayment?.date || format(startDate, 'yyyy-MM-dd'),
      monthsToPayoff: month,
    };

    // Add to cache with LRU-like eviction
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
