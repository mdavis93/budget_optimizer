import { parseISO, isAfter, differenceInDays } from 'date-fns';

export const MAX_PREPAY_DAYS = 14;

export type AssignmentViolation = 'late' | 'too_early';

export function getAssignmentViolation(
  billDueDate: string,
  paycheckDate: string
): AssignmentViolation | null {
  const due = parseISO(billDueDate);
  const paycheck = parseISO(paycheckDate);

  if (isAfter(paycheck, due)) {
    return 'late';
  }

  const daysEarly = differenceInDays(due, paycheck);
  if (daysEarly > MAX_PREPAY_DAYS) {
    return 'too_early';
  }

  return null;
}

export function needsAssignmentConfirmation(
  billDueDate: string,
  paycheckDate: string
): boolean {
  return getAssignmentViolation(billDueDate, paycheckDate) !== null;
}
