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

/** Baseline payment months after the accelerated payoff are avoided. */
export function isPaymentAvoidedByAcceleration(
  paymentDateIso: string,
  acceleratedPayoffDate: string | null | undefined
): boolean {
  if (!acceleratedPayoffDate) return false;
  return paymentDateIso > acceleratedPayoffDate;
}

export interface AcceleratedFooterFigures {
  totalPayments: number;
  amountOverPrincipal: number;
  /** Months on or before the accelerated payoff in the baseline schedule; null if unknown. */
  monthsToPayoff: number | null;
}

export function acceleratedFooterFigures(params: {
  principalBalance: number;
  acceleratedInterest: number;
  acceleratedPayoffDate: string | null | undefined;
  baselinePayments: readonly AmortizationPayment[];
}): AcceleratedFooterFigures {
  const { principalBalance, acceleratedInterest, acceleratedPayoffDate, baselinePayments } =
    params;
  const amountOverPrincipal = acceleratedInterest;
  const totalPayments = principalBalance + acceleratedInterest;

  if (!acceleratedPayoffDate || baselinePayments.length === 0) {
    return {
      totalPayments,
      amountOverPrincipal,
      monthsToPayoff: null,
    };
  }

  const monthsToPayoff = baselinePayments.filter(
    (payment) => payment.date <= acceleratedPayoffDate
  ).length;

  return {
    totalPayments,
    amountOverPrincipal,
    monthsToPayoff,
  };
}
