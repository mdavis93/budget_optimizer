import { describe, expect, it } from 'vitest';
import {
  dayNumberOfDate,
  dayNumberOfIsoDate,
  eligiblePaycheckIndices,
  isFundingPaycheckUsable,
} from '@shared/billEligibility';
import { presumedPaidRecommendation } from '@shared/schedulePresentation';

const days = (...isoDates: string[]) => isoDates.map(dayNumberOfIsoDate);

describe('eligiblePaycheckIndices', () => {
  it('returns every paycheck in [due - 20, due] and never a later one', () => {
    const paychecks = days('2026-01-01', '2026-01-09', '2026-01-23', '2026-02-06');
    expect(eligiblePaycheckIndices(dayNumberOfIsoDate('2026-01-25'), paychecks)).toEqual([1, 2]);
  });

  it('pays a monthly bill due on the 25th from the 1st via the 31-day fallback', () => {
    const paychecks = days('2026-01-01', '2026-02-01');
    expect(eligiblePaycheckIndices(dayNumberOfIsoDate('2026-01-25'), paychecks)).toEqual([0]);
  });

  it('allows exactly 31 days early but not 32 (leave gaps stay unpayable)', () => {
    const paychecks = days('2026-01-01');
    expect(eligiblePaycheckIndices(dayNumberOfIsoDate('2026-02-01'), paychecks)).toEqual([0]);
    expect(eligiblePaycheckIndices(dayNumberOfIsoDate('2026-02-02'), paychecks)).toEqual([]);
  });

  it('applies filters before the fallback so a preferred-source bill never uses another source', () => {
    const paychecks = days('2026-01-01', '2026-01-20');
    const onlyFirstIsPreferred = (index: number) => index === 0;
    expect(
      eligiblePaycheckIndices(dayNumberOfIsoDate('2026-01-25'), paychecks, onlyFirstIsPreferred)
    ).toEqual([0]);
  });

  it('picks only the latest fallback paycheck when none is inside the window', () => {
    const paychecks = days('2025-12-28', '2026-01-02');
    expect(eligiblePaycheckIndices(dayNumberOfIsoDate('2026-01-28'), paychecks)).toEqual([1]);
  });

  it('skips a savings-only paycheck so the 31-day operating fallback remains', () => {
    const paychecks = days('2026-01-01', '2026-01-20');
    expect(
      eligiblePaycheckIndices(
        dayNumberOfIsoDate('2026-01-25'),
        paychecks,
        (index) => index === 0
      )
    ).toEqual([0]);
  });
});

describe('isFundingPaycheckUsable', () => {
  it('rejects savings-only and restored slots, and applies preferred source when ids exist', () => {
    expect(isFundingPaycheckUsable({ purpose: 'savingsAndGoals' })).toBe(false);
    expect(isFundingPaycheckUsable({ unusable: true })).toBe(false);
    expect(isFundingPaycheckUsable({ incomeSourceIds: ['side'] }, 'job')).toBe(false);
    expect(isFundingPaycheckUsable({ incomeSourceIds: ['job'] }, 'job')).toBe(true);
    expect(isFundingPaycheckUsable({}, 'job')).toBe(true);
  });
});

describe('day numbers', () => {
  it('agree for a local Date and its ISO string across DST', () => {
    expect(dayNumberOfDate(new Date(2026, 2, 9))).toBe(dayNumberOfIsoDate('2026-03-09'));
    expect(dayNumberOfIsoDate('2026-03-09') - dayNumberOfIsoDate('2026-03-07')).toBe(2);
  });
});

describe('presumedPaidRecommendation', () => {
  it('is informational: it avoids SchedulePage actionable substrings', () => {
    const text = presumedPaidRecommendation(3);
    expect(text).toContain('3');
    expect(text.toLowerCase()).not.toMatch(/shortfall|deficit/);
    for (const actionable of ["couldn't be resolved", 'consuming over 90%', 'consuming the available surplus']) {
      expect(text).not.toContain(actionable);
    }
  });
});
