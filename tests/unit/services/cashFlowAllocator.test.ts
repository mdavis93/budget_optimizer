import { describe, it, expect } from 'vitest';
import {
  allocateGoalsAndSavings,
  allocateFromSnapshot,
  createCashFlowSnapshot,
  type AllocatorGoal,
  type AllocatorPaycheck,
} from '../../../electron/services/scheduler/cashFlowAllocator';

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

describe('allocateGoalsAndSavings', () => {
  it('routes all surplus to savings when there are no goals', () => {
    const result = allocateGoalsAndSavings(
      [paycheck('2026-01-01', 300), paycheck('2026-02-01', 300)],
      []
    );
    expect(result.goals).toEqual([]);
    expect(result.paychecks.map((p) => p.savingsDeposit)).toEqual([300, 300]);
    expect(result.paychecks.every((p) => p.totalGoalDeposits === 0)).toBe(true);
    expect(result.paychecks.some((p) => p.savingsSqueezed)).toBe(false);
  });

  it('funds a goal from above-primary capacity while protecting the primary savings target', () => {
    const result = allocateGoalsAndSavings(
      [
        paycheck('2026-01-01', 300),
        paycheck('2026-02-01', 300),
        paycheck('2026-03-01', 300),
        paycheck('2026-04-01', 300),
      ],
      [goal({ targetAmount: 400, targetDate: '2026-04-30' })]
    );
    const funded = result.goals[0];
    expect(funded.funded).toBe(true);
    expect(funded.atRisk).toBe(false);
    expect(funded.totalAllocated).toBe(400);
    expect(result.paychecks.every((p) => p.savingsDeposit >= 150)).toBe(true);
    expect(result.paychecks.every((p) => !p.savingsSqueezed)).toBe(true);
  });

  it('dips into the fallback band only as late as needed and funds the goal', () => {
    const result = allocateGoalsAndSavings(
      [paycheck('2026-01-01', 250), paycheck('2026-02-01', 250)],
      [goal({ targetAmount: 250, targetDate: '2026-02-01' })]
    );
    expect(result.goals[0].funded).toBe(true);
    expect(result.paychecks.every((p) => p.savingsDeposit >= 100)).toBe(true);
    expect(result.paychecks.some((p) => p.savingsDeposit < 150)).toBe(true);
    expect(result.paychecks.every((p) => !p.savingsSqueezed)).toBe(true);
  });

  it('flags a squeeze when goals push savings below the fallback target', () => {
    const result = allocateGoalsAndSavings(
      [paycheck('2026-01-01', 120), paycheck('2026-02-01', 120)],
      [goal({ targetAmount: 200, targetDate: '2026-02-01' })]
    );
    expect(result.goals[0].funded).toBe(true);
    expect(result.paychecks.every((p) => p.savingsDeposit < 100)).toBe(true);
    expect(result.paychecks.every((p) => p.savingsSqueezed)).toBe(true);
  });

  it('marks a goal at risk when capacity cannot meet it by the deadline', () => {
    const result = allocateGoalsAndSavings(
      [paycheck('2026-01-01', 100), paycheck('2026-02-01', 100)],
      [goal({ targetAmount: 500, targetDate: '2026-02-01' })]
    );
    const unfunded = result.goals[0];
    expect(unfunded.funded).toBe(false);
    expect(unfunded.atRisk).toBe(true);
    expect(unfunded.shortfall).toBe(500);
    expect(unfunded.totalAllocated).toBe(0);
  });

  it('only draws from paychecks on or before the deadline', () => {
    const result = allocateGoalsAndSavings(
      [
        paycheck('2026-01-01', 300),
        paycheck('2026-02-01', 300),
        paycheck('2026-03-01', 300),
      ],
      [goal({ targetAmount: 200, targetDate: '2026-02-01' })]
    );
    expect(result.paychecks[2].totalGoalDeposits).toBe(0);
    expect(result.paychecks[2].savingsDeposit).toBe(300);
    expect(result.goals[0].funded).toBe(true);
  });

  it('funds higher-priority goals first when capacity is scarce', () => {
    const result = allocateGoalsAndSavings(
      [paycheck('2026-01-01', 100)],
      [
        goal({ id: 'a', name: 'A', priority: 1, targetAmount: 80, targetDate: '2026-01-01' }),
        goal({ id: 'b', name: 'B', priority: 2, targetAmount: 80, targetDate: '2026-01-01' }),
      ]
    );
    const a = result.goals.find((g) => g.goalId === 'a')!;
    const b = result.goals.find((g) => g.goalId === 'b')!;
    expect(a.funded).toBe(true);
    expect(a.totalAllocated).toBe(80);
    expect(b.atRisk).toBe(true);
    expect(b.totalAllocated).toBe(0);
  });

  it('never dips below a configured hard savings floor', () => {
    const result = allocateGoalsAndSavings(
      [paycheck('2026-01-01', 300), paycheck('2026-02-01', 300)],
      [goal({ targetAmount: 100000, targetDate: '2026-03-01' })],
      { minSavingsPerPaycheck: 200 }
    );
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

describe('cashFlowAllocator oracle', () => {
  it('meets every protected goal and holds floors', () => {
    const paychecks = [
      paycheck('2026-01-01', 400),
      paycheck('2026-02-01', 400),
      paycheck('2026-03-01', 400),
      paycheck('2026-04-01', 400),
    ];
    const goals = [
      goal({ id: 'a', name: 'A', priority: 1, targetAmount: 300, targetDate: '2026-03-01' }),
      goal({ id: 'b', name: 'B', priority: 2, targetAmount: 200, targetDate: '2026-04-30' }),
    ];
    const result = allocateGoalsAndSavings(paychecks, goals);
    expect(result.goals.every((g) => g.funded)).toBe(true);
    expect(result.paychecks.every((p) => p.savingsDeposit >= 0)).toBe(true);
  });

  it('does not deposit to a lower-priority protected goal until higher-priority remaining need is 0', () => {
    const result = allocateGoalsAndSavings(
      [paycheck('2026-01-01', 300), paycheck('2026-02-01', 300), paycheck('2026-03-01', 300)],
      [
        goal({ id: 'high', name: 'High', priority: 1, targetAmount: 250, targetDate: '2026-04-01' }),
        goal({ id: 'low', name: 'Low', priority: 2, targetAmount: 100, targetDate: '2026-04-01' }),
      ]
    );
    let highRemaining = 250;
    for (const paycheckAlloc of result.paychecks) {
      const high = paycheckAlloc.goalDeposits.find((d) => d.goalId === 'high')?.amount ?? 0;
      const low = paycheckAlloc.goalDeposits.find((d) => d.goalId === 'low')?.amount ?? 0;
      if (low > 0) {
        expect(highRemaining - high).toBe(0);
      }
      highRemaining -= high;
    }
    expect(result.goals.find((g) => g.goalId === 'high')?.funded).toBe(true);
    expect(result.goals.find((g) => g.goalId === 'low')?.funded).toBe(true);
  });

  it('allows a smaller lower-priority goal to complete on an earlier paycheck', () => {
    const result = allocateGoalsAndSavings(
      [
        paycheck('2026-01-15', 200),
        paycheck('2026-02-15', 200),
        paycheck('2026-03-15', 200),
        paycheck('2026-04-15', 200),
      ],
      [
        goal({ id: 'late', name: 'Late', priority: 1, targetAmount: 400, targetDate: '2026-04-15' }),
        goal({ id: 'early', name: 'Early', priority: 2, targetAmount: 50, targetDate: '2026-02-15' }),
      ]
    );
    expect(result.goals.every((g) => g.funded)).toBe(true);
    const completion = (goalId: string): number => {
      let cumulative = 0;
      const need = goalId === 'late' ? 400 : 50;
      for (let i = 0; i < result.paychecks.length; i++) {
        cumulative += result.paychecks[i].goalDeposits.find((d) => d.goalId === goalId)?.amount ?? 0;
        if (cumulative >= need) return i;
      }
      return -1;
    };
    expect(completion('early')).toBeGreaterThanOrEqual(0);
    expect(completion('late')).toBeGreaterThanOrEqual(0);
  });

  it('is deterministic across two runs sharing one snapshot', () => {
    const paychecks = [paycheck('2026-01-01', 280), paycheck('2026-02-01', 190)];
    const goals = [
      goal({ id: 'a', targetAmount: 120, targetDate: '2026-03-01' }),
      goal({ id: 'b', priority: 2, targetAmount: 80, targetDate: '2026-03-01' }),
    ];
    const snapshot = createCashFlowSnapshot(paychecks, goals);
    const first = allocateFromSnapshot(snapshot);
    const second = allocateFromSnapshot(snapshot);
    expect(second).toEqual(first);
    expect(allocateGoalsAndSavings(paychecks, goals)).toEqual(
      allocateGoalsAndSavings(paychecks, goals)
    );
  });

  it('never lets per-goal deposits exceed remaining need', () => {
    const goals = [
      goal({ id: 'a', targetAmount: 250, alreadySaved: 40, targetDate: '2026-04-01' }),
      goal({ id: 'b', priority: 2, targetAmount: 90, alreadySaved: 10, targetDate: '2026-04-01' }),
    ];
    const result = allocateGoalsAndSavings(
      [paycheck('2026-01-01', 400), paycheck('2026-02-01', 400), paycheck('2026-03-01', 400)],
      goals
    );
    for (const input of goals) {
      const remaining = input.targetAmount - input.alreadySaved;
      const allocated = result.goals.find((g) => g.goalId === input.id)!.totalAllocated;
      expect(allocated).toBeLessThanOrEqual(remaining);
    }
  });

  it('makes per-paycheck surplus equal goal deposits plus savings', () => {
    const paychecks = [
      paycheck('2026-01-01', 333.47),
      paycheck('2026-02-01', 150),
      paycheck('2026-03-01', 0),
    ];
    const result = allocateGoalsAndSavings(paychecks, [
      goal({ targetAmount: 200, targetDate: '2026-03-15' }),
    ]);
    result.paychecks.forEach((alloc, index) => {
      expect(alloc.totalGoalDeposits + alloc.savingsDeposit).toBeCloseTo(paychecks[index].surplus, 10);
    });
  });

  it('does not let a beyond-horizon goal block or reduce a protected goal', () => {
    const protectedOnly = allocateGoalsAndSavings(
      [paycheck('2026-01-01', 300), paycheck('2026-02-01', 300)],
      [goal({ id: 'near', targetAmount: 200, targetDate: '2026-02-01' })]
    );
    const withBeyond = allocateGoalsAndSavings(
      [paycheck('2026-01-01', 300), paycheck('2026-02-01', 300)],
      [
        goal({ id: 'near', targetAmount: 200, targetDate: '2026-02-01' }),
        goal({ id: 'far', name: 'Far', priority: 2, targetAmount: 5000, targetDate: '2030-01-01' }),
      ]
    );
    expect(withBeyond.goals.find((g) => g.goalId === 'near')?.funded).toBe(true);
    expect(withBeyond.goals.find((g) => g.goalId === 'near')?.totalAllocated).toBe(
      protectedOnly.goals[0].totalAllocated
    );
    const farDeposits = withBeyond.paychecks.map(
      (p) => p.goalDeposits.find((d) => d.goalId === 'far')?.amount ?? 0
    );
    expect(farDeposits.some((amount) => amount > 0)).toBe(true);
  });

  it('keeps savings at or above $150 when an unadmitted in-horizon goal cannot meet its deadline', () => {
    const result = allocateGoalsAndSavings(
      [
        paycheck('2026-01-15', 400),
        paycheck('2026-02-15', 400),
        paycheck('2026-03-15', 400),
        paycheck('2026-04-15', 400),
      ],
      [
        goal({ id: 'fit', name: 'Fit', priority: 1, targetAmount: 200, targetDate: '2026-04-15' }),
        goal({
          id: 'impossible',
          name: 'Impossible',
          priority: 2,
          targetAmount: 10000,
          targetDate: '2026-04-15',
        }),
      ]
    );
    const fit = result.goals.find((g) => g.goalId === 'fit')!;
    const impossible = result.goals.find((g) => g.goalId === 'impossible')!;
    expect(fit.funded).toBe(true);
    expect(fit.totalAllocated).toBe(200);
    expect(impossible.funded).toBe(false);
    expect(impossible.totalAllocated).toBe(800);
    expect(result.paychecks.map((p) => p.savingsDeposit)).toEqual([150, 150, 150, 150]);
  });
});
