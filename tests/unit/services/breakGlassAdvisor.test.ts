import { describe, expect, it } from 'vitest';
import { dayNumberOfIsoDate } from '@shared/billEligibility';
import { MAX_ADVISOR_EARLY_DAYS, MAX_PREPAY_DAYS } from '@shared/constants';
import {
  proposeBreakGlassPlans,
  type ProposeBreakGlassOptions,
} from '../../../electron/services/scheduler/breakGlassAdvisor';
import { GreedySolver } from '../../../electron/services/scheduler/solvers/greedySolver';
import type { AssignmentSolver } from '../../../electron/services/scheduler/solvers/types';
import { rebuildBreakGlassAdvisorForViewport } from '../../../shared/scheduleViewportSlice';
import type {
  BreakGlassAdvisorReport,
  PaycheckBill,
  PaycheckEntry,
  ScheduleData,
} from '@shared/types';

function bill(overrides: Partial<PaycheckBill> & Pick<PaycheckBill, 'billId' | 'creditorName' | 'amount' | 'billDate'>): PaycheckBill {
  const dueDay = Number(overrides.billDate.slice(-2));
  return {
    dueDay,
    priority: 'normal',
    isIncomeAttached: false,
    isUnpayable: false,
    isSkipped: false,
    ...overrides,
  };
}

function paycheck(overrides: Partial<PaycheckEntry> & Pick<PaycheckEntry, 'date' | 'budgetRemaining'>): PaycheckEntry {
  return {
    incomeSources: [{ id: 'inc-1', name: 'Pay', amount: 2000 }],
    totalIncome: 2000,
    bills: [],
    totalBills: 0,
    goalDeposits: [],
    totalGoalDeposits: 0,
    savingsDeposit: 0,
    totalSavings: 0,
    isShortfall: overrides.budgetRemaining < 100,
    ...overrides,
  };
}

function scheduleOf(paychecks: PaycheckEntry[], startDate = '2026-07-01'): ScheduleData {
  return {
    startDate,
    endDate: '2026-12-31',
    paychecks,
    fullPaychecks: paychecks,
    viewportMonths: 12,
    entries: [],
    summary: {
      totalIncome: 0,
      totalExpenses: 0,
      totalSavingsDeposits: 0,
      finalSavingsBalance: 0,
      netBalance: 0,
      shortfallCount: 0,
      averageBalance: 0,
      lowestBalance: 0,
      highestBalance: 0,
    },
    recommendations: [],
    maxBudgetRemaining: 250,
    minCashOnHand: 100,
  };
}

function replayPlan(schedule: ScheduleData, steps: BreakGlassAdvisorReport['plans'][number]['steps']): Map<string, number> {
  const remaining = new Map(schedule.paychecks.map((paycheck) => [paycheck.date, paycheck.budgetRemaining]));
  for (const step of steps) {
    remaining.set(step.fromPaycheckDate, (remaining.get(step.fromPaycheckDate) ?? 0) + step.billAmount);
    remaining.set(step.toPaycheckDate, (remaining.get(step.toPaycheckDate) ?? 0) - step.billAmount);
  }
  return remaining;
}

function isBreakGlass(remaining: number, schedule: ScheduleData, paycheck: PaycheckEntry): boolean {
  const target = paycheck.targetCashOnHand ?? schedule.maxBudgetRemaining ?? 250;
  const min = paycheck.minCashOnHand ?? schedule.minCashOnHand ?? 100;
  return remaining < target && remaining >= min;
}

