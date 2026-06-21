import { describe, it, expect } from 'vitest';
import {
  allocateGoalsAndSavings,
  fillProportional,
  type AllocatorGoal,
  type AllocatorPaycheck,
} from '../../../electron/services/scheduler/goalSavingsAllocator';

function paycheck(date: string, surplus: number): AllocatorPaycheck {
  return { date, surplus };
}

function goal(overrides: Partial<AllocatorGoal> = {}): AllocatorGoal {
  return {
    id: 'g1',
    name: 'Goal',
    targetAmount: 100,
    alreadySaved: 0,
    priority: 1,
    targetDate: '2030-01-01',
    ...overrides,
  };
}

describe('fillProportional', () => {
  it('splits evenly across equal capacities', () => {
    expect(fillProportional(100, [100, 100])).toEqual([50, 50]);
  });

  it('splits proportional to capacity', () => {
    expect(fillProportional(100, [30, 70])).toEqual([30, 70]);
  });

  it('never exceeds the total capacity', () => {
    const result = fillProportional(1000, [10, 10, 10]);
    expect(result).toEqual([10, 10, 10]);
  });

  it('returns whole dollars that sum to the requested amount', () => {
    const result = fillProportional(10, [3, 3, 3]);
    expect(result.reduce((a, b) => a + b, 0)).toBe(9); // capacity-limited to 9
    expect(result).toEqual([3, 3, 3]);
  });

  it('uses largest-remainder rounding for indivisible splits', () => {
    const result = fillProportional(8, [3, 3, 3]);
    expect(result.reduce((a, b) => a + b, 0)).toBe(8);
    expect(result).toEqual([3, 3, 2]);
  });

  it('redistributes when a small entry caps out', () => {
    const result = fillProportional(5, [10, 2]);
    expect(result.reduce((a, b) => a + b, 0)).toBe(5);
    expect(result.every((amt, i) => amt <= [10, 2][i])).toBe(true);
  });

  it('returns zeros for non-positive amounts', () => {
    expect(fillProportional(0, [10, 10])).toEqual([0, 0]);
    expect(fillProportional(-5, [10, 10])).toEqual([0, 0]);
  });

  it('respects per-entry caps across many randomized inputs', () => {
    const cases: Array<{ amount: number; caps: number[] }> = [
      { amount: 37, caps: [5, 12, 50] },
      { amount: 200, caps: [10, 10, 10] },
      { amount: 91, caps: [40, 40, 40] },
      { amount: 13, caps: [1, 1, 1, 1, 1000] },
    ];
    for (const { amount, caps } of cases) {
      const result = fillProportional(amount, caps);
      const total = result.reduce((a, b) => a + b, 0);
      expect(total).toBe(Math.min(amount, caps.reduce((a, b) => a + b, 0)));
      result.forEach((amt, i) => {
        expect(amt).toBeGreaterThanOrEqual(0);
        expect(amt).toBeLessThanOrEqual(caps[i]);
        expect(Number.isInteger(amt)).toBe(true);
      });
    }
  });
});

