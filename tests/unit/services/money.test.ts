import { describe, it, expect } from 'vitest';
import { toCents, fromCents } from '../../../electron/services/scheduler/money';

describe('money', () => {
  it('converts dollars to cents with rounding', () => {
    expect(toCents(10.5)).toBe(1050);
    expect(toCents(10.555)).toBe(1056);
    expect(toCents(0.01)).toBe(1);
  });

  it('converts cents back to dollars', () => {
    expect(fromCents(1050)).toBe(10.5);
    expect(fromCents(1)).toBe(0.01);
  });

  it('round-trips common amounts', () => {
    expect(fromCents(toCents(2650))).toBe(2650);
    expect(fromCents(toCents(165.49))).toBe(165.49);
  });

  it('handles negative cents', () => {
    expect(toCents(-16)).toBe(-1600);
    expect(fromCents(-1600)).toBe(-16);
  });
});
