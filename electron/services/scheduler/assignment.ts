import { isAfter, isEqual, format, differenceInDays } from 'date-fns';
import { Bill, SavingsGoal } from '../database.service';
import {
  DEFAULT_TARGET_CASH_ON_HAND,
  DEFAULT_MIN_CASH_ON_HAND,
  MAX_PREPAY_DAYS,
  PaycheckEntry,
  PaycheckAssignment,
  ProjectedIncome,
  ProjectedBill,
  billOccurrenceKey,
} from './types';
import type { CashOnHandByDate } from './cashOnHandOverrides';
import { assignBillsExact } from './exactAssignment';
import { buildPaycheckEntries } from './paychecks';

export function getUniquePaycheckDates(incomes: ProjectedIncome[]): Date[] {
  const dateSet = new Set<number>();
  const dates: Date[] = [];

  for (const income of incomes) {
    const timestamp = income.date.getTime();
    if (!dateSet.has(timestamp)) {
      dateSet.add(timestamp);
      dates.push(income.date);
    }
  }

  return dates.sort((a, b) => a.getTime() - b.getTime());
}

/** Drop locks aimed at paycheck dates that are not in the current schedule. */
export function pruneManualAssignmentsToPaychecks(
  manualAssignments: Map<string, string>,
  paycheckDates: Date[]
): Map<string, string> {
  const validDates = new Set(paycheckDates.map((d) => format(d, 'yyyy-MM-dd')));
  const pruned = new Map<string, string>();
  for (const [key, target] of manualAssignments) {
    if (validDates.has(target)) {
      pruned.set(key, target);
    }
  }
  return pruned;
}

export function findPreferredPaycheck(
  bill: ProjectedBill,
  paycheckAssignments: PaycheckAssignment[],
  skippedBills: Set<string>
): string | null {
  if (!bill.preferredIncomeSourceId) return null;

  const matchingPaychecks = paycheckAssignments.filter((p) =>
    p.incomes.some((inc) => inc.sourceId === bill.preferredIncomeSourceId)
  );

  if (matchingPaychecks.length === 0) return null;

  let bestPaycheck: PaycheckAssignment | null = null;
  let bestDistance = Infinity;

  for (const paycheck of matchingPaychecks) {
    const paycheckDateStr = format(paycheck.date, 'yyyy-MM-dd');
    const skipKey = `${bill.billId}-${paycheckDateStr}`;
    if (skippedBills.has(skipKey)) continue;
    if (isAfter(paycheck.date, bill.date)) continue;

    const daysEarly = differenceInDays(bill.date, paycheck.date);
    if (daysEarly > MAX_PREPAY_DAYS) continue;

    if (daysEarly < bestDistance) {
      bestDistance = daysEarly;
      bestPaycheck = paycheck;
    }
  }

  return bestPaycheck ? format(bestPaycheck.date, 'yyyy-MM-dd') : null;
}

export function dedupeAssignmentBills(assignments: PaycheckAssignment[]): void {
  for (const assignment of assignments) {
    const seen = new Set<string>();
    assignment.bills = assignment.bills.filter((bill) => {
      const key = billOccurrenceKey(bill.billId, bill.date);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}

export function attachSkippedBillsForDisplay(
  assignments: PaycheckAssignment[],
  skippedBills: ProjectedBill[]
): void {
  for (const bill of skippedBills) {
    let landing = -1;
    for (let i = assignments.length - 1; i >= 0; i--) {
      if (!isAfter(assignments[i].date, bill.date)) {
        landing = i;
        break;
      }
    }
    if (landing === -1 && assignments.length > 0) {
      landing = 0;
    }
    if (landing === -1) continue;

    assignments[landing].bills.push({
      ...bill,
      isSkipped: true,
      isUnpayable: false,
      unfundableReason: undefined,
    });
  }
}

export function assignBillsToPaychecks(
  paycheckDates: Date[],
  allIncomes: ProjectedIncome[],
  allBills: ProjectedBill[],
  startingBalance: number,
  skippedBills: Set<string> = new Set(),
  manualAssignments: Map<string, string> = new Map(),
  incomeAttachedBillsRaw: Bill[] = [],
  maxBudgetRemaining: number = DEFAULT_TARGET_CASH_ON_HAND,
  goals: SavingsGoal[] = [],
  minCashOnHand: number = DEFAULT_MIN_CASH_ON_HAND,
  minSavingsPerPaycheck: number = 0,
  skippedForDisplay: ProjectedBill[] = [],
  cashOnHandByDate?: CashOnHandByDate
): PaycheckEntry[] {
  const assignments = assignBillsExact(
    paycheckDates,
    allIncomes,
    allBills,
    startingBalance,
    {
      skippedBills,
      manualAssignments,
      incomeAttachedBillsRaw,
      targetCashOnHand: maxBudgetRemaining,
      minCashOnHand,
      cashOnHandByDate,
    }
  );

  attachSkippedBillsForDisplay(assignments, skippedForDisplay);
  dedupeAssignmentBills(assignments);

  return buildPaycheckEntries(
    assignments,
    startingBalance,
    maxBudgetRemaining,
    goals,
    minCashOnHand,
    minSavingsPerPaycheck,
    cashOnHandByDate
  );
}
