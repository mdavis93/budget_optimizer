import { describe, expect, it } from 'vitest';
import { mulberry32, randomInt } from '../../helpers/prng';

describe('mulberry32', () => {
  it('repeats a locked sequence for the same seed', () => {
    const first = mulberry32(1);
    const second = mulberry32(1);
    const values = [first(), first(), first()];
    expect(values).toEqual([
      0.6270739405881613,
      0.002735721180215478,
      0.5274470399599522,
    ]);
    expect([second(), second(), second()]).toEqual(values);
    expect(mulberry32(2)()).not.toBe(values[0]);
  });

  it('stays inside [0, 1)', () => {
    const next = mulberry32(99);
    for (let index = 0; index < 1000; index++) {
      const value = next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('randomInt', () => {
  it('draws integers in the half-open range', () => {
    const next = mulberry32(5);
    for (let index = 0; index < 200; index++) {
      const value = randomInt(next, 3, 7);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThan(7);
      expect(Number.isInteger(value)).toBe(true);
    }
  });
});
