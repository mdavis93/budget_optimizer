import { describe, it, expect } from 'vitest';
import { scoreEligiblePaycheck } from '../../../electron/utils/scheduleScoring';

describe('scheduleScoring', () => {
  it('prefers lower bill-load paycheck when days early are equal', () => {
    const lowLoad = { billLoadRatio: 0.2, goalReserve: 0, income: 1000, billTotal: 200 };
    const highLoad = { billLoadRatio: 0.9, goalReserve: 0, income: 1000, billTotal: 900 };

    const lowScore = scoreEligiblePaycheck(7, lowLoad, 100, 100, 50);
    const highScore = scoreEligiblePaycheck(7, highLoad, 100, 100, 50);

    expect(lowScore).toBeGreaterThan(highScore);
  });

  it('prefers fewer days early when load is similar', () => {
    const pressure = { billLoadRatio: 0.3, goalReserve: 0, income: 1000, billTotal: 300 };

    const closerScore = scoreEligiblePaycheck(3, pressure, 100, 100, 50);
    const fartherScore = scoreEligiblePaycheck(12, pressure, 100, 100, 50);

    expect(closerScore).toBeGreaterThan(fartherScore);
  });
});
