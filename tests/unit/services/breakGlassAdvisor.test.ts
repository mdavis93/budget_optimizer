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

    const plan = report.plans[0];
    expect(plan.targetPaycheckDate).toBe('2026-07-31');
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

  it('treats locked manuals as fixed sources', () => {
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
    expect(report.plans).toEqual([]);
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
});
