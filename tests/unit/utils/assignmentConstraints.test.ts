import { describe, it, expect } from 'vitest';
import { addDays, format, parseISO } from 'date-fns';
import {
  getAssignmentViolation,
  needsAssignmentConfirmation,
  MAX_PREPAY_DAYS,
} from '../../../src/utils/assignmentConstraints';

const due = '2026-01-28';
const dueDate = parseISO(due);
const edgePaycheck = format(addDays(dueDate, -MAX_PREPAY_DAYS), 'yyyy-MM-dd');
const tooEarlyPaycheck = format(addDays(dueDate, -(MAX_PREPAY_DAYS + 1)), 'yyyy-MM-dd');

describe('assignmentConstraints', () => {
  describe('getAssignmentViolation', () => {
    it('returns late when paycheck is after due date', () => {
      expect(getAssignmentViolation('2026-01-15', '2026-01-20')).toBe('late');
    });

    it('returns too_early when paycheck is more than MAX_PREPAY_DAYS before due date', () => {
      expect(getAssignmentViolation(due, tooEarlyPaycheck)).toBe('too_early');
    });

    it('returns too_early for a monthly-style 27-day prepay', () => {
      expect(getAssignmentViolation('2026-01-28', '2026-01-01')).toBe('too_early');
    });

    it('returns null when paycheck is on due date', () => {
      expect(getAssignmentViolation('2026-01-15', '2026-01-15')).toBeNull();
    });

    it('returns null when paycheck is exactly MAX_PREPAY_DAYS early', () => {
      expect(getAssignmentViolation(due, edgePaycheck)).toBeNull();
    });

    it('returns null when paycheck is within the MAX_PREPAY_DAYS window', () => {
      expect(getAssignmentViolation('2026-01-28', '2026-01-20')).toBeNull();
    });
  });

  describe('needsAssignmentConfirmation', () => {
    it('returns true for late assignments', () => {
      expect(needsAssignmentConfirmation('2026-01-15', '2026-01-20')).toBe(true);
    });

    it('returns true for more than MAX_PREPAY_DAYS early', () => {
      expect(needsAssignmentConfirmation(due, tooEarlyPaycheck)).toBe(true);
      expect(needsAssignmentConfirmation('2026-01-28', '2026-01-01')).toBe(true);
    });

    it('returns false for assignments within the allowed window', () => {
      expect(needsAssignmentConfirmation('2026-01-28', '2026-01-20')).toBe(false);
      expect(needsAssignmentConfirmation(due, edgePaycheck)).toBe(false);
    });
  });
});
