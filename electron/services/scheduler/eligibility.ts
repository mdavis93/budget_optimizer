import { format } from 'date-fns';
import { dayNumberOfDate, eligiblePaycheckIndices } from '@shared/billEligibility';
import { PaycheckAssignment, ProjectedBill, billOccurrenceKey } from './types';

export interface EligibleBill {
  bill: ProjectedBill;
  billKey: string;
  candidateIndices: number[];
}

/** Eligible paycheck indices for a bill; results are shared, so callers must not mutate them. */
export type EligibilityLookup = (bill: ProjectedBill) => readonly number[];

/** True when the paycheck may fund the bill, ignoring dates (skips, savings-only, preferred source). */
function isPaycheckUsable(
  bill: ProjectedBill,
  paycheck: PaycheckAssignment,
  paycheckDateStr: string,
  skippedBills: Set<string>
): boolean {
  if (skippedBills.has(`${bill.billId}-${paycheckDateStr}`)) return false;
  if (paycheck.purpose === 'savingsAndGoals') return false;
  if (!bill.preferredIncomeSourceId) return true;
  return paycheck.incomes.some(
    (inc) => inc.sourceId === bill.preferredIncomeSourceId && inc.purpose !== 'savingsAndGoals'
  );
}

/**
 * Memoized eligibility for one assignment run. Paycheck dates and skips are
 * fixed for the run, so each bill occurrence is evaluated once.
 */
export function createEligibilityLookup(
  assignments: PaycheckAssignment[],
  skippedBills: Set<string> = new Set()
): EligibilityLookup {
  const paycheckDays = assignments.map((paycheck) => dayNumberOfDate(paycheck.date));
  const paycheckDateStrs = assignments.map((paycheck) => format(paycheck.date, 'yyyy-MM-dd'));
  const cache = new Map<string, number[]>();

  return (bill) => {
    const dueDay = dayNumberOfDate(bill.date);
    const cacheKey = `${bill.billId}\u0000${dueDay}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const indices = eligiblePaycheckIndices(dueDay, paycheckDays, (index) =>
      isPaycheckUsable(bill, assignments[index], paycheckDateStrs[index], skippedBills)
    );
    cache.set(cacheKey, indices);
    return indices;
  };
}

/** Paychecks on which a bill may be paid; see `eligiblePaycheckIndices` for the rule. */
export function getEligiblePaycheckIndices(
  bill: ProjectedBill,
  assignments: PaycheckAssignment[],
  skippedBills: Set<string> = new Set()
): number[] {
  return [...createEligibilityLookup(assignments, skippedBills)(bill)];
}

export function buildEligibleBills(
  bills: ProjectedBill[],
  assignments: PaycheckAssignment[],
  skippedBills: Set<string> = new Set(),
  excludeKeys: Set<string> = new Set()
): EligibleBill[] {
  const eligibility = createEligibilityLookup(assignments, skippedBills);
  const eligible: EligibleBill[] = [];

  for (const bill of bills) {
    const billKey = billOccurrenceKey(bill.billId, bill.date);
    if (excludeKeys.has(billKey)) continue;

    const candidateIndices = eligibility(bill);
    if (candidateIndices.length === 0) continue;

    eligible.push({ bill, billKey, candidateIndices: [...candidateIndices] });
  }

  // Stable order for determinism
  eligible.sort((a, b) => a.billKey.localeCompare(b.billKey));
  return eligible;
}

/** Latest eligible paycheck index (closest to due date, still on time). */
export function latestEligibleIndex(candidateIndices: number[]): number {
  return candidateIndices[candidateIndices.length - 1];
}
