import { describe, expect, it } from 'vitest';
import { proposeBreakGlassPlans } from '../../../electron/services/scheduler/breakGlassAdvisor';
import { rebuildBreakGlassAdvisorForViewport } from '../../../shared/scheduleViewportSlice';
import type { PaycheckBill, PaycheckEntry, ScheduleData } from '@shared/types';

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

/** Jul 3 surplus → intermediates at target → Jul 31 Break-Glass cleared via cascade. */
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
  it('proposes a Jul-style backward cascade including a >14-day step', () => {
    const report = proposeBreakGlassPlans(julyCascadeFixture());
    expect(report.plans).toHaveLength(1);
    expect(report.plans[0].id).toBe('break-glass-2026-07-31');

    const plan = report.plans[0];
    expect(plan.targetPaycheckDate).toBe('2026-07-31');
    expect(plan.headline).toBe('Clear Break-Glass on Jul 31, 2026');
    expect(plan.clearsBreakGlass).toBe(true);
    expect(plan.steps.length).toBeGreaterThanOrEqual(4);

    const byBill = Object.fromEntries(plan.steps.map((step) => [step.billId, step]));
    expect(byBill.cell).toMatchObject({
      fromPaycheckDate: '2026-07-10',
      toPaycheckDate: '2026-07-03',
      daysEarly: 12,
      requiresConfirmation: false,
    });
    expect(byBill.web).toMatchObject({
      fromPaycheckDate: '2026-07-17',
      toPaycheckDate: '2026-07-10',
      daysEarly: 12,
      requiresConfirmation: false,
    });
    expect(byBill.power).toMatchObject({
      fromPaycheckDate: '2026-07-24',
      toPaycheckDate: '2026-07-17',
      daysEarly: 12,
      requiresConfirmation: false,
    });
    expect(byBill.rent).toMatchObject({
      fromPaycheckDate: '2026-07-31',
      toPaycheckDate: '2026-07-24',
      daysEarly: 15,
      requiresConfirmation: true,
    });
    expect(plan.maxDaysEarly).toBe(15);
    expect(plan.steps.every((step) => step.toPaycheckDate <= step.billDueDate)).toBe(true);
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

  it('caps early moves at 21 days and proposes nothing if only a later landing would work past the cap', () => {
    const report = proposeBreakGlassPlans(
      scheduleOf([
        paycheck({ date: '2026-07-03', budgetRemaining: 500 }),
        paycheck({
          date: '2026-07-31',
          budgetRemaining: 150,
          bills: [
            bill({
              billId: 'far',
              creditorName: 'Too Early',
              amount: 120,
              // Only Jul 3 is before due; Jul 31→Jul 3 is 28 days early (>21).
              billDate: '2026-07-31',
            }),
          ],
        }),
      ]),
      { maxEarlyDays: 21 }
    );
    expect(report.plans).toEqual([]);
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
        paycheck({ date: '2026-07-17', budgetRemaining: 250 }),
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
    expect(report.plans[0].maxDaysEarly).toBeLessThanOrEqual(21);
    expect(report.plans[0].steps.every((step) => step.daysEarly <= 21)).toBe(true);
  });

  it('returns empty plans for an empty paycheck list', () => {
    const empty = scheduleOf([]);
    empty.fullPaychecks = [];
    empty.paychecks = [];
    expect(proposeBreakGlassPlans(empty).plans).toEqual([]);
  });

  it('uses paychecks when fullPaychecks is empty', () => {
    const withViewportOnly = julyCascadeFixture();
    withViewportOnly.fullPaychecks = [];
    const report = proposeBreakGlassPlans(withViewportOnly);
    expect(report.plans).toHaveLength(1);
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

  it('does not emit separate plans for cascade-induced secondary Break-Glass', () => {
    // Only Jul 24 starts as BG (Jul 10 sits at target). Clearing Jul 24 lands a
    // cascade bill onto Jul 10 and dips it into the BG band — without the original-date
    // filter that date would steal a second advisor card.
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

    expect(report.plans).toHaveLength(1);
    expect(report.plans[0].targetPaycheckDate).toBe('2026-07-24');
    expect(report.plans[0].steps.some((step) => step.toPaycheckDate === '2026-07-10')).toBe(true);
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

  it('prefers an earlier-month cascade over reverse-trickle when both clear Break-Glass', () => {
    // Both paths work: Rent can cascade earlier (like the manual Jul solution), or Jeep
    // can reverse-trickle to Aug 7. Scoring must prefer the earlier-month path.
    const report = proposeBreakGlassPlans(
      scheduleOf([
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
      ])
    );

    expect(report.plans).toHaveLength(1);
    const plan = report.plans[0];
    expect(plan.targetPaycheckDate).toBe('2026-07-31');
    // Prefer no landings after the Break-Glass paycheck when an earlier path exists.
    expect(plan.steps.some((step) => step.toPaycheckDate > '2026-07-31')).toBe(false);
  });

  it('emits at most one advisor step per bill occurrence (coalesces multi-hop cascades)', () => {
    const report = proposeBreakGlassPlans(julyCascadeFixture());
    expect(report.plans.length).toBeGreaterThanOrEqual(1);
    for (const plan of report.plans) {
      const keys = plan.steps.map((step) => `${step.billId}-${step.billDueDate}`);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('coalesces same-occurrence hops into one net from/to move', () => {
    // Cap A lands on Jul 10 first; freeing room for Extra then hops Cap A Jul 10→Jul 8.
    // Coalesce must emit Cap A as Jul 17→Jul 8 (original from + final to), not two steps.
    const report = proposeBreakGlassPlans(
      scheduleOf(
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
      )
    );

    expect(report.plans).toHaveLength(1);
    const capSteps = report.plans[0].steps.filter((step) => step.billId === 'cap-a');
    expect(capSteps).toHaveLength(1);
    expect(capSteps[0]).toMatchObject({
      fromPaycheckDate: '2026-07-17',
      toPaycheckDate: '2026-07-08',
      daysEarly: 17,
      requiresConfirmation: true,
    });
    expect(report.plans[0].steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          billId: 'extra',
          fromPaycheckDate: '2026-07-17',
          toPaycheckDate: '2026-07-10',
        }),
      ])
    );
  });

  it('does not move a locked bill sitting on a non-Break-Glass intermediate', () => {
    // Intermediate Jul 10 is at target CoH (not BG), so soft-unlock does not apply.
    // Cascading rent onto Jul 10 requires moving the locked bill — plan must fail closed.
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
          bills: [bill({ billId: 'rent', creditorName: 'Rent', amount: 160, billDate: '2026-07-28' })],
        }),
      ]),
      { lockedBillKeys: new Set(['locked-2026-07-15']) }
    );
    expect(locked.plans).toEqual([]);

    const unlocked = proposeBreakGlassPlans(
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
          bills: [bill({ billId: 'rent', creditorName: 'Rent', amount: 160, billDate: '2026-07-28' })],
        }),
      ])
    );
    expect(unlocked.plans).toHaveLength(1);
    expect(unlocked.plans[0].steps.some((step) => step.billId === 'locked')).toBe(true);
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
          paycheck({ date: '2026-08-14', budgetRemaining: 500, bills: [] }),
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
          paycheck({ date: '2027-02-05', budgetRemaining: 250, bills: [] }),
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
});
