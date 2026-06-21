import { addMonths, differenceInCalendarMonths, format, isBefore, parseISO } from 'date-fns';

export interface ViewportOption {
  value: number; // viewport length in months
  label: string;
}

export interface GoalViewportSource {
  goalName: string;
  targetDate: string;
}

const FIXED_VIEWPORTS = [1, 3, 6, 12];

/** Whole months from start to target, rounded up so the window covers the deadline. */
function monthsUntil(startDate: string, targetDate: string): number {
  const start = parseISO(startDate);
  const target = parseISO(targetDate);
  if (!isBefore(start, target)) return 0;
  let months = Math.max(0, differenceInCalendarMonths(target, start));
  while (isBefore(addMonths(start, months), target)) months++;
  return months;
}

/**
 * Build the "View" dropdown options: the fixed 1/3/6/12 entries (capped at the
 * horizon) plus a "Through <goal> (<month>)" shortcut per goal. Goal options are
 * clamped to the calculation horizon, sorted by deadline, and deduped by the
 * resolved month count (a fixed entry or earlier goal of the same length wins).
 */
export function buildViewportOptions(
  calculationMonths: number,
  startDate: string,
  goals: ReadonlyArray<GoalViewportSource> = []
): ViewportOption[] {
  const horizon = Math.max(1, calculationMonths || FIXED_VIEWPORTS[FIXED_VIEWPORTS.length - 1]);
  const options: ViewportOption[] = [];
  const seen = new Set<number>();

  for (const months of FIXED_VIEWPORTS) {
    if (months <= horizon && !seen.has(months)) {
      seen.add(months);
      options.push({ value: months, label: `${months} Month${months > 1 ? 's' : ''}` });
    }
  }

  const goalOptions = goals
    .map((goal) => ({
      months: Math.min(horizon, monthsUntil(startDate, goal.targetDate)),
      goal,
    }))
    .filter((entry) => entry.months >= 1)
    .sort((a, b) => a.months - b.months);

  for (const { months, goal } of goalOptions) {
    if (seen.has(months)) continue; // dedupe by resolved month count
    seen.add(months);
    options.push({
      value: months,
      label: `Through "${goal.goalName}" (${format(parseISO(goal.targetDate), 'MMM yyyy')})`,
    });
  }

  return options.sort((a, b) => a.value - b.value);
}
