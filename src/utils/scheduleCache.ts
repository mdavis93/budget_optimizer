import { ScheduleData } from '../types';
import { DraftOverlay } from '../types/draft';

export const SCHEDULE_DEBOUNCE_MS = 400;

export function buildScheduleCacheKey(
  overlay: DraftOverlay | undefined,
  startDate: string,
  months: number,
  startingBalance: number
): string {
  return JSON.stringify({ overlay: overlay ?? null, startDate, months, startingBalance });
}

export interface ScheduleCacheEntry {
  hash: string;
  data: ScheduleData;
}
