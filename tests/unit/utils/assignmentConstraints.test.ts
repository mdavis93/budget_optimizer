import { describe, it, expect } from 'vitest';
import { addDays, format, parseISO } from 'date-fns';
import {
  getAssignmentViolation,
  needsAssignmentConfirmation,
  MAX_PREPAY_DAYS,
} from '../../../src/utils/assignmentConstraints';
import { MAX_FALLBACK_PREPAY_DAYS } from '@shared/billEligibility';

const due = '2026-01-28';
const dueDate = parseISO(due);
const edgePaycheck = format(addDays(dueDate, -MAX_PREPAY_DAYS), 'yyyy-MM-dd');
const tooEarlyPaycheck = format(addDays(dueDate, -(MAX_PREPAY_DAYS + 1)), 'yyyy-MM-dd');
const fallbackPaycheck = format(addDays(dueDate, -MAX_FALLBACK_PREPAY_DAYS), 'yyyy-MM-dd');
const pastFallback = format(addDays(dueDate, -(MAX_FALLBACK_PREPAY_DAYS + 1)), 'yyyy-MM-dd');

describe('assignmentConstraints', () => {
  describe('getAssignmentViolation', () => {
    it('returns late when paycheck is after due date', () => {
      expect(getAssignmentViolation('2026-01-15', '2026-01-20', ['2026-01-15', '2026-01-20'])).toBe('late');
    });

    it('returns too_early when a closer paycheck is inside the 20-day window', () => {
      expect(getAssignmentViolation(due, tooEarlyPaycheck, [tooEarlyPaycheck, edgePaycheck])).toBe('too_early');
    });

    // Intentional Phase 1 change: a 27-day prepay is legal when it is the 31-day fallback.
    it('returns null for a monthly-style prepay that is the 31-day fallback', () => {
      expect(getAssignmentViolation('2026-01-28', '2026-01-01', ['2026-01-01'])).toBeNull();
    });

    it('returns too_early past the 31-day fallback', () => {
      expect(getAssignmentViolation(due, pastFallback, [pastFallback])).toBe('too_early');
    });

    it('returns null when paycheck is on due date', () => {
      expect(getAssignmentViolation('2026-01-15', '2026-01-15', ['2026-01-15'])).toBeNull();
    });

    it('returns null when paycheck is exactly MAX_PREPAY_DAYS early', () => {
      expect(getAssignmentViolation(due, edgePaycheck, [edgePaycheck])).toBeNull();
    });

    it('returns null when paycheck is exactly MAX_FALLBACK_PREPAY_DAYS early and nothing is closer', () => {
      expect(getAssignmentViolation(due, fallbackPaycheck, [fallbackPaycheck])).toBeNull();
    });

    it('returns null when paycheck is within the MAX_PREPAY_DAYS window', () => {
      expect(getAssignmentViolation('2026-01-28', '2026-01-20', ['2026-01-01', '2026-01-20'])).toBeNull();
    });

    it('returns too_early when the drop date is not already in the operating list', () => {
      expect(getAssignmentViolation('2026-01-25', '2026-01-20', ['2026-01-01'])).toBe('too_early');
    });

    it('ignores a non-preferred operating paycheck inside the window for the 31-day fallback', () => {
      expect(
        getAssignmentViolation(
          '2026-01-25',
          '2026-01-01',
          [
            { date: '2026-01-01', incomeSourceIds: ['job'] },
            { date: '2026-01-20', incomeSourceIds: ['side'] },
          ],
          'job'
        )
      ).toBeNull();
      expect(
        getAssignmentViolation(
          '2026-01-25',
          '2026-01-20',
          [
            { date: '2026-01-01', incomeSourceIds: ['job'] },
            { date: '2026-01-20', incomeSourceIds: ['side'] },
          ],
          'job'
        )
      ).toBe('too_early');
    });
  });

  describe('needsAssignmentConfirmation', () => {
    it('returns true for late assignments', () => {
      expect(needsAssignmentConfirmation('2026-01-15', '2026-01-20', ['2026-01-20'])).toBe(true);
    });

    it('returns true when the drop is outside the eligible set', () => {
      expect(needsAssignmentConfirmation(due, tooEarlyPaycheck, [tooEarlyPaycheck, edgePaycheck])).toBe(true);
      expect(needsAssignmentConfirmation(due, pastFallback, [pastFallback])).toBe(true);
    });

    it('returns false for the 31-day fallback and for assignments inside the window', () => {
      expect(needsAssignmentConfirmation('2026-01-28', '2026-01-01', ['2026-01-01'])).toBe(false);
      expect(needsAssignmentConfirmation('2026-01-28', '2026-01-20', ['2026-01-20'])).toBe(false);
      expect(needsAssignmentConfirmation(due, edgePaycheck, [edgePaycheck])).toBe(false);
    });
  });
});