function expectAdvisorInvariants(
  report: BreakGlassAdvisorReport,
  schedule: ScheduleData,
  startDate = schedule.startDate
): void {
  expect(report.plans.length).toBeLessThanOrEqual(5);
  const targets = report.plans.map((plan) => plan.targetPaycheckDate);
  expect(new Set(targets).size).toBe(targets.length);
  const bills = new Map(
    schedule.paychecks.flatMap((paycheck) =>
      paycheck.bills.map((bill) => [`${bill.billId}-${bill.billDate}`, bill] as const)
    )
  );

  for (const plan of report.plans) {
    expect(plan.id).toBe(`break-glass-${plan.targetPaycheckDate}`);
    expect(plan.clearsBreakGlass).toBe(true);
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.steps.length).toBeLessThanOrEqual(12);
    const seen = new Set<string>();
    for (const step of plan.steps) {
      const key = `${step.billId}-${step.billDueDate}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
      expect(step.toPaycheckDate <= step.billDueDate).toBe(true);
      expect(step.toPaycheckDate >= startDate).toBe(true);
      expect(step.daysEarly).toBe(
        dayNumberOfIsoDate(step.billDueDate) - dayNumberOfIsoDate(step.toPaycheckDate)
      );
      expect(step.daysEarly).toBeLessThanOrEqual(MAX_ADVISOR_EARLY_DAYS);
      const bill = bills.get(key);
      expect(bill?.isIncomeAttached).not.toBe(true);
      expect(bill?.isSkipped).not.toBe(true);
      expect(bill?.isUnpayable).not.toBe(true);
      if (step.daysEarly <= MAX_PREPAY_DAYS) {
        expect(step.requiresConfirmation).toBe(false);
      }
    }

    const after = replayPlan(schedule, plan.steps);
    for (const paycheck of schedule.paychecks) {
      const next = after.get(paycheck.date) ?? paycheck.budgetRemaining;
      const min = paycheck.minCashOnHand ?? schedule.minCashOnHand ?? 100;
      if (paycheck.budgetRemaining >= min) {
        expect(next).toBeGreaterThanOrEqual(min);
      } else {
        expect(next).toBeGreaterThanOrEqual(paycheck.budgetRemaining);
      }
      const wasBreakGlass = isBreakGlass(paycheck.budgetRemaining, schedule, paycheck);
      const nowBreakGlass = isBreakGlass(next, schedule, paycheck);
      if (!wasBreakGlass) expect(nowBreakGlass).toBe(false);
      if (paycheck.date === plan.targetPaycheckDate) expect(nowBreakGlass).toBe(false);
    }
  }
}

/** Jul 3 surplus → intermediates at target → Jul 31 Break-Glass. One greedy move cannot clear it. */
function julyCascadeFixture(): ScheduleData {
  return scheduleOf([
    paycheck({
      date: '2026-07-03',
      budgetRemaining: 500,
      bills: [],
    }),
    paycheck({
      date: '2026-07-10',
      budgetRemaining: 250,
      bills: [bill({ billId: 'cell', creditorName: 'Cell', amount: 160, billDate: '2026-07-15' })],
    }),
    paycheck({
      date: '2026-07-17',
      budgetRemaining: 250,
      bills: [bill({ billId: 'web', creditorName: 'Web', amount: 160, billDate: '2026-07-22' })],
    }),
    paycheck({
      date: '2026-07-24',
      budgetRemaining: 250,
      bills: [bill({ billId: 'power', creditorName: 'Power', amount: 160, billDate: '2026-07-29' })],
    }),
    paycheck({
      date: '2026-07-31',
      budgetRemaining: 150,
      bills: [bill({ billId: 'rent', creditorName: 'Rent', amount: 160, billDate: '2026-08-08' })],
    }),
  ]);
}

describe('proposeBreakGlassPlans', () => {
  it('keeps the July multi-paycheck fixture inside the advisor invariants', () => {
    const schedule = julyCascadeFixture();
    expectAdvisorInvariants(proposeBreakGlassPlans(schedule), schedule);
  });

  it('returns no plans when schedule has no Break-Glass paychecks', () => {
    const report = proposeBreakGlassPlans(
      scheduleOf([
        paycheck({ date: '2026-07-03', budgetRemaining: 400 }),
        paycheck({ date: '2026-07-10', budgetRemaining: 250 }),
      ])
    );
    expect(report.plans).toEqual([]);
  });

  it('does not propose late assignments', () => {
    // Only earlier paycheck is after the bill due date, so no legal landing exists.
    const report = proposeBreakGlassPlans(
      scheduleOf([
        paycheck({ date: '2026-07-10', budgetRemaining: 500 }),
        paycheck({
          date: '2026-07-17',
          budgetRemaining: 150,
          bills: [
            bill({
              billId: 'late-bill',
              creditorName: 'Already Due',
              amount: 120,
              billDate: '2026-07-05',
            }),
          ],
        }),
      ])
    );
    expect(report.plans).toEqual([]);
  });

  it('caps early moves at MAX_ADVISOR_EARLY_DAYS and proposes nothing if only a later landing would work past the cap', () => {
    const report = proposeBreakGlassPlans(
      scheduleOf([
        paycheck({ date: '2026-07-02', budgetRemaining: 500 }),
        paycheck({
          date: '2026-07-31',
          budgetRemaining: 150,
          bills: [
            bill({
              billId: 'far',
              creditorName: 'Too Early',
              amount: 120,
              // Only Jul 2 is before due; Jul 31→Jul 2 is 29 days early (> MAX_ADVISOR_EARLY_DAYS).
              billDate: '2026-07-31',
            }),
          ],
        }),
      ])
    );
    expect(report.plans).toEqual([]);
  });

  it('requires confirmation only when a landing is past MAX_PREPAY_DAYS', () => {
    const autoLegal = proposeBreakGlassPlans(
      scheduleOf([
        paycheck({ date: '2026-07-11', budgetRemaining: 500 }),
        paycheck({
          date: '2026-07-31',
          budgetRemaining: 150,
          bills: [
            bill({
              billId: 'auto',
              creditorName: 'Auto',
              amount: 120,
              billDate: '2026-07-31',
            }),
          ],
        }),
      ])
    );
    expect(autoLegal.plans).toHaveLength(1);
    expect(autoLegal.plans[0].steps[0]).toMatchObject({
      daysEarly: MAX_PREPAY_DAYS,
      requiresConfirmation: false,
    });

    const confirm = proposeBreakGlassPlans(
      scheduleOf([
        paycheck({ date: '2026-07-10', budgetRemaining: 500 }),
        paycheck({
          date: '2026-07-31',
          budgetRemaining: 150,
          bills: [
            bill({
              billId: 'confirm',
              creditorName: 'Confirm',
              amount: 120,
              billDate: '2026-07-31',
            }),
          ],
        }),
      ])
    );
    expect(confirm.plans).toHaveLength(1);
    expect(confirm.plans[0].steps[0]).toMatchObject({
      daysEarly: MAX_PREPAY_DAYS + 1,
      requiresConfirmation: true,
    });
  });

  it('does not require confirmation when the landing is the 31-day fallback', () => {
    const report = proposeBreakGlassPlans(
      scheduleOf(
        [
          paycheck({
            date: '2026-06-01',
            budgetRemaining: 150,
            bills: [
              bill({
                billId: 'rent',
                creditorName: 'Rent',
                amount: 400,
                billDate: '2026-07-06',
              }),
            ],
          }),
          paycheck({ date: '2026-06-11', budgetRemaining: 800 }),
        ],
        '2026-06-01'
      )
    );
    expect(report.plans).toHaveLength(1);
    expect(report.plans[0].steps[0]).toMatchObject({
      toPaycheckDate: '2026-06-11',
      requiresConfirmation: false,
    });
  });

  it('does not require confirmation when a savings-only paycheck sits inside the 20-day window', () => {
    const report = proposeBreakGlassPlans(
      scheduleOf(
        [
          paycheck({
            date: '2026-06-01',
            budgetRemaining: 150,
            bills: [
              bill({
                billId: 'rent',
                creditorName: 'Rent',
                amount: 400,
                billDate: '2026-07-06',
              }),
            ],
          }),
          paycheck({
            date: '2026-06-20',
            purpose: 'savingsAndGoals',
            budgetRemaining: 500,
          }),
          paycheck({ date: '2026-06-11', budgetRemaining: 800 }),
        ],
        '2026-06-01'
      )
    );
    expect(report.plans).toHaveLength(1);
    expect(report.plans[0].steps[0]).toMatchObject({
      toPaycheckDate: '2026-06-11',
      requiresConfirmation: false,
    });
  });

  it('does not require confirmation when a non-preferred paycheck sits inside the window', () => {
    const report = proposeBreakGlassPlans(
      scheduleOf(
        [
          paycheck({
            date: '2026-06-11',
            budgetRemaining: 800,
            incomeSources: [{ id: 'job', name: 'Pay', amount: 2000 }],
          }),
          paycheck({
            date: '2026-06-20',
            budgetRemaining: 150,
            incomeSources: [{ id: 'side', name: 'Side', amount: 1000 }],
            bills: [
              bill({
                billId: 'rent',
                creditorName: 'Rent',
                amount: 400,
                billDate: '2026-07-06',
                preferredIncomeSourceId: 'job',
              }),
            ],
          }),
        ],
        '2026-06-01'
      )
    );
    expect(report.plans).toHaveLength(1);
    expect(report.plans[0].steps[0]).toMatchObject({
      toPaycheckDate: '2026-06-11',
      requiresConfirmation: false,
    });
  });

  it('stops at scheduleStartDate when earlier paychecks are out of range', () => {
    const report = proposeBreakGlassPlans(
      scheduleOf(
        [
          paycheck({ date: '2026-07-03', budgetRemaining: 500 }),
          paycheck({
            date: '2026-07-17',
            budgetRemaining: 150,
            bills: [
              bill({
                billId: 'need-early',
                creditorName: 'Need July 3',
                amount: 120,
                billDate: '2026-07-20',
              }),
            ],
          }),
        ],
        '2026-07-10'
      ),
      { scheduleStartDate: '2026-07-10' }
    );
    expect(report.plans).toEqual([]);
  });

  it('excludes income-attached and skipped bills from moves', () => {
    const report = proposeBreakGlassPlans(
      scheduleOf([
        paycheck({ date: '2026-07-03', budgetRemaining: 500 }),
        paycheck({
          date: '2026-07-17',
          budgetRemaining: 150,
          bills: [
            bill({
              billId: 'attached',
              creditorName: 'Attached',
              amount: 120,
              billDate: '2026-07-20',
              isIncomeAttached: true,
            }),
            bill({
              billId: 'skipped',
              creditorName: 'Skipped',
              amount: 120,
              billDate: '2026-07-20',
              isSkipped: true,
            }),
          ],
        }),
      ])
    );
    expect(report.plans).toEqual([]);
  });

  it('can relocate a locked bill that sits on the Break-Glass paycheck', () => {
    // Accept locks must not freeze bills already congesting a BG date — otherwise
    // later Accepts that parked a bill onto an earlier paycheck leave no recovery path.
    const report = proposeBreakGlassPlans(
      scheduleOf([
        paycheck({ date: '2026-07-03', budgetRemaining: 500 }),
        paycheck({
          date: '2026-07-17',
          budgetRemaining: 150,
          bills: [
            bill({
              billId: 'locked',
              creditorName: 'Locked',
              amount: 120,
              billDate: '2026-07-20',
            }),
          ],
        }),
      ]),
      { lockedBillKeys: new Set(['locked-2026-07-20']) }
    );
    expect(report.plans).toHaveLength(1);
    expect(report.plans[0].steps[0]).toMatchObject({
      billId: 'locked',
      fromPaycheckDate: '2026-07-17',
      toPaycheckDate: '2026-07-03',
    });
  });

  it('prefers the plan with lower max days-early when scoring', () => {
    // Two movable bills: a large one that can land nearby (14d) and a small one
    // that would need a deeper early move if chosen first under a bad sort.
    const report = proposeBreakGlassPlans(
      scheduleOf([
        paycheck({ date: '2026-07-10', budgetRemaining: 500 }),
        paycheck({ date: '2026-07-17', budgetRemaining: 400 }),
        paycheck({
          date: '2026-07-31',
          budgetRemaining: 150,
          bills: [
            bill({
              billId: 'near',
              creditorName: 'Near',
              amount: 120,
              billDate: '2026-08-07', // 14 days to Jul 24 — but Jul 24 missing; Jul 17 = 21d
            }),
            bill({
              billId: 'farther',
              creditorName: 'Farther',
              amount: 50,
              billDate: '2026-08-07',
            }),
          ],
        }),
      ])
    );

    // With Jul 10 + Jul 17 only, nearest legal landing for Aug 7 due is Jul 17 (21 days).
    expect(report.plans).toHaveLength(1);
    expect(report.plans[0].maxDaysEarly).toBeLessThanOrEqual(MAX_ADVISOR_EARLY_DAYS);
    expect(report.plans[0].steps.every((step) => step.daysEarly <= MAX_ADVISOR_EARLY_DAYS)).toBe(true);
  });

  it('returns empty plans for an empty paycheck list', () => {
    const empty = scheduleOf([]);
    empty.fullPaychecks = [];
    empty.paychecks = [];
    expect(proposeBreakGlassPlans(empty).plans).toEqual([]);
  });

  it('uses paychecks when fullPaychecks is empty', () => {
    const schedule = scheduleOf([
      paycheck({ date: '2026-07-11', budgetRemaining: 500 }),
      paycheck({
        date: '2026-07-31',
        budgetRemaining: 150,
        bills: [
          bill({ billId: 'auto', creditorName: 'Auto', amount: 120, billDate: '2026-07-31' }),
        ],
      }),
    ]);
    schedule.fullPaychecks = [];
    const report = proposeBreakGlassPlans(schedule);
    expect(report.plans).toHaveLength(1);
    expectAdvisorInvariants(report, schedule);
  });

  it('excludes unpayable bills from moves', () => {
    const report = proposeBreakGlassPlans(
      scheduleOf([
        paycheck({ date: '2026-07-03', budgetRemaining: 500 }),
        paycheck({
          date: '2026-07-17',
          budgetRemaining: 150,
          bills: [
            bill({
              billId: 'unpayable',
              creditorName: 'Unpayable',
              amount: 120,
              billDate: '2026-07-20',
              isUnpayable: true,
            }),
          ],
        }),
      ])
    );
    expect(report.plans).toEqual([]);
  });

  it('rebuildBreakGlassAdvisorForViewport keeps only in-viewport targets', () => {
    const advisor = {
      plans: [
        {
          id: 'a',
          targetPaycheckDate: '2026-07-31',
          headline: 'Clear Break-Glass on Jul 31',
          steps: [],
          maxDaysEarly: 15,
          clearsBreakGlass: true as const,
        },
        {
          id: 'b',
          targetPaycheckDate: '2026-08-14',
          headline: 'Clear Break-Glass on Aug 14',
          steps: [],
          maxDaysEarly: 10,
          clearsBreakGlass: true as const,
        },
      ],
    };
    const filtered = rebuildBreakGlassAdvisorForViewport(advisor, [
      paycheck({ date: '2026-07-31', budgetRemaining: 150 }),
    ]);
    expect(filtered?.plans).toHaveLength(1);
    expect(filtered?.plans[0].id).toBe('a');
  });

  it('does not propose a cascade that would create secondary Break-Glass', () => {
    // Jul 3 has only $10 above target — not enough to absorb the cascade without
    // dipping a healthy paycheck into the BG band.
    const report = proposeBreakGlassPlans(
      scheduleOf([
        paycheck({ date: '2026-07-03', budgetRemaining: 260, bills: [] }),
        paycheck({
          date: '2026-07-10',
          budgetRemaining: 250,
          bills: [bill({ billId: 'cell', creditorName: 'Cell', amount: 100, billDate: '2026-07-15' })],
        }),
        paycheck({
          date: '2026-07-17',
          budgetRemaining: 250,
          bills: [bill({ billId: 'web', creditorName: 'Web', amount: 100, billDate: '2026-07-22' })],
        }),
        paycheck({
          date: '2026-07-24',
          budgetRemaining: 150,
          bills: [bill({ billId: 'rent', creditorName: 'Rent', amount: 200, billDate: '2026-08-01' })],
        }),
      ])
    );

    expect(report.plans).toEqual([]);
  });

  it('reverse-trickles Aug-due bills onto a later paycheck when earlier cascade cannot clear', () => {
    // Mimics: schedule starts mid-July (no Jul 3 surplus), Jul 24 silo can't take
    // $800 Rent, but Aug 7 has spare for Aug-due Jeep — reverse trickle clears BG.
    const report = proposeBreakGlassPlans(
      scheduleOf(
        [
          paycheck({
            date: '2026-07-17',
            budgetRemaining: 250,
            bills: [
              bill({
                billId: 'crowded',
                creditorName: 'Crowded',
                amount: 100,
                billDate: '2026-07-20',
              }),
            ],
          }),
          paycheck({
            date: '2026-07-24',
            budgetRemaining: 250,
            bills: [
              bill({
                billId: 'full',
                creditorName: 'Full',
                amount: 100,
                billDate: '2026-07-28',
              }),
            ],
          }),
          paycheck({
            date: '2026-07-31',
            budgetRemaining: 105,
            bills: [
              bill({
                billId: 'rent',
                creditorName: 'Rent',
                amount: 800,
                billDate: '2026-08-01',
              }),
              bill({
                billId: 'jeep',
                creditorName: 'Car (Jeep)',
                amount: 425,
                billDate: '2026-08-10',
              }),
            ],
          }),
          paycheck({
            date: '2026-08-07',
            budgetRemaining: 900,
            bills: [],
          }),
        ],
        '2026-07-17'
      )
    );

    expect(report.plans).toHaveLength(1);
    expect(report.plans[0].targetPaycheckDate).toBe('2026-07-31');
    const jeep = report.plans[0].steps.find((step) => step.billId === 'jeep');
    expect(jeep).toMatchObject({
      fromPaycheckDate: '2026-07-31',
      toPaycheckDate: '2026-08-07',
    });
    expect(jeep!.daysEarly).toBe(3);
    expect(report.plans[0].steps.every((step) => step.toPaycheckDate <= step.billDueDate)).toBe(
      true
    );
  });

  it('keeps a mixed earlier-and-later landing fixture inside the advisor invariants', () => {
    const schedule = scheduleOf([
      paycheck({ date: '2026-07-03', budgetRemaining: 810, bills: [] }),
      paycheck({
        date: '2026-07-10',
        budgetRemaining: 315,
        bills: [bill({ billId: 'cell', creditorName: 'Cell', amount: 160, billDate: '2026-07-15' })],
      }),
      paycheck({
        date: '2026-07-17',
        budgetRemaining: 400,
        bills: [
          bill({ billId: 'electric', creditorName: 'Electric', amount: 200, billDate: '2026-07-22' }),
          bill({ billId: 'water', creditorName: 'Water', amount: 100, billDate: '2026-07-25' }),
        ],
      }),
      paycheck({
        date: '2026-07-24',
        budgetRemaining: 400,
        bills: [
          bill({
            billId: 'betty',
            creditorName: 'Life Insurance - Betty',
            amount: 100,
            billDate: '2026-08-02',
          }),
          bill({
            billId: 'navy',
            creditorName: 'CC: Navy Federal',
            amount: 175,
            billDate: '2026-08-03',
          }),
        ],
      }),
      paycheck({
        date: '2026-07-31',
        budgetRemaining: 105,
        bills: [
          bill({ billId: 'rent', creditorName: 'Rent', amount: 800, billDate: '2026-08-01' }),
          bill({
            billId: 'jeep',
            creditorName: 'Car (Jeep)',
            amount: 425,
            billDate: '2026-08-10',
          }),
          bill({ billId: 'avast', creditorName: 'Avast', amount: 820, billDate: '2026-08-09' }),
        ],
      }),
      paycheck({ date: '2026-08-07', budgetRemaining: 900, bills: [] }),
    ]);
    expectAdvisorInvariants(proposeBreakGlassPlans(schedule), schedule);
  });

  it('emits at most one step per occurrence on the July fixture', () => {
    const schedule = julyCascadeFixture();
    expectAdvisorInvariants(proposeBreakGlassPlans(schedule), schedule);
  });

  it('emits at most one step per occurrence when two bills share a Break-Glass paycheck', () => {
    const schedule = scheduleOf(
      [
        paycheck({ date: '2026-07-08', budgetRemaining: 200, bills: [] }),
        paycheck({ date: '2026-07-10', budgetRemaining: 200, bills: [] }),
        paycheck({
          date: '2026-07-17',
          budgetRemaining: 105,
          bills: [
            bill({ billId: 'cap-a', creditorName: 'Cap A', amount: 100, billDate: '2026-07-25' }),
            bill({ billId: 'extra', creditorName: 'Extra', amount: 80, billDate: '2026-07-25' }),
          ],
        }),
      ],
      '2026-07-08'
    );
    expectAdvisorInvariants(proposeBreakGlassPlans(schedule, { scheduleStartDate: '2026-07-08' }), schedule, '2026-07-08');
  });

  it('does not move a locked bill sitting on a non-Break-Glass intermediate', () => {
    // Intermediate Jul 10 is at target CoH (not BG), so soft-unlock does not apply.
    // Cascading rent onto Jul 10 requires moving the locked bill — plan must fail closed.
    // Rent is due Aug 1 so Jul 3 is 29 days early (past MAX_ADVISOR_EARLY_DAYS)
    // and cannot be used to skip the locked intermediate.
    const locked = proposeBreakGlassPlans(
      scheduleOf([
        paycheck({ date: '2026-07-03', budgetRemaining: 500, bills: [] }),
        paycheck({
          date: '2026-07-10',
          budgetRemaining: 250,
          bills: [bill({ billId: 'locked', creditorName: 'Locked', amount: 160, billDate: '2026-07-15' })],
        }),
        paycheck({ date: '2026-07-17', budgetRemaining: 250, bills: [] }),
        paycheck({
          date: '2026-07-24',
          budgetRemaining: 150,
          bills: [bill({ billId: 'rent', creditorName: 'Rent', amount: 160, billDate: '2026-08-01' })],
        }),
      ]),
      { lockedBillKeys: new Set(['locked-2026-07-15']) }
    );
    expect(locked.plans).toEqual([]);

    const unlockedSchedule = scheduleOf([
      paycheck({ date: '2026-07-03', budgetRemaining: 500, bills: [] }),
      paycheck({
        date: '2026-07-10',
        budgetRemaining: 250,
        bills: [bill({ billId: 'locked', creditorName: 'Locked', amount: 160, billDate: '2026-07-15' })],
      }),
      paycheck({ date: '2026-07-17', budgetRemaining: 250, bills: [] }),
      paycheck({
        date: '2026-07-24',
        budgetRemaining: 150,
        bills: [bill({ billId: 'rent', creditorName: 'Rent', amount: 160, billDate: '2026-08-01' })],
      }),
    ]);
    expectAdvisorInvariants(proposeBreakGlassPlans(unlockedSchedule), unlockedSchedule);
  });

  it('returns no plan when every landing would push a paycheck below min cash', () => {
    const report = proposeBreakGlassPlans(
      scheduleOf([
        paycheck({ date: '2026-07-03', budgetRemaining: 100, bills: [] }),
        paycheck({
          date: '2026-07-17',
          budgetRemaining: 150,
          bills: [bill({ billId: 'rent', creditorName: 'Rent', amount: 160, billDate: '2026-07-20' })],
        }),
      ])
    );
    expect(report.plans).toEqual([]);
  });

  it('returns no plan when reverse-trickle landing is blocked by locked bills', () => {
    const locked = proposeBreakGlassPlans(
      scheduleOf(
        [
          paycheck({
            date: '2026-07-31',
            budgetRemaining: 105,
            bills: [
              bill({ billId: 'jeep', creditorName: 'Jeep', amount: 200, billDate: '2026-08-10' }),
            ],
          }),
          paycheck({
            date: '2026-08-07',
            budgetRemaining: 150,
            bills: [bill({ billId: 'sil', creditorName: 'Silo', amount: 400, billDate: '2026-08-20' })],
          }),
        ],
        '2026-07-25'
      ),
      { lockedBillKeys: new Set(['sil-2026-08-20']) }
    );
    expect(locked.plans).toEqual([]);

    const unlocked = proposeBreakGlassPlans(
      scheduleOf(
        [
          paycheck({
            date: '2026-07-31',
            budgetRemaining: 105,
            bills: [
              bill({ billId: 'jeep', creditorName: 'Jeep', amount: 200, billDate: '2026-08-10' }),
            ],
          }),
          paycheck({
            date: '2026-08-07',
            budgetRemaining: 150,
            bills: [bill({ billId: 'sil', creditorName: 'Silo', amount: 400, billDate: '2026-08-20' })],
          }),
          paycheck({ date: '2026-08-14', budgetRemaining: 700, bills: [] }),
        ],
        '2026-07-25'
      )
    );
    expect(unlocked.plans).toHaveLength(1);
    expect(unlocked.plans[0].steps.some((step) => step.toPaycheckDate > '2026-07-31')).toBe(true);
  });

  it('emits at most one plan per original Break-Glass paycheck', () => {
    const report = proposeBreakGlassPlans(
      scheduleOf([
        paycheck({ date: '2026-07-03', budgetRemaining: 500, bills: [] }),
        paycheck({
          date: '2026-07-31',
          budgetRemaining: 150,
          bills: [bill({ billId: 'rent', creditorName: 'Rent', amount: 160, billDate: '2026-08-08' })],
        }),
        paycheck({
          date: '2026-09-04',
          budgetRemaining: 150,
          bills: [
            bill({ billId: 'a', creditorName: 'A', amount: 120, billDate: '2026-09-18' }),
          ],
        }),
        paycheck({
          date: '2026-09-18',
          budgetRemaining: 150,
          bills: [
            bill({ billId: 'b', creditorName: 'B', amount: 130, billDate: '2026-09-25' }),
          ],
        }),
        paycheck({ date: '2026-09-25', budgetRemaining: 500, bills: [] }),
      ])
    );

    const targets = report.plans.map((plan) => plan.targetPaycheckDate);
    expect(new Set(targets).size).toBe(targets.length);
  });

  it('relocates a locked bill off Break-Glass when a later landing clears it (Cap A case)', () => {
    // After accepting a Feb plan that locked Cap A onto Jan 29, Cap A must still
    // be movable off that BG paycheck back toward its due date (Feb 5).
    const locked = new Set(['cap-a-2027-02-17']);
    const report = proposeBreakGlassPlans(
      scheduleOf(
        [
          paycheck({ date: '2027-01-22', budgetRemaining: 250, bills: [] }),
          paycheck({
            date: '2027-01-29',
            budgetRemaining: 205,
            bills: [
              bill({
                billId: 'cap-a',
                creditorName: 'CC: Cap A',
                amount: 100,
                billDate: '2027-02-17',
              }),
              bill({
                billId: 'pets',
                creditorName: 'Pets',
                amount: 200,
                billDate: '2027-01-29',
                isIncomeAttached: true,
              }),
              bill({
                billId: 'grocery',
                creditorName: 'Grocery',
                amount: 300,
                billDate: '2027-01-29',
                isIncomeAttached: true,
              }),
            ],
          }),
          paycheck({ date: '2027-02-05', budgetRemaining: 350, bills: [] }),
        ],
        '2027-01-01'
      ),
      { lockedBillKeys: locked, targetCashOnHand: 250, minCashOnHand: 100 }
    );

    expect(report.plans).toHaveLength(1);
    expect(report.plans[0].id).toBe('break-glass-2027-01-29');
    expect(report.plans[0].steps).toEqual([
      expect.objectContaining({
        billId: 'cap-a',
        fromPaycheckDate: '2027-01-29',
        toPaycheckDate: '2027-02-05',
        daysEarly: 12,
      }),
    ]);
  });

  it('does not propose moves that put an at-target paycheck into Break-Glass', () => {
    const report = proposeBreakGlassPlans(
      scheduleOf(
        [
          paycheck({
            date: '2027-01-01',
            budgetRemaining: 200,
            targetCashOnHand: 200,
            minCashOnHand: 100,
            bills: [],
          }),
          paycheck({
            date: '2027-01-15',
            budgetRemaining: 200,
            targetCashOnHand: 200,
            minCashOnHand: 100,
            bills: [
              bill({ billId: 'cap-a', creditorName: 'CC: Cap A', amount: 100, billDate: '2027-01-17' }),
            ],
          }),
          paycheck({
            date: '2027-01-29',
            budgetRemaining: 105,
            targetCashOnHand: 200,
            minCashOnHand: 100,
            bills: [
              bill({ billId: 'apple', creditorName: 'CC: Apple', amount: 200, billDate: '2027-01-30' }),
            ],
          }),
        ],
        '2027-01-01'
      ),
      { targetCashOnHand: 200, minCashOnHand: 100 }
    );

    expect(report.plans).toEqual([]);
  });

  it('fail-fasts without DFS when deficit exceeds target movable mass', () => {
    const report = proposeBreakGlassPlans(
      scheduleOf([
        paycheck({ date: '2026-07-03', budgetRemaining: 500, bills: [] }),
        paycheck({
          date: '2026-07-17',
          budgetRemaining: 150,
          bills: [
            bill({
              billId: 'tiny',
              creditorName: 'Tiny',
              amount: 40,
              billDate: '2026-07-20',
            }),
            bill({
              billId: 'attached',
              creditorName: 'Attached',
              amount: 400,
              billDate: '2026-07-20',
              isIncomeAttached: true,
            }),
          ],
        }),
      ])
    );
    expect(report.plans).toEqual([]);
  });

  it('returns no plan for a dense unsolvable Break-Glass paycheck', () => {
    const crowdedBills = Array.from({ length: 8 }, (_, index) =>
      bill({
        billId: `b${index}`,
        creditorName: `Bill ${index}`,
        amount: 30,
        billDate: '2026-07-20',
      })
    );
    const report = proposeBreakGlassPlans(
      scheduleOf([
        paycheck({ date: '2026-07-03', budgetRemaining: 100, bills: [] }),
        paycheck({
          date: '2026-07-17',
          budgetRemaining: 150,
          bills: crowdedBills,
        }),
      ])
    );
    expect(report.plans).toEqual([]);
  });
});

describe('Break-Glass advisor invariants', () => {
  it('holds the invariants on a one-move clear and on the July fixture', () => {
    const solvable = scheduleOf([
      paycheck({ date: '2026-07-11', budgetRemaining: 500 }),
      paycheck({
        date: '2026-07-31',
        budgetRemaining: 150,
        bills: [
          bill({ billId: 'auto', creditorName: 'Auto', amount: 120, billDate: '2026-07-31' }),
        ],
      }),
    ]);
    const solved = proposeBreakGlassPlans(solvable);
    expect(solved.plans.length).toBeGreaterThan(0);
    expectAdvisorInvariants(solved, solvable);

    const july = julyCascadeFixture();
    expectAdvisorInvariants(proposeBreakGlassPlans(july), july);
  });

  it('prefers a landing inside 20 days over a farther one when dollar-days tie', () => {
    const schedule = scheduleOf([
      paycheck({ date: '2026-07-10', budgetRemaining: 500 }),
      paycheck({ date: '2026-07-17', budgetRemaining: 500 }),
      paycheck({
        date: '2026-07-31',
        budgetRemaining: 249.6,
        bills: [
          bill({ billId: 'tiny', creditorName: 'Tiny', amount: 0.4, billDate: '2026-07-31' }),
        ],
      }),
    ]);
    const report = proposeBreakGlassPlans(schedule);
    expect(report.plans).toHaveLength(1);
    expect(report.plans[0].steps[0]).toMatchObject({
      toPaycheckDate: '2026-07-17',
      daysEarly: 14,
      requiresConfirmation: false,
    });
    expectAdvisorInvariants(report, schedule);
  });

  it('uses the provided solver and drops a non-optimal result', () => {
    const schedule = scheduleOf([
      paycheck({ date: '2026-07-11', budgetRemaining: 500 }),
      paycheck({
        date: '2026-07-31',
        budgetRemaining: 150,
        bills: [
          bill({ billId: 'auto', creditorName: 'Auto', amount: 120, billDate: '2026-07-31' }),
        ],
      }),
    ]);
    let sawBaseline = false;
    const solver: AssignmentSolver = {
      name: 'greedy',
      solve: (model) => {
        sawBaseline = model.advisorBaseline !== undefined;
        return new GreedySolver().solve(model);
      },
    };
    const solved = proposeBreakGlassPlans(schedule, { solver });
    expect(sawBaseline).toBe(true);
    expect(solved.plans).toHaveLength(1);

    const rejected: AssignmentSolver = {
      name: 'greedy',
      solve: () => ({
        placement: new Int32Array(),
        workCount: 1,
        solver: 'greedy',
        optimal: false,
        fallbackReason: 'limit_hit',
      }),
    };
    expect(proposeBreakGlassPlans(schedule, { solver: rejected }).plans).toEqual([]);
  });

  it('drops a component that needs more than 12 steps', () => {
    const bills = Array.from({ length: 13 }, (_, index) =>
      bill({
        billId: `b${String(index).padStart(2, '0')}`,
        creditorName: `Bill ${index}`,
        amount: 10,
        billDate: '2026-07-20',
      })
    );
    const schedule = scheduleOf([
      paycheck({ date: '2026-07-03', budgetRemaining: 500, bills: [] }),
      paycheck({ date: '2026-07-17', budgetRemaining: 150, bills }),
    ]);
    const solver: AssignmentSolver = {
      name: 'greedy',
      solve: (model) => {
        const placement = Int32Array.from(model.advisorBaseline?.placement ?? []);
        placement.fill(0);
        return { placement, workCount: placement.length, solver: 'greedy', optimal: true };
      },
    };
    const options: ProposeBreakGlassOptions = { solver };
    expect(proposeBreakGlassPlans(schedule, options).plans).toEqual([]);
  });

  it('excludes income-attached, skipped, and unpayable bills from moves', () => {
    const report = proposeBreakGlassPlans(
      scheduleOf([
        paycheck({ date: '2026-07-03', budgetRemaining: 500, bills: [] }),
        paycheck({
          date: '2026-07-17',
          budgetRemaining: 150,
          bills: [
            bill({
              billId: 'attached',
              creditorName: 'Attached',
              amount: 120,
              billDate: '2026-07-20',
              isIncomeAttached: true,
            }),
            bill({
              billId: 'skipped',
              creditorName: 'Skipped',
              amount: 120,
              billDate: '2026-07-20',
              isSkipped: true,
            }),
            bill({
              billId: 'unpayable',
              creditorName: 'Unpayable',
              amount: 120,
              billDate: '2026-07-20',
              isUnpayable: true,
            }),
            bill({
              billId: 'rent',
              creditorName: 'Rent',
              amount: 120,
              billDate: '2026-07-20',
            }),
          ],
        }),
      ])
    );
    const moved = report.plans.flatMap((plan) => plan.steps.map((step) => step.billId));
    expect(moved).not.toContain('attached');
    expect(moved).not.toContain('skipped');
    expect(moved).not.toContain('unpayable');
  });
});
