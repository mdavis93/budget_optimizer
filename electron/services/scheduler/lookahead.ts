import { isAfter, startOfDay } from 'date-fns';
import type { PaycheckAssignment } from './types';

/**
 * After the 14-month assign/rebalance pass, drop paychecks past the funding
 * horizon so surplus, savings, and goals run on the visible 12 months only.
 * Bills the solver already placed on an in-horizon paycheck (including early
 * January bills within the MAX_PREPAY_DAYS window) stay. Bills that landed on
 * lookahead paychecks are discarded with those paychecks.
 */
export function dropLookaheadAssignments(
  assignments: PaycheckAssignment[],
  fundingEndDate: Date
): PaycheckAssignment[] {
  const fundingEnd = startOfDay(fundingEndDate);
  return assignments.filter((assignment) => !isAfter(startOfDay(assignment.date), fundingEnd));
}
