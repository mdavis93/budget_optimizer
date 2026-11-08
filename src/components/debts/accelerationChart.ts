import type { AmortizationPayment, DebtPlanDebt } from '../../types';

/** Opacity for baseline payment bars that acceleration removes. */
export const AVOIDED_BAR_OPACITY = 0.35;

/**
 * Acceleration positively shortens a debt when the accelerated payoff date is
 * strictly before the baseline date, or when baseline never pays off.
 */
export function isAccelerationPositive(planDebt: DebtPlanDebt | undefined): boolean {
  if (!planDebt?.acceleratedPayoffDate) return false;
  if (!planDebt.baselinePayoffDate) return true;
  return planDebt.acceleratedPayoffDate < planDebt.baselinePayoffDate;
}

/** `YYYY-MM`. Payoff shading uses the calendar month, not the due day. */
export function calendarMonthKey(isoDate: string): string {
  return isoDate.slice(0, 7);
}

/**
 * A baseline payment is removed only when its month is after the accelerated
 * payoff month. The payoff month still has a payment, even when that payment
 * is posted before the baseline due date in the same month.
 */
export function isPaymentAvoidedByAcceleration(
  paymentDateIso: string,
  acceleratedPayoffDate: string | null | undefined
): boolean {
  if (!acceleratedPayoffDate) return false;
  return calendarMonthKey(paymentDateIso) > calendarMonthKey(acceleratedPayoffDate);
}

export interface AcceleratedFooterFigures {
  totalPayments: number;
  /** Baseline interest minus accelerated interest. */
  interestSaved: number;
  /** Baseline payments in or before the accelerated payoff month; null if unknown. */
  monthsToPayoff: number | null;
}

function roundDollars(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? 0 : rounded;
}

export function acceleratedFooterFigures(params: {
  principalBalance: number;
  baselineInterest: number;
  acceleratedInterest: number;
  acceleratedPayoffDate: string | null | undefined;
  baselinePayments: readonly AmortizationPayment[];
}): AcceleratedFooterFigures {
  const {
    principalBalance,
    baselineInterest,
    acceleratedInterest,
    acceleratedPayoffDate,
    baselinePayments,
  } = params;
  const interestSaved = roundDollars(baselineInterest - acceleratedInterest);
  const totalPayments = roundDollars(principalBalance + acceleratedInterest);

  if (!acceleratedPayoffDate || baselinePayments.length === 0) {
    return {
      totalPayments,
      interestSaved,
      monthsToPayoff: null,
    };
  }

  const payoffMonth = calendarMonthKey(acceleratedPayoffDate);
  const monthsToPayoff = baselinePayments.filter(
    (payment) => calendarMonthKey(payment.date) <= payoffMonth
  ).length;

  return {
    totalPayments,
    interestSaved,
    monthsToPayoff,
  };
}

/**
 * Footer text color on `bg-tertiary`. Light mode needs a dark green and dark
 * mode a light green; either color alone fails contrast on one of the themes.
 * Zero savings stays neutral.
 */
export function interestSavedTextClass(interestSaved: number): string {
  if (interestSaved > 0) return 'text-success-800 dark:text-success-400';
  if (interestSaved < 0) return 'text-danger-700 dark:text-danger-300';
  return 'text-(--color-text-secondary)';
}

export interface PayoffChartPortion {
  date: string;
  /** Principal from this baseline payment that is still paid. */
  principal: number;
  /** Interest from this baseline payment that is still paid. */
  interest: number;
  /** Unpaid slice of this month's baseline principal. */
  avoidedPrincipal: number;
  /** Unpaid slice of this month's baseline interest. */
  avoidedInterest: number;
  /** Full baseline payment (paid + avoided). */
  payment: number;
  /** True when acceleration removes this month's payment entirely. */
  avoided: boolean;
}

function dollarsFromCents(cents: number): number {
  return cents / 100;
}

function fullPortion(payment: AmortizationPayment, avoided: boolean): PayoffChartPortion {
  return {
    date: payment.date,
    principal: payment.principal,
    interest: payment.interest,
    avoidedPrincipal: 0,
    avoidedInterest: 0,
    payment: payment.payment,
    avoided,
  };
}

/**
 * Split each baseline payment into the part acceleration still pays and the
 * part it removes.
 *
 * Months after the payoff month are removed. Earlier months keep the full
 * baseline bar. The payoff month stays visible: a smaller final payment is
 * still a payment. When principal plus accelerated interest does not cover
 * that month's baseline installment, the unpaid slice is separate so the chart
 * can draw it faded. Interest is covered before principal. A non-positive
 * remainder still draws the full payoff-month bar, because a payoff dated in
 * that month means a payment was made.
 */
export function buildPayoffChartPortions(params: {
  payments: readonly AmortizationPayment[];
  acceleratedPayoffDate?: string | null;
  principalBalance: number;
  acceleratedInterest: number;
}): PayoffChartPortion[] {
  const { payments, acceleratedPayoffDate, principalBalance, acceleratedInterest } = params;
  const payoffMonth = acceleratedPayoffDate ? calendarMonthKey(acceleratedPayoffDate) : null;
  const acceleratedTotalCents = Math.round((principalBalance + acceleratedInterest) * 100);
  let baselineBeforeCents = 0;

  return payments.map((payment) => {
    const principalCents = Math.round(payment.principal * 100);
    const interestCents = Math.round(payment.interest * 100);
    const paymentCents = principalCents + interestCents;
    const month = calendarMonthKey(payment.date);

    if (!payoffMonth || month < payoffMonth) {
      baselineBeforeCents += paymentCents;
      return fullPortion(payment, false);
    }

    if (month > payoffMonth) {
      return fullPortion(payment, true);
    }

    const remainderCents = acceleratedTotalCents - baselineBeforeCents;
    baselineBeforeCents += paymentCents;
    const paidCents = remainderCents <= 0 ? paymentCents : Math.min(paymentCents, remainderCents);
    if (paidCents >= paymentCents || paidCents <= 0) {
      return fullPortion(payment, false);
    }

    const interestPaid = Math.min(interestCents, paidCents);
    const principalPaid = Math.min(principalCents, paidCents - interestPaid);
    return {
      date: payment.date,
      principal: dollarsFromCents(principalPaid),
      interest: dollarsFromCents(interestPaid),
      avoidedPrincipal: dollarsFromCents(principalCents - principalPaid),
      avoidedInterest: dollarsFromCents(interestCents - interestPaid),
      payment: payment.payment,
      avoided: false,
    };
  });
}
