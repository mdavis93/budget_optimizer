export const SCHEDULE_VIEWPORT_MONTHS = [3, 6, 12] as const;

export type ScheduleViewportMonths = (typeof SCHEDULE_VIEWPORT_MONTHS)[number];

export const DEFAULT_SCHEDULE_VIEWPORT_MONTHS: ScheduleViewportMonths = 3;

export function isScheduleViewportMonths(value: unknown): value is ScheduleViewportMonths {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    (SCHEDULE_VIEWPORT_MONTHS as readonly number[]).includes(value)
  );
}

export function coerceScheduleViewportMonths(value: unknown): ScheduleViewportMonths {
  if (isScheduleViewportMonths(value)) {
    return value;
  }
  return DEFAULT_SCHEDULE_VIEWPORT_MONTHS;
}
