import { describe, expect, it } from 'vitest';
import { shortfallDeficitAmount } from '../../../shared/shortfallDeficit';

describe('shortfallDeficitAmount', () => {
  it('is the gap from remaining cash to the minimum floor', () => {
    expect(shortfallDeficitAmount(40, 100)).toBe(60);
    expect(shortfallDeficitAmount(65, 100)).toBe(35);
  });

  it('includes the full floor when remaining is at or below zero', () => {
    expect(shortfallDeficitAmount(0, 100)).toBe(100);
    expect(shortfallDeficitAmount(-40, 100)).toBe(140);
  });

  it('is zero when remaining meets the floor', () => {
    expect(shortfallDeficitAmount(100, 100)).toBe(0);
    expect(shortfallDeficitAmount(250, 100)).toBe(0);
  });
});
