import { dayNumberOfIsoDate } from '@shared/billEligibility';
import { MAX_MONEY } from '@shared/limits';
import { CENTS_PER_DOLLAR, fromCents, toCents } from '../money';

/** Cap on simulated months. A payment that never covers interest hits this and is flagged. */
export const DEBT_SIMULATOR_MAX_MONTHS = 600;

/** Work units allowed across classify/simulate/loop (same order as GREEDY_MAX_WORK). */
export const DEBT_MAX_WORK = 2_000_000;

export class DebtWorkLimitError extends Error {
  readonly workCount: number;

  constructor(workCount: number) {
    super(`debt work cap ${DEBT_MAX_WORK} exceeded`);
    this.name = 'DebtWorkLimitError';
    this.workCount = workCount;
  }
}

export class DebtWorkCounter {
  count = 0;

  constructor(private readonly maxWork: number = DEBT_MAX_WORK) {}

  tick(units = 1): void {
    this.count += units;
    if (this.count > this.maxWork) {
      throw new DebtWorkLimitError(this.count);
    }
  }
}

export interface AmortizationPaymentCents {
  paymentNumber: number;
  dateIso: string;
  paymentCents: number;
  principalCents: number;
  interestCents: number;
  remainingBalanceCents: number;
}

export interface AmortizationResultCents {
  payments: AmortizationPaymentCents[];
  totalPrincipalCents: number;
  totalInterestCents: number;
  totalPaymentsCents: number;
  monthsToPayoff: number;
  payoffDate: string;
  paymentBelowInterest: boolean;
  capped: boolean;
}

export interface MonthlyAmortizationInput {
  principalCents: number;
  apr: number;
  monthlyPaymentCents: number;
  extraCents?: number;
  extraType?: 'none' | 'one-time' | 'monthly';
  startIso: string;
  dueDay?: number;
}

function daysInUtcMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function isoFromParts(year: number, monthIndex: number, day: number): string {
  const clamped = Math.min(Math.max(day, 1), daysInUtcMonth(year, monthIndex));
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(clamped).padStart(2, '0')}`;
}

function addUtcMonths(year: number, monthIndex: number, count: number): { year: number; monthIndex: number } {
  const absolute = year * 12 + monthIndex + count;
  return { year: Math.floor(absolute / 12), monthIndex: ((absolute % 12) + 12) % 12 };
}

export function monthlyInterestCents(principalCents: number, apr: number): number {
  if (!Number.isFinite(principalCents) || !Number.isFinite(apr) || principalCents <= 0 || apr <= 0) {
    return 0;
  }
  return Math.round(principalCents * (apr / 12));
}

function paymentDateIso(startIso: string, monthOffset: number, dueDay: number): string {
  const [year, month, startDay] = startIso.slice(0, 10).split('-').map(Number);
  const shifted = addUtcMonths(year, month - 1, monthOffset);
  const day = monthOffset === 0 ? startDay : dueDay;
  return isoFromParts(shifted.year, shifted.monthIndex, day);
}

/**
 * Monthly amortization from a start date. Interest accrues on the due date
 * of each month; the payment is applied the same day (card / DebtService path).
 */
export function simulateMonthlyAmortization(
  input: MonthlyAmortizationInput,
  work = new DebtWorkCounter()
): AmortizationResultCents {
  const principalStart = Number.isFinite(input.principalCents) ? Math.max(0, Math.round(input.principalCents)) : 0;
  const paymentBase = Number.isFinite(input.monthlyPaymentCents) ? Math.max(0, Math.round(input.monthlyPaymentCents)) : 0;
  const extra = Number.isFinite(input.extraCents) ? Math.max(0, Math.round(input.extraCents ?? 0)) : 0;
  const extraType = input.extraType ?? 'none';
  const dueDay = input.dueDay && input.dueDay >= 1 && input.dueDay <= 31 ? input.dueDay : 1;
  const startIso = input.startIso.slice(0, 10);

  let balance = principalStart;
  let totalInterest = 0;
  let totalPayments = 0;
  const payments: AmortizationPaymentCents[] = [];
  let oneTimeRemaining = extraType === 'one-time' ? extra : 0;
  let paymentBelowInterest = false;

  if (principalStart <= 0) {
    return {
      payments: [],
      totalPrincipalCents: 0,
      totalInterestCents: 0,
      totalPaymentsCents: 0,
      monthsToPayoff: 0,
      payoffDate: startIso,
      paymentBelowInterest: false,
      capped: false,
    };
  }

  for (let month = 0; month < DEBT_SIMULATOR_MAX_MONTHS; month++) {
    work.tick();
    const dateIso = paymentDateIso(startIso, month, dueDay);
    const interest = monthlyInterestCents(balance, input.apr);
    balance += interest;
    totalInterest += interest;

    let payment = paymentBase;
    if (extraType === 'monthly') payment += extra;
    if (oneTimeRemaining > 0) {
      payment += oneTimeRemaining;
      oneTimeRemaining = 0;
    }
    if (payment > balance) payment = balance;

    if (interest > 0 && payment <= interest && balance > payment) {
      paymentBelowInterest = true;
    }

    const principalPaid = Math.max(0, payment - interest);
    balance -= payment;
    if (balance < 0) balance = 0;
    totalPayments += payment;

    payments.push({
      paymentNumber: month + 1,
      dateIso,
      paymentCents: payment,
      principalCents: principalPaid,
      interestCents: interest,
      remainingBalanceCents: balance,
    });

    if (balance <= 0) {
      return {
        payments,
        totalPrincipalCents: principalStart,
        totalInterestCents: totalInterest,
        totalPaymentsCents: totalPayments,
        monthsToPayoff: month + 1,
        payoffDate: dateIso,
        paymentBelowInterest: false,
        capped: false,
      };
    }
  }

  return {
    payments,
    totalPrincipalCents: principalStart,
    totalInterestCents: totalInterest,
    totalPaymentsCents: totalPayments,
    monthsToPayoff: -1,
    payoffDate: 'Never',
    paymentBelowInterest,
    capped: true,
  };
}

export function amortizationResultToDollars(result: AmortizationResultCents): {
  payments: Array<{
    paymentNumber: number;
    date: string;
    payment: number;
    principal: number;
    interest: number;
    remainingBalance: number;
  }>;
  totalPrincipal: number;
  totalInterest: number;
  totalPayments: number;
  monthsToPayoff: number;
  payoffDate: string;
} {
  return {
    payments: result.payments.map((payment) => ({
      paymentNumber: payment.paymentNumber,
      date: payment.dateIso,
      payment: fromCents(payment.paymentCents),
      principal: fromCents(payment.principalCents),
      interest: fromCents(payment.interestCents),
      remainingBalance: fromCents(payment.remainingBalanceCents),
    })),
    totalPrincipal: fromCents(result.totalPrincipalCents),
    totalInterest: fromCents(result.totalInterestCents),
    totalPayments: fromCents(result.totalPaymentsCents),
    monthsToPayoff: result.monthsToPayoff,
    payoffDate:
      result.monthsToPayoff === -1
        ? result.paymentBelowInterest
          ? 'Never'
          : 'Never'
        : result.payoffDate,
  };
}

/** Event-driven account: interest on due dates, principal reduction on payment days. */
export class DebtAccount {
  principalCents: number;
  totalInterestCents = 0;
  payoffIso: string | null = null;
  private lastAccruedYearMonth: number | null = null;

  constructor(
    public readonly debtId: string,
    public readonly billId: string,
    public readonly creditorName: string,
    public readonly apr: number,
    public readonly dueDay: number,
    principalCents: number,
    private readonly startIso: string
  ) {
    this.principalCents = Math.max(0, Math.round(principalCents));
  }

  get paidOff(): boolean {
    return this.principalCents <= 0;
  }

  accrueThrough(dateIso: string, work?: DebtWorkCounter): void {
    if (this.paidOff) return;
    const [endYear, endMonth, endDay] = dateIso.slice(0, 10).split('-').map(Number);
    const [startYear, startMonth] = this.startIso.slice(0, 10).split('-').map(Number);
    let year = startYear;
    let monthIndex = startMonth - 1;
    const endKey = endYear * 12 + (endMonth - 1);

    while (year * 12 + monthIndex <= endKey) {
      work?.tick();
      const dueIso = isoFromParts(year, monthIndex, this.dueDay);
      const dueKey = year * 12 + monthIndex;
      const ym = dueKey;
      if (this.lastAccruedYearMonth !== null && ym <= this.lastAccruedYearMonth) {
        const next = addUtcMonths(year, monthIndex, 1);
        year = next.year;
        monthIndex = next.monthIndex;
        continue;
      }
      if (dayNumberOfIsoDate(dueIso) > dayNumberOfIsoDate(dateIso)) break;
      if (endKey === dueKey && endDay < Math.min(this.dueDay, daysInUtcMonth(year, monthIndex))) {
        break;
      }
      const interest = monthlyInterestCents(this.principalCents, this.apr);
      this.principalCents += interest;
      this.totalInterestCents += interest;
      this.lastAccruedYearMonth = ym;
      const next = addUtcMonths(year, monthIndex, 1);
      year = next.year;
      monthIndex = next.monthIndex;
    }
  }

  applyPayment(amountCents: number, dateIso: string): number {
    if (this.paidOff || amountCents <= 0) return 0;
    const applied = Math.min(this.principalCents, Math.round(amountCents));
    this.principalCents -= applied;
    if (this.principalCents <= 0) {
      this.principalCents = 0;
      this.payoffIso = dateIso;
    }
    return applied;
  }
}

export function dollarsToPrincipalCents(principal: number): number | null {
  if (!Number.isFinite(principal) || principal < 0 || principal > MAX_MONEY) {
    return null;
  }
  return toCents(principal);
}

export function extraMonthlyDollars(billAmount: number, monthlyPayment: number): number {
  return Math.max(0, billAmount - monthlyPayment);
}

export function extraPaymentCents(
  billAmount: number,
  monthlyPayment: number
): { extraCents: number; extraType: 'none' | 'monthly' } {
  const extra = extraMonthlyDollars(billAmount, monthlyPayment);
  return extra > 0
    ? { extraCents: toCents(extra), extraType: 'monthly' }
    : { extraCents: 0, extraType: 'none' };
}

export { CENTS_PER_DOLLAR, fromCents, toCents };
