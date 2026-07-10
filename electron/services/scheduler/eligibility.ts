import { differenceInDays, format, isAfter } from 'date-fns';
import { MAX_PREPAY_DAYS, PaycheckAssignment, ProjectedBill, billOccurrenceKey } from './types';

export interface EligibleBill {
  bill: ProjectedBill;
  billKey: string;
  candidateIndices: number[];
}

/**
 * Paychecks on which a bill may be paid: dated in [due - MAX_PREPAY_DAYS, due].
 */
export function getEligiblePaycheckIndices(
  bill: ProjectedBill,
  assignments: PaycheckAssignment[],
  skippedBills: Set<string> = new Set()
): number[] {
  const candidates: number[] = [];

  for (let i = 0; i < assignments.length; i++) {
    const paycheck = assignments[i];
    const paycheckDateStr = format(paycheck.date, 'yyyy-MM-dd');

    const skipKey = `${bill.billId}-${paycheckDateStr}`;
    if (skippedBills.has(skipKey)) continue;

    if (isAfter(paycheck.date, bill.date)) continue;

    const daysEarly = differenceInDays(bill.date, paycheck.date);
    if (daysEarly > MAX_PREPAY_DAYS) continue;

    if (bill.preferredIncomeSourceId) {
      const hasIncome = paycheck.incomes.some(
        (inc) => inc.sourceId === bill.preferredIncomeSourceId
      );
      if (!hasIncome) continue;
    }

    candidates.push(i);
  }

  return candidates;
}

export function buildEligibleBills(
  bills: ProjectedBill[],
  assignments: PaycheckAssignment[],
  skippedBills: Set<string> = new Set(),
  excludeKeys: Set<string> = new Set()
): EligibleBill[] {
  const eligible: EligibleBill[] = [];

  for (const bill of bills) {
    const billKey = billOccurrenceKey(bill.billId, bill.date);
    if (excludeKeys.has(billKey)) continue;

    const candidateIndices = getEligiblePaycheckIndices(bill, assignments, skippedBills);
    if (candidateIndices.length === 0) continue;

    eligible.push({ bill, billKey, candidateIndices });
  }

  // Stable order for determinism
  eligible.sort((a, b) => a.billKey.localeCompare(b.billKey));
  return eligible;
}

/** Latest eligible paycheck index (closest to due date, still on time). */
export function latestEligibleIndex(candidateIndices: number[]): number {
  return candidateIndices[candidateIndices.length - 1];
}
