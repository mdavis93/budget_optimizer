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
