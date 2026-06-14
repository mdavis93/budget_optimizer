import { describe, it, expect } from 'vitest';
import {
  getAssignmentViolation,
  needsAssignmentConfirmation,
  MAX_PREPAY_DAYS,
} from '../../../src/utils/assignmentConstraints';

describe('assignmentConstraints', () => {
  it('exports MAX_PREPAY_DAYS as 14', () => {
    expect(MAX_PREPAY_DAYS).toBe(14);
  });

  describe('getAssignmentViolation', () => {
    it('returns late when paycheck is after due date', () => {
      expect(getAssignmentViolation('2026-01-15', '2026-01-20')).toBe('late');
    });

    it('returns too_early when paycheck is more than 14 days before due date', () => {
      expect(getAssignmentViolation('2026-01-28', '2026-01-01')).toBe('too_early');
    });

    it('returns null when paycheck is on due date', () => {
      expect(getAssignmentViolation('2026-01-15', '2026-01-15')).toBeNull();
    });

    it('returns null when paycheck is exactly 14 days early', () => {
      expect(getAssignmentViolation('2026-01-15', '2026-01-01')).toBeNull();
    });

    it('returns null when paycheck is within the 14-day window', () => {
      expect(getAssignmentViolation('2026-01-28', '2026-01-20')).toBeNull();
    });
  });

  describe('needsAssignmentConfirmation', () => {
    it('returns true for late assignments', () => {
      expect(needsAssignmentConfirmation('2026-01-15', '2026-01-20')).toBe(true);
    });

    it('returns true for more than 14 days early', () => {
      expect(needsAssignmentConfirmation('2026-01-28', '2026-01-01')).toBe(true);
    });

    it('returns false for assignments within the allowed window', () => {
      expect(needsAssignmentConfirmation('2026-01-28', '2026-01-20')).toBe(false);
      expect(needsAssignmentConfirmation('2026-01-15', '2026-01-01')).toBe(false);
    });
  });
});
