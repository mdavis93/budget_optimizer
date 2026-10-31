import { addDays, isAfter, startOfDay } from 'date-fns';
import {
  MAX_FALLBACK_PREPAY_DAYS,
  dayNumberOfDate,
  eligiblePaycheckIndices,
} from '@shared/billEligibility';
import type { PaycheckAssignment, ProjectedBill, ProjectedIncome } from './types';

/**
 * Bills due before the first operating paycheck they may use are presumed paid
 * by pre-schedule paychecks and leave the solve. A preferred source with no
 * operating income falls back to any paycheck, so its bills stay unpayable as before.
 */
export function partitionPresumedPaidBills(
  bills: ProjectedBill[],
  operatingIncomes: ProjectedIncome[],
  startDate?: Date
): { payableBills: ProjectedBill[]; presumedPaidBills: ProjectedBill[] } {
  const startDay = startDate ? dayNumberOfDate(startDate) : -Infinity;
  let firstPaycheckDay = Infinity;
  const firstPaycheckDayBySource = new Map<string, number>();
  for (const income of operatingIncomes) {
    const day = dayNumberOfDate(income.date);
    firstPaycheckDay = Math.min(firstPaycheckDay, day);
    const sourceFirstDay = firstPaycheckDayBySource.get(income.sourceId);
    if (sourceFirstDay === undefined || day < sourceFirstDay) {
      firstPaycheckDayBySource.set(income.sourceId, day);
    }
  }

  const payableBills: ProjectedBill[] = [];
  const presumedPaidBills: ProjectedBill[] = [];
  for (const bill of bills) {
    const dueDay = dayNumberOfDate(bill.date);
    if (dueDay < startDay) {
      presumedPaidBills.push(bill);
      continue;
    }
    const sourceFirstDay = bill.preferredIncomeSourceId
      ? firstPaycheckDayBySource.get(bill.preferredIncomeSourceId)
      : undefined;
    const firstUsableDay = sourceFirstDay ?? firstPaycheckDay;
    if (dueDay < firstUsableDay) presumedPaidBills.push(bill);
    else payableBills.push(bill);
  }
  return { payableBills, presumedPaidBills };
}

/**
 * Project just far enough past the funding end that a bill eligible for the
 * last funded paycheck (up to MAX_FALLBACK_PREPAY_DAYS early) is still projected.
 */
export function resolveSolveEndDate(fundingEndDate: Date): Date {
  return addDays(startOfDay(fundingEndDate), MAX_FALLBACK_PREPAY_DAYS);
}

/**
 * Bills that have no eligible paycheck on or before the funding end stay out
 * of the solver so they cannot join in-horizon clusters.
 */
export function billsEligibleOnFundingHorizon(
  bills: ProjectedBill[],
  paycheckDates: Date[],
  fundingEndDate: Date
): ProjectedBill[] {
  const fundingEndDay = dayNumberOfDate(fundingEndDate);
  const paycheckDays = paycheckDates.map(dayNumberOfDate);

  return bills.filter((bill) => {
    const dueDay = dayNumberOfDate(bill.date);
    if (dueDay <= fundingEndDay) return true;
    return eligiblePaycheckIndices(dueDay, paycheckDays).some(
      (index) => paycheckDays[index] <= fundingEndDay
    );
  });
}

/**
 * After assign/rebalance, drop paychecks past the funding horizon so surplus,
 * savings, and goals run on the funded months only. Bills the solver already
 * placed on an in-horizon paycheck stay. Bills that landed on lookahead
 * paychecks are discarded with those paychecks.
 */
export function dropLookaheadAssignments(
  assignments: PaycheckAssignment[],
  fundingEndDate: Date
): PaycheckAssignment[] {
  const fundingEnd = startOfDay(fundingEndDate);
  return assignments.filter((assignment) => !isAfter(startOfDay(assignment.date), fundingEnd));
}
