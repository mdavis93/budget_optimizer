import { describe, expect, it } from 'vitest';
import {
  coerceScheduleViewportMonths,
  DEFAULT_SCHEDULE_VIEWPORT_MONTHS,
  isScheduleViewportMonths,
  SCHEDULE_VIEWPORT_MONTHS,
} from '@shared/scheduleViewportMonths';

describe('scheduleViewportMonths', () => {
  describe('happy', () => {
    it('accepts the persisted viewport allow-list', () => {
      expect(SCHEDULE_VIEWPORT_MONTHS).toEqual([3, 6, 12]);
      expect(DEFAULT_SCHEDULE_VIEWPORT_MONTHS).toBe(3);
      expect(isScheduleViewportMonths(3)).toBe(true);
      expect(isScheduleViewportMonths(6)).toBe(true);
      expect(isScheduleViewportMonths(12)).toBe(true);
      expect(coerceScheduleViewportMonths(6)).toBe(6);
    });
  });

  describe('sad', () => {
    it('rejects empty, fractional, and out-of-range values', () => {
      expect(isScheduleViewportMonths(undefined)).toBe(false);
      expect(isScheduleViewportMonths(null)).toBe(false);
      expect(isScheduleViewportMonths(3.5)).toBe(false);
      expect(isScheduleViewportMonths(0)).toBe(false);
      expect(coerceScheduleViewportMonths(undefined)).toBe(DEFAULT_SCHEDULE_VIEWPORT_MONTHS);
    });
  });

  describe('hostile', () => {
    it('refuses goal lengths and prototype-like values as persisted viewports', () => {
      expect(isScheduleViewportMonths(1)).toBe(false);
      expect(isScheduleViewportMonths(2)).toBe(false);
      expect(isScheduleViewportMonths(14)).toBe(false);
      expect(isScheduleViewportMonths(18)).toBe(false);
      expect(isScheduleViewportMonths(24)).toBe(false);
      expect(isScheduleViewportMonths('12')).toBe(false);
      expect(isScheduleViewportMonths({ __proto__: { polluted: true } })).toBe(false);
      expect(coerceScheduleViewportMonths(18)).toBe(DEFAULT_SCHEDULE_VIEWPORT_MONTHS);
      expect(coerceScheduleViewportMonths('__proto__')).toBe(DEFAULT_SCHEDULE_VIEWPORT_MONTHS);
    });
  });
});
