import type { IncomePurpose, PaycheckEntry } from './types';

export const INCOME_PURPOSES: readonly IncomePurpose[] = ['operating', 'savingsAndGoals'];

export function isIncomePurpose(value: unknown): value is IncomePurpose {
  return value === 'operating' || value === 'savingsAndGoals';
}

/** Missing or empty purpose is operating (legacy encrypted blobs). */
export function isOperatingIncome(income: { purpose?: string } | null | undefined): boolean {
  if (!income || income.purpose == null || income.purpose === '') {
    return true;
  }
  return income.purpose === 'operating';
}

export function isSavingsAndGoalsIncome(income: { purpose?: string } | null | undefined): boolean {
  return income?.purpose === 'savingsAndGoals';
}

type PaycheckSpendFields = {
  purpose?: string;
  totalIncome: number;
  totalGoalDeposits?: number;
  savingsDeposit?: number;
  budgetRemaining: number;
};

/** Leftover of this paycheck's own deposit after goals and savings (not operating cash). */
export function paycheckUnallocatedDeposit(paycheck: PaycheckSpendFields): number {
  return Math.round(
    (paycheck.totalIncome - (paycheck.totalGoalDeposits ?? 0) - (paycheck.savingsDeposit ?? 0)) * 100
  ) / 100;
}

/**
 * Remaining that belongs on this paycheck's spend ledger.
 * Reserved deposits use unallocated deposit; operating paychecks keep cash-on-hand.
 */
export function paycheckSpendRemaining(paycheck: PaycheckSpendFields): number {
  if (isSavingsAndGoalsIncome(paycheck)) {
    return paycheckUnallocatedDeposit(paycheck);
  }
  return paycheck.budgetRemaining;
}

export function isOperatingPaycheck(entry: { purpose?: string } | null | undefined): boolean {
  return isOperatingIncome(entry);
}

export function paycheckEntryId(purpose: IncomePurpose, dateStr: string): string {
  return `${purpose === 'savingsAndGoals' ? 'sg' : 'op'}:${dateStr}`;
}

export function paycheckKey(entry: Pick<PaycheckEntry, 'date'> & Partial<Pick<PaycheckEntry, 'id' | 'purpose'>>): string {
  if (entry.id) return entry.id;
  const purpose: IncomePurpose = entry.purpose === 'savingsAndGoals' ? 'savingsAndGoals' : 'operating';
  return paycheckEntryId(purpose, entry.date);
}

export function stripBillLinkToIncome<T extends { preferredIncomeSourceId?: string; isIncomeAttached?: boolean }>(
  bill: T,
  incomeId: string
): T {
  if (bill.preferredIncomeSourceId !== incomeId) return bill;
  return { ...bill, preferredIncomeSourceId: undefined, isIncomeAttached: false };
}
