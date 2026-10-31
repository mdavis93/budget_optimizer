import { dayNumberOfIsoDate, eligiblePaycheckIndices } from '@shared/billEligibility';
import { MAX_PREPAY_DAYS } from '@shared/constants';

export { MAX_PREPAY_DAYS };

export type AssignmentViolation = 'late' | 'too_early';

/**
 * A manual drop is auto-legal when `paycheckDate` is in the shared eligibility
 * set for `paycheckDates` (20-day window, or the 31-day fallback). Otherwise it
 * is late or too early and needs confirmation.
 */
export function getAssignmentViolation(
  billDueDate: string,
  paycheckDate: string,
  paycheckDates: readonly string[]
): AssignmentViolation | null {
  const dueDay = dayNumberOfIsoDate(billDueDate);
  const targetDay = dayNumberOfIsoDate(paycheckDate);
  const daysEarly = dueDay - targetDay;
  if (daysEarly < 0) return 'late';
  if (daysEarly <= MAX_PREPAY_DAYS) return null;

  const paycheckDays = paycheckDates.map(dayNumberOfIsoDate);
  const days = paycheckDays.includes(targetDay) ? paycheckDays : [...paycheckDays, targetDay];
  const eligibleDays = new Set(
    eligiblePaycheckIndices(dueDay, days).map((index) => days[index])
  );
  return eligibleDays.has(targetDay) ? null : 'too_early';
}

export function needsAssignmentConfirmation(
  billDueDate: string,
  paycheckDate: string,
  paycheckDates: readonly string[]
): boolean {
  return getAssignmentViolation(billDueDate, paycheckDate, paycheckDates) !== null;
}
