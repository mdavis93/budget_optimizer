import { describe, it, expect } from 'vitest';
import { buildScheduleCacheKey } from '../../../src/utils/scheduleCache';

describe('scheduleCache', () => {
  it('builds stable cache keys for identical inputs', () => {
    const overlay = { incomes: [{ id: 'income-1' }] };
    const keyA = buildScheduleCacheKey(overlay, '2026-01-01', 3, 1000);
    const keyB = buildScheduleCacheKey(overlay, '2026-01-01', 3, 1000);
    expect(keyA).toBe(keyB);
  });

  it('changes cache key when schedule params differ', () => {
    const keyA = buildScheduleCacheKey(undefined, '2026-01-01', 3, 1000);
    const keyB = buildScheduleCacheKey(undefined, '2026-02-01', 3, 1000);
    expect(keyA).not.toBe(keyB);
  });
});
