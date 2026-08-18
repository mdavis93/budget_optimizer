import { describe, expect, it } from 'vitest';
import {
  scheduleProgressLabel,
  scheduleProgressPercent,
} from '../../../src/utils/scheduleComputeProgress';

describe('scheduleComputeProgress', () => {
  it('sits at the stage start when there is no sub-count', () => {
    expect(scheduleProgressPercent({ stage: 'assigning' })).toBe(0);
    expect(scheduleProgressPercent({ stage: 'reconciling' })).toBe(35);
    expect(scheduleProgressPercent({ stage: 'finishing' })).toBe(92);
  });

  it('interpolates validating_plan using current/total', () => {
    expect(scheduleProgressPercent({ stage: 'validating_plan', current: 1, total: 2 })).toBe(74);
    expect(scheduleProgressLabel({ stage: 'validating_plan', current: 2, total: 4 })).toBe(
      'Validating adjustment 2 of 4…'
    );
  });
});
