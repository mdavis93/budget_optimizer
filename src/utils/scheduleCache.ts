import { ScheduleData } from '../types';
import { buildScheduleIdentity, type ScheduleIdentityInput } from '@shared/scheduleIdentity';

export const SCHEDULE_DEBOUNCE_MS = 400;

export function buildScheduleCacheKey(input: ScheduleIdentityInput): string {
  return buildScheduleIdentity(input);
}

export interface ScheduleCacheEntry {
  hash: string;
  data: ScheduleData;
}