describe('allocateGoalsAndSavings', () => {
  it('routes all surplus to savings when there are no goals', () => {
    const result = allocateGoalsAndSavings([paycheck('2026-01-01', 300), paycheck('2026-02-01', 300)], []);
    expect(result.goals).toEqual([]);
    expect(result.paychecks.map((p) => p.savingsDeposit)).toEqual([300, 300]);
    expect(result.paychecks.every((p) => p.totalGoalDeposits === 0)).toBe(true);
    expect(result.paychecks.some((p) => p.savingsSqueezed)).toBe(false);
  });

  it('funds a goal from above-primary capacity while protecting the primary savings target', () => {
    const result = allocateGoalsAndSavings(
      [paycheck('2026-01-01', 300), paycheck('2026-02-01', 300), paycheck('2026-03-01', 300), paycheck('2026-04-01', 300)],
      [goal({ targetAmount: 400, targetDate: '2026-04-30' })]
    );
    const g = result.goals[0];
    expect(g.funded).toBe(true);
    expect(g.atRisk).toBe(false);
    expect(g.totalAllocated).toBe(400);
    // Savings never dips below the $150 primary target.
    expect(result.paychecks.every((p) => p.savingsDeposit >= 150)).toBe(true);
    expect(result.paychecks.every((p) => !p.savingsSqueezed)).toBe(true);
  });

  it('makes richer paychecks contribute proportionally more', () => {
    const result = allocateGoalsAndSavings(
      [paycheck('2026-01-01', 400), paycheck('2026-02-01', 200)],
      [goal({ targetAmount: 300, targetDate: '2026-03-01' })]
    );
    const [rich, lean] = result.paychecks;
    expect(rich.totalGoalDeposits).toBeGreaterThan(lean.totalGoalDeposits);
    // Each keeps the $150 primary savings target.
    expect(rich.savingsDeposit).toBe(150);
    expect(lean.savingsDeposit).toBe(150);
    expect(result.goals[0].funded).toBe(true);
  });

  it('dips into the fallback band without flagging a squeeze', () => {
    const result = allocateGoalsAndSavings(
      [paycheck('2026-01-01', 250), paycheck('2026-02-01', 250)],
      [goal({ targetAmount: 250, targetDate: '2026-03-01' })]
    );
    expect(result.goals[0].funded).toBe(true);
    // Savings between fallback (100) and primary (150): dipped, but not squeezed.
    result.paychecks.forEach((p) => {
      expect(p.savingsDeposit).toBeGreaterThanOrEqual(100);
      expect(p.savingsDeposit).toBeLessThan(150);
      expect(p.savingsSqueezed).toBe(false);
    });
  });

  it('flags a squeeze when goals push savings below the fallback target', () => {
    const result = allocateGoalsAndSavings(
      [paycheck('2026-01-01', 120), paycheck('2026-02-01', 120)],
      [goal({ targetAmount: 200, targetDate: '2026-03-01' })]
    );
    expect(result.goals[0].funded).toBe(true);
    expect(result.paychecks.every((p) => p.savingsDeposit < 100)).toBe(true);
    expect(result.paychecks.every((p) => p.savingsSqueezed)).toBe(true);
  });

  it('marks a goal at risk when capacity cannot meet it by the deadline', () => {
    const result = allocateGoalsAndSavings(
      [paycheck('2026-01-01', 100), paycheck('2026-02-01', 100)],
      [goal({ targetAmount: 500, targetDate: '2026-03-01' })]
    );
    const g = result.goals[0];
    expect(g.funded).toBe(false);
    expect(g.atRisk).toBe(true);
    expect(g.shortfall).toBe(300); // 200 fundable of 500
    expect(g.totalAllocated).toBe(200);
  });

  it('only draws from paychecks on or before the deadline', () => {
    const result = allocateGoalsAndSavings(
      [paycheck('2026-01-01', 300), paycheck('2026-02-01', 300), paycheck('2026-03-01', 300)],
      [goal({ targetAmount: 200, targetDate: '2026-02-01' })]
    );
    // The March paycheck is outside the window: untouched.
    expect(result.paychecks[2].totalGoalDeposits).toBe(0);
    expect(result.paychecks[2].savingsDeposit).toBe(300);
    expect(result.goals[0].funded).toBe(true);
  });

  it('funds higher-priority goals first when capacity is scarce', () => {
    const result = allocateGoalsAndSavings(
      [paycheck('2026-01-01', 100)],
      [
        goal({ id: 'a', name: 'A', priority: 1, targetAmount: 80, targetDate: '2026-02-01' }),
        goal({ id: 'b', name: 'B', priority: 2, targetAmount: 80, targetDate: '2026-02-01' }),
      ]
    );
    const a = result.goals.find((g) => g.goalId === 'a')!;
    const b = result.goals.find((g) => g.goalId === 'b')!;
    expect(a.funded).toBe(true);
    expect(a.totalAllocated).toBe(80);
    expect(b.atRisk).toBe(true);
    expect(b.totalAllocated).toBe(20);
  });

  it('never dips below a configured hard savings floor', () => {
    const result = allocateGoalsAndSavings(
      [paycheck('2026-01-01', 300), paycheck('2026-02-01', 300)],
      [goal({ targetAmount: 100000, targetDate: '2026-03-01' })],
      { minSavingsPerPaycheck: 200 }
    );
    // Even though the goal is starved, savings stays at/above the $200 floor.
    expect(result.paychecks.every((p) => p.savingsDeposit >= 200)).toBe(true);
    expect(result.paychecks.every((p) => p.totalGoalDeposits <= 100)).toBe(true);
    expect(result.goals[0].atRisk).toBe(true);
  });

  it('produces whole-dollar goal deposits', () => {
    const result = allocateGoalsAndSavings(
      [paycheck('2026-01-01', 333), paycheck('2026-02-01', 277)],
      [goal({ targetAmount: 301, targetDate: '2026-03-01' })]
    );
    result.paychecks.forEach((p) => {
      p.goalDeposits.forEach((d) => expect(Number.isInteger(d.amount)).toBe(true));
      expect(Number.isInteger(p.totalGoalDeposits)).toBe(true);
    });
  });
});
