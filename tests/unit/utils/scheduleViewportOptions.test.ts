import { describe, expect, it } from 'vitest';
import { buildViewportOptions } from '../../../src/utils/scheduleViewportOptions';

const START = '2026-01-01';

describe('buildViewportOptions', () => {
  it('returns the fixed 1/3/6/12 options when there are no goals', () => {
    const options = buildViewportOptions(12, START, []);
    expect(options.map((o) => o.value)).toEqual([1, 3, 6, 12]);
    expect(options.map((o) => o.label)).toEqual(['1 Month', '3 Months', '6 Months', '12 Months']);
  });

  it('appends a goal shortcut for a longer goal, sorted by length', () => {
    const options = buildViewportOptions(18, START, [
      { goalName: 'Car', targetDate: '2027-07-01' }, // 18 months out
    ]);
    expect(options.map((o) => o.value)).toEqual([1, 3, 6, 12, 18]);
    const longest = options.at(-1);
    expect(longest?.value).toBe(18);
    expect(longest?.label).toBe('Through "Car" (Jul 2027)');
  });

  it('dedupes a goal that resolves to a fixed month count (fixed entry wins)', () => {
    const options = buildViewportOptions(12, START, [
      { goalName: 'Trip', targetDate: '2026-07-01' }, // 6 months -> collides with fixed "6 Months"
    ]);
    expect(options.map((o) => o.value)).toEqual([1, 3, 6, 12]);
    const six = options.find((o) => o.value === 6);
    expect(six?.label).toBe('6 Months');
  });

  it('clamps a goal beyond the horizon to the horizon', () => {
    // Horizon capped at 60; a goal ~84 months out clamps to 60.
    const options = buildViewportOptions(60, START, [
      { goalName: 'House', targetDate: '2033-01-01' },
    ]);
    const longest = options.at(-1);
    expect(longest?.value).toBe(60);
    expect(longest?.label).toBe('Through "House" (Jan 2033)');
  });

  it('collapses two goals that resolve to the same month count', () => {
    const options = buildViewportOptions(24, START, [
      { goalName: 'First', targetDate: '2028-01-05' }, // 24 months (rounded up)
      { goalName: 'Second', targetDate: '2028-01-20' }, // also 24 months
    ]);
    const longOptions = options.filter((o) => o.value === 24);
    expect(longOptions).toHaveLength(1);
    // Earliest deadline (after sort) wins the label.
    expect(longOptions[0].label).toBe('Through "First" (Jan 2028)');
  });

  it('never offers an option longer than the horizon', () => {
    const options = buildViewportOptions(18, START, [
      { goalName: 'Car', targetDate: '2027-07-01' },
    ]);
    expect(options.every((o) => o.value <= 18)).toBe(true);
  });
});
