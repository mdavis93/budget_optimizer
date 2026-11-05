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

  it('does not let a lower-priority earlier deadline take surplus while a higher-priority goal still needs it', () => {
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
    expect(result.goals.find((g) => g.goalId === 'late')?.funded).toBe(true);
    let lateRemaining = 400;
    for (const paycheckAlloc of result.paychecks) {
      const late = paycheckAlloc.goalDeposits.find((d) => d.goalId === 'late')?.amount ?? 0;
      const early = paycheckAlloc.goalDeposits.find((d) => d.goalId === 'early')?.amount ?? 0;
      if (early > 0) {
        expect(lateRemaining - late).toBe(0);
      }
      lateRemaining -= late;
    }
  });

  it('does not starve an unadmitted higher-priority goal to complete a lower-priority protected goal', () => {
    const dates = [
      '2026-10-02',
      '2026-10-16',
      '2026-10-30',
      '2026-11-13',
      '2026-11-27',
      '2026-12-11',
      '2027-01-08',
      '2027-01-22',
      '2027-02-05',
      '2027-02-19',
      '2027-03-05',
    ];
    const result = allocateGoalsAndSavings(
      dates.map((date) => paycheck(date, 400)),
      [
        goal({
          id: 'christmas',
          name: 'Christmas',
          priority: 1,
          targetAmount: 4000,
          targetDate: '2026-11-27',
        }),
        goal({
          id: 'con',
          name: 'Con',
          priority: 2,
          targetAmount: 1500,
          targetDate: '2027-03-01',
        }),
        goal({
          id: 'cruise',
          name: 'Cruise',
          priority: 3,
          targetAmount: 10000,
          targetDate: '2027-06-11',
        }),
      ],
      { savingsTargetPrimary: 0, savingsTargetFallback: 0 }
    );
    const christmas = result.goals.find((g) => g.goalId === 'christmas')!;
    const con = result.goals.find((g) => g.goalId === 'con')!;
    expect(christmas.totalAllocated).toBe(2000);
    expect(christmas.funded).toBe(false);
    expect(con.funded).toBe(true);

    result.paychecks.forEach((paycheckAlloc, index) => {
      const toChristmas = paycheckAlloc.goalDeposits.find((d) => d.goalId === 'christmas')?.amount ?? 0;
      const toOthers = paycheckAlloc.goalDeposits
        .filter((d) => d.goalId !== 'christmas')
        .reduce((sum, deposit) => sum + deposit.amount, 0);
      if (dates[index] <= '2026-11-27') {
        expect(toOthers).toBe(0);
        expect(toChristmas).toBeGreaterThan(0);
      }
    });
  });

  it('still funds a lower-priority protected goal from later paychecks after a higher-priority window is exhausted', () => {
    const dates = [
      '2026-10-02',
      '2026-10-16',
      '2026-10-30',
      '2026-11-13',
      '2026-11-27',
      '2026-12-11',
      '2027-01-08',
      '2027-01-22',
      '2027-02-05',
      '2027-02-19',
      '2027-03-05',
    ];
    const result = allocateGoalsAndSavings(
      dates.map((date) => paycheck(date, 400)),
      [
        goal({
          id: 'christmas',
          name: 'Christmas',
          priority: 1,
          targetAmount: 4000,
          targetDate: '2026-11-27',
        }),
        goal({
          id: 'con',
          name: 'Con',
          priority: 2,
          targetAmount: 6000,
          targetDate: '2027-03-01',
        }),
        goal({
          id: 'cruise',
          name: 'Cruise',
          priority: 3,
          targetAmount: 10000,
          targetDate: '2027-06-11',
        }),
      ]
    );
    const christmas = result.goals.find((g) => g.goalId === 'christmas')!;
    const con = result.goals.find((g) => g.goalId === 'con')!;
    const cruise = result.goals.find((g) => g.goalId === 'cruise')!;
    expect(christmas.totalAllocated).toBeGreaterThan(0);
    expect(con.totalAllocated).toBeGreaterThan(0);
    expect(cruise.totalAllocated).toBeGreaterThan(0);
    result.paychecks.forEach((paycheckAlloc, index) => {
      const toChristmas = paycheckAlloc.goalDeposits.find((d) => d.goalId === 'christmas')?.amount ?? 0;
      const toOthers = paycheckAlloc.goalDeposits
        .filter((d) => d.goalId !== 'christmas')
        .reduce((sum, deposit) => sum + deposit.amount, 0);
      if (dates[index] <= '2026-11-27' && toChristmas > 0) {
        expect(toOthers).toBe(0);
      }
    });
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

  it('does not let an earlier protected goal spend a later protected goal’s savings dip', () => {
    const result = allocateGoalsAndSavings(
      [
        paycheck('2026-01-01', 250),
        paycheck('2026-01-15', 155),
        paycheck('2026-02-01', 30),
        paycheck('2026-02-15', 30),
      ],
      [
        goal({ id: 'high', name: 'High', priority: 1, targetAmount: 120, targetDate: '2026-01-15' }),
        goal({ id: 'mid', name: 'Mid', priority: 2, targetAmount: 500, targetDate: '2026-02-01' }),
        goal({ id: 'low', name: 'Low', priority: 3, targetAmount: 250, targetDate: '2026-02-15' }),
      ]
    );
    const high = result.goals.find((entry) => entry.goalId === 'high')!;
    const mid = result.goals.find((entry) => entry.goalId === 'mid')!;
    const low = result.goals.find((entry) => entry.goalId === 'low')!;
    expect(high.funded).toBe(true);
    expect(high.totalAllocated).toBe(120);
    expect(mid.totalAllocated).toBe(0);
    expect(low.funded).toBe(true);
    expect(low.totalAllocated).toBe(250);
    expect(result.paychecks.every((entry) => entry.savingsDeposit >= 0)).toBe(true);
  });

  it('finishes a protected goal by dipping after a higher-priority unadmitted goal takes above-primary cash', () => {
    const dates = [
      '2026-01-15',
      '2026-02-15',
      '2026-03-15',
      '2026-04-15',
      '2026-05-15',
      '2026-06-15',
    ];
    const result = allocateGoalsAndSavings(
      dates.map((date) => paycheck(date, 200)),
      [
        goal({ id: 'high', name: 'High', priority: 1, targetAmount: 80, targetDate: '2026-01-15' }),
        goal({ id: 'mid', name: 'Mid', priority: 2, targetAmount: 1000, targetDate: '2026-05-15' }),
        goal({ id: 'low', name: 'Low', priority: 3, targetAmount: 500, targetDate: '2026-06-15' }),
      ]
    );
    const high = result.goals.find((entry) => entry.goalId === 'high')!;
    const mid = result.goals.find((entry) => entry.goalId === 'mid')!;
    const low = result.goals.find((entry) => entry.goalId === 'low')!;
    expect(high.funded).toBe(true);
    expect(high.totalAllocated).toBe(80);
    expect(mid.funded).toBe(false);
    expect(mid.totalAllocated).toBe(200);
    expect(low.funded).toBe(true);
    expect(low.totalAllocated).toBe(500);
    expect(result.paychecks.every((entry) => entry.savingsDeposit >= 0)).toBe(true);
  });

  it('funds an open-ended goal on the same paychecks as a dated goal that still hits its deadline', () => {
    const dates = [
      '2026-01-02',
      '2026-01-16',
      '2026-01-30',
      '2026-02-13',
      '2026-02-27',
      '2026-03-13',
      '2026-03-27',
      '2026-04-10',
      '2026-04-24',
      '2026-05-08',
    ];
    const result = allocateGoalsAndSavings(
      dates.map((date) => paycheck(date, 300)),
      [
        goal({ id: 'dated', name: 'Vacation', priority: 1, targetAmount: 1000, targetDate: '2026-05-08' }),
        goal({
          id: 'open',
          name: 'New Car',
          priority: 2,
          targetAmount: 5000,
          targetDate: '',
          openEnded: true,
        }),
      ],
      { savingsTargetPrimary: 0, savingsTargetFallback: 0 }
    );

    const dated = result.goals.find((entry) => entry.goalId === 'dated')!;
    const open = result.goals.find((entry) => entry.goalId === 'open')!;
    expect(dated.funded).toBe(true);
    expect(dated.totalAllocated).toBe(1000);
    expect(open.totalAllocated).toBe(2000);

    const sharedPaychecks = result.paychecks.filter((paycheckAlloc) => {
      const datedAmount = paycheckAlloc.goalDeposits.find((deposit) => deposit.goalId === 'dated')?.amount ?? 0;
      const openAmount = paycheckAlloc.goalDeposits.find((deposit) => deposit.goalId === 'open')?.amount ?? 0;
      return datedAmount > 0 && openAmount > 0;
    });
    expect(sharedPaychecks).toHaveLength(dates.length);
    expect(result.paychecks[0].goalDeposits.find((deposit) => deposit.goalId === 'dated')?.amount).toBe(100);
    expect(result.paychecks[0].goalDeposits.find((deposit) => deposit.goalId === 'open')?.amount).toBe(200);
  });

  it('withholds an open-ended goal when a dated goal needs the whole surplus to hit its deadline', () => {
    const result = allocateGoalsAndSavings(
      ['2026-01-02', '2026-01-16', '2026-01-30', '2026-02-13'].map((date) => paycheck(date, 100)),
      [
        goal({ id: 'dated', name: 'Vacation', targetAmount: 400, targetDate: '2026-02-13' }),
        goal({ id: 'open', name: 'New Car', priority: 2, targetAmount: 5000, targetDate: '', openEnded: true }),
      ],
      { savingsTargetPrimary: 0, savingsTargetFallback: 0 }
    );

    expect(result.goals.find((entry) => entry.goalId === 'dated')).toMatchObject({
      funded: true,
      totalAllocated: 400,
    });
    expect(result.goals.find((entry) => entry.goalId === 'open')?.totalAllocated).toBe(0);
  });

  it('funds an open-ended goal from surplus above the savings target and does not dip to chase it', () => {
    const result = allocateGoalsAndSavings(
      [paycheck('2026-01-01', 300), paycheck('2026-02-01', 300), paycheck('2026-03-01', 300)],
      [goal({ id: 'open', name: 'New Car', targetAmount: 400, targetDate: '', openEnded: true })]
    );

    expect(result.goals[0].totalAllocated).toBe(400);
    expect(result.goals[0].funded).toBe(true);
    expect(result.paychecks.every((entry) => entry.savingsDeposit >= 150)).toBe(true);
    expect(result.paychecks.every((entry) => !entry.savingsSqueezed)).toBe(true);
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
