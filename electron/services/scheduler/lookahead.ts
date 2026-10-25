import { addDays, differenceInDays, isAfter, startOfDay } from 'date-fns';
import { MAX_PREPAY_DAYS } from '@shared/constants';
import type { PaycheckAssignment, ProjectedBill } from './types';

/**
 * Project just far enough past the funding end that a bill due within
 * MAX_PREPAY_DAYS can still land on the last funded paycheck.
 */
export function resolveSolveEndDate(fundingEndDate: Date): Date {
  return addDays(startOfDay(fundingEndDate), MAX_PREPAY_DAYS);
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
  const fundingEnd = startOfDay(fundingEndDate);
  const horizonPaychecks = paycheckDates
    .map((date) => startOfDay(date))
    .filter((date) => !isAfter(date, fundingEnd));

  return bills.filter((bill) => {
    const due = startOfDay(bill.date);
    if (!isAfter(due, fundingEnd)) {
      return true;
    }
    return horizonPaychecks.some((paycheckDate) => {
      if (isAfter(paycheckDate, due)) {
        return false;
      }
      return differenceInDays(due, paycheckDate) <= MAX_PREPAY_DAYS;
    });
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
