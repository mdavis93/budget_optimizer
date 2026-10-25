import { describe, expect, it } from 'vitest';
import { MAX_ADVISOR_EARLY_DAYS, MAX_PREPAY_DAYS } from '@shared/constants';

describe('prepay window constants', () => {
  it('locks the agreed auto-legal and advisor search radii', () => {
    expect(MAX_PREPAY_DAYS).toBe(20);
    expect(MAX_ADVISOR_EARLY_DAYS).toBe(28);
  });

  it('keeps the advisor radius strictly wider than the auto-legal window', () => {
    expect(MAX_ADVISOR_EARLY_DAYS).toBeGreaterThan(MAX_PREPAY_DAYS);
  });
});
