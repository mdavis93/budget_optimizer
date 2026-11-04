import { addMonths, differenceInCalendarMonths, isBefore } from 'date-fns';

/** Whole months from start to target, rounded up so addMonths(start, months) covers target. */
export function monthsCoveringDate(start: Date, target: Date): number {
  if (!isBefore(start, target)) return 0;
  let months = Math.max(0, differenceInCalendarMonths(target, start));
  while (isBefore(addMonths(start, months), target)) months++;
  return months;
}
