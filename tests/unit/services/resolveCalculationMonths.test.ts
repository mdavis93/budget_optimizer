import { describe, it, expect } from 'vitest';
import {
  resolveCalculationMonths,
  SCHEDULE_CALCULATION_MONTHS,
  SCHEDULE_MAX_CALCULATION_MONTHS,
} from '../../../electron/services/scheduler.service';

const START = '2026-01-01';

describe('resolveCalculationMonths', () => {
  it('defaults to the 12-month floor when there are no goals', () => {
    expect(resolveCalculationMonths(START, [])).toBe(SCHEDULE_CALCULATION_MONTHS);
    expect(resolveCalculationMonths(START)).toBe(SCHEDULE_CALCULATION_MONTHS);
  });

  it('keeps the 12-month floor for a goal shorter than a year', () => {
    // 6 months out -> still clamps up to the 12-month floor.
    expect(resolveCalculationMonths(START, [{ targetDate: '2026-07-01' }])).toBe(12);
  });

  it('extends the horizon to span a longer goal', () => {
    // 18 months out -> 18.
    expect(resolveCalculationMonths(START, [{ targetDate: '2027-07-01' }])).toBe(18);
  });

  it('caps the horizon at the maximum', () => {
    // 120 months out -> capped at 60.
    expect(resolveCalculationMonths(START, [{ targetDate: '2036-01-01' }])).toBe(
      SCHEDULE_MAX_CALCULATION_MONTHS
    );
  });

  it('rounds partial months up so the horizon covers the deadline', () => {
    // 2027-02-15 is past the 13-month mark (2027-02-01) -> rounds up to 14.
    expect(resolveCalculationMonths(START, [{ targetDate: '2027-02-15' }])).toBe(14);
  });

  it('takes the maximum across multiple goals', () => {
    expect(
      resolveCalculationMonths(START, [
        { targetDate: '2026-07-01' }, // 6mo
        { targetDate: '2028-01-01' }, // 24mo
        { targetDate: '2027-01-01' }, // 12mo
      ])
    ).toBe(24);
  });

  it('ignores goals whose deadline is today or already passed', () => {
    expect(
      resolveCalculationMonths(START, [
        { targetDate: '2025-06-01' }, // before start
        { targetDate: START }, // exactly start
      ])
    ).toBe(SCHEDULE_CALCULATION_MONTHS);
  });
});
