import {
  dayNumberOfIsoDate,
  eligiblePaycheckIndices,
  isFundingPaycheckUsable,
} from '@shared/billEligibility';
import { MAX_PREPAY_DAYS } from '@shared/constants';

export { MAX_PREPAY_DAYS };

export type AssignmentViolation = 'late' | 'too_early';

export type AssignmentPaycheckInput =
  | string
  | {
      date: string;
      incomeSourceIds?: readonly string[];
    };

function normalizeAssignmentPaychecks(
  paycheckDates: readonly AssignmentPaycheckInput[]
): Array<{ date: string; incomeSourceIds?: readonly string[] }> {
  return paycheckDates.map((item) => (typeof item === 'string' ? { date: item } : item));
}

/**
 * A manual drop is auto-legal when `paycheckDate` is already in `paycheckDates`
 * and that date is in the shared eligibility set (20-day window, or the 31-day
 * fallback). The drop target is never injected into the list: a savings-only
 * date that is not in the operating list is not auto-legal.
 */
export function getAssignmentViolation(
  billDueDate: string,
  paycheckDate: string,
  paycheckDates: readonly AssignmentPaycheckInput[],
  preferredIncomeSourceId?: string
): AssignmentViolation | null {
  const dueDay = dayNumberOfIsoDate(billDueDate);
  const targetDay = dayNumberOfIsoDate(paycheckDate);
  const daysEarly = dueDay - targetDay;
  if (daysEarly < 0) return 'late';

  const paychecks = normalizeAssignmentPaychecks(paycheckDates);
  const paycheckDays = paychecks.map((paycheck) => dayNumberOfIsoDate(paycheck.date));
  const eligibleDays = new Set(
    eligiblePaycheckIndices(dueDay, paycheckDays, (index) =>
      isFundingPaycheckUsable(
        { incomeSourceIds: paychecks[index].incomeSourceIds },
        preferredIncomeSourceId
      )
    ).map((index) => paycheckDays[index])
  );
  return eligibleDays.has(targetDay) ? null : 'too_early';
}

export function needsAssignmentConfirmation(
  billDueDate: string,
  paycheckDate: string,
  paycheckDates: readonly AssignmentPaycheckInput[],
  preferredIncomeSourceId?: string
): boolean {
  return getAssignmentViolation(
    billDueDate,
    paycheckDate,
    paycheckDates,
    preferredIncomeSourceId
  ) !== null;
}
