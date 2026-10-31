import { describe, expect, it } from 'vitest';
import { presumedPaidRecommendation } from '@shared/schedulePresentation';
import { SchedulerService } from '../../../electron/services/scheduler.service';
import { analyzeAndProposeFixes } from '../../../electron/services/scheduler/reconciliation';
import { getAssignmentViolation } from '../../../src/utils/assignmentConstraints';
import type { Bill, Income, Leave } from '../../../electron/services/database.service';
import type { PaycheckEntry, ScheduleData } from '@shared/types';

const scheduler = new SchedulerService();
const stamp = '2026-01-01T00:00:00.000Z';

function income(overrides: Partial<Income> & Pick<Income, 'id' | 'startDate' | 'cadence'>): Income {
  return {
    sourceName: 'Pay',
    amount: 3000,
    isActive: true,
    createdAt: stamp,
    updatedAt: stamp,
    ...overrides,
  };
}

function bill(overrides: Partial<Bill> & Pick<Bill, 'id' | 'dueDay'>): Bill {
  return {
    creditorName: 'Rent',
    budgetedAmount: 400,
    isRecurring: true,
    priority: 'critical',
    createdAt: stamp,
    updatedAt: stamp,
    ...overrides,
  };
}

describe('Phase 1 schedule rules', () => {
  it('presumes a bill due before the first paycheck is already paid', () => {
    const schedule = scheduler.generateSchedule(
      [income({ id: 'job', cadence: 'monthly', startDate: '2026-01-15' })],
      [bill({ id: 'rent', dueDay: 5, creditorName: 'Rent' })],
      '2026-01-01',
      2,
      0
    );

    const placed = schedule.paychecks.flatMap((paycheck) => paycheck.bills);
    expect(placed.some((item) => item.billDate === '2026-01-05')).toBe(false);
    expect(placed.some((item) => item.billDate === '2026-02-05' && !item.isUnpayable)).toBe(true);
    const note = presumedPaidRecommendation(1);
    expect(schedule.recommendations).toContain(note);
  });

  it('leaves a bill unpayable across a leave gap longer than 31 days', () => {
    const pay = income({ id: 'job', cadence: 'biweekly', startDate: '2026-01-02', amount: 2000 });
    const leave: Leave = {
      id: 'leave-1',
      budgetId: 'budget-1',
      incomeId: 'job',
      name: 'Leave',
      type: 'unpaid',
      startDate: '2026-01-16',
      endDate: '2026-02-13',
      createdAt: stamp,
      updatedAt: stamp,
    };
    const schedule = scheduler.generateSchedule(
      [pay],
      [bill({ id: 'rent', dueDay: 20, creditorName: 'Rent' })],
      '2026-01-01',
      3,
      0,
      new Set(),
      new Map(),
      250,
      [],
      100,
      0,
      new Map(),
      new Map(),
      [leave]
    );

    const feb20 = schedule.paychecks.flatMap((paycheck) =>
      paycheck.bills.filter((item) => item.billDate === '2026-02-20').map((item) => ({
        date: paycheck.date,
        item,
      }))
    );
    expect(feb20).toEqual([
      expect.objectContaining({
        date: '2026-01-02',
        item: expect.objectContaining({
          isUnpayable: true,
          unfundableReason: 'no_eligible_paycheck_in_window',
        }),
      }),
    ]);
  });

  it('never funds a preferred-source bill from another income', () => {
    const schedule = scheduler.generateSchedule(
      [
        income({ id: 'job', cadence: 'monthly', startDate: '2026-01-01', amount: 3000 }),
        income({ id: 'side', cadence: 'monthly', startDate: '2026-01-20', amount: 1000, sourceName: 'Side' }),
      ],
      [bill({
        id: 'rent',
        dueDay: 25,
        creditorName: 'Rent',
        preferredIncomeSourceId: 'job',
      })],
      '2026-01-01',
      2,
      0
    );

    const january = schedule.paychecks.filter((paycheck) => paycheck.date.startsWith('2026-01'));
    const fundedOn = january
      .filter((paycheck) => paycheck.bills.some((item) => item.billId === 'rent' && !item.isUnpayable))
      .map((paycheck) => paycheck.date);
    expect(fundedOn).toEqual(['2026-01-01']);
  });

  it('does not spend a reserved-only horizon on bills', () => {
    const schedule = scheduler.generateSchedule(
      [income({
        id: 'reserve',
        cadence: 'monthly',
        startDate: '2026-01-01',
        purpose: 'savingsAndGoals',
      })],
      [bill({ id: 'rent', dueDay: 15, creditorName: 'Rent' })],
      '2026-01-01',
      2,
      500
    );

    expect(schedule.paychecks.every((paycheck) => paycheck.purpose === 'savingsAndGoals')).toBe(true);
    expect(schedule.paychecks.every((paycheck) => paycheck.bills.length === 0)).toBe(true);
    expect(schedule.summary.totalExpenses).toBe(0);
  });

  it('keeps a savings-only paycheck from blocking the 31-day operating fallback', () => {
    const schedule = scheduler.generateSchedule(
      [
        income({ id: 'job', cadence: 'monthly', startDate: '2026-01-01', amount: 3000 }),
        income({
          id: 'reserve',
          cadence: 'monthly',
          startDate: '2026-01-20',
          amount: 500,
          purpose: 'savingsAndGoals',
          sourceName: 'Reserve',
        }),
      ],
      [bill({ id: 'rent', dueDay: 25, creditorName: 'Rent', isRecurring: false })],
      '2026-01-01',
      2,
      0
    );

    const fundedOn = schedule.paychecks
      .filter((paycheck) => paycheck.bills.some((item) => item.billId === 'rent' && !item.isUnpayable))
      .map((paycheck) => paycheck.date);
    expect(fundedOn).toEqual(['2026-01-01']);

    const operatingDates = schedule.paychecks
      .filter((paycheck) => paycheck.purpose !== 'savingsAndGoals')
      .map((paycheck) => ({
        date: paycheck.date,
        incomeSourceIds: paycheck.incomeSources.map((source) => source.id),
      }));
    expect(getAssignmentViolation('2026-01-25', '2026-01-01', operatingDates)).toBeNull();
    expect(getAssignmentViolation('2026-01-25', '2026-01-20', operatingDates)).toBe('too_early');

    const shortfallSchedule = {
      ...schedule,
      paychecks: [
        {
          id: 'op:2026-01-01',
          purpose: 'operating' as const,
          date: '2026-01-01',
          incomeSources: [{ id: 'job', name: 'Pay', amount: 3000 }],
          totalIncome: 3000,
          bills: [],
          totalBills: 0,
          goalDeposits: [],
          totalGoalDeposits: 0,
          savingsDeposit: 0,
          totalSavings: 0,
          budgetRemaining: 800,
          isShortfall: false,
          targetCashOnHand: 250,
          minCashOnHand: 100,
        },
        {
          id: 'sg:2026-01-20',
          purpose: 'savingsAndGoals' as const,
          date: '2026-01-20',
          incomeSources: [{ id: 'reserve', name: 'Reserve', amount: 500 }],
          totalIncome: 500,
          bills: [],
          totalBills: 0,
          goalDeposits: [],
          totalGoalDeposits: 0,
          savingsDeposit: 0,
          totalSavings: 0,
          budgetRemaining: 500,
          isShortfall: false,
          targetCashOnHand: 250,
          minCashOnHand: 100,
        },
        {
          id: 'op:2026-02-15',
          purpose: 'operating' as const,
          date: '2026-02-15',
          incomeSources: [{ id: 'job', name: 'Pay', amount: 200 }],
          totalIncome: 200,
          bills: [{
            billId: 'rent',
            creditorName: 'Rent',
            amount: 400,
            dueDay: 25,
            priority: 'critical' as const,
            billDate: '2026-01-25',
          }],
          totalBills: 400,
          goalDeposits: [],
          totalGoalDeposits: 0,
          savingsDeposit: 0,
          totalSavings: 0,
          budgetRemaining: 50,
          isShortfall: true,
          targetCashOnHand: 250,
          minCashOnHand: 100,
        },
      ] satisfies PaycheckEntry[],
      minCashOnHand: 100,
      maxBudgetRemaining: 250,
    } as ScheduleData;
    const report = analyzeAndProposeFixes(shortfallSchedule);
    expect(report.proposedFixes.some((fix) => fix.toPaycheckDate === '2026-01-20')).toBe(false);
    expect(report.proposedFixes.some((fix) => fix.toPaycheckDate === '2026-01-01')).toBe(true);
  });

  it('keeps a non-preferred operating paycheck from blocking the preferred 31-day fallback', () => {
    const schedule = scheduler.generateSchedule(
      [
        income({ id: 'job', cadence: 'monthly', startDate: '2026-01-01', amount: 3000 }),
        income({ id: 'side', cadence: 'monthly', startDate: '2026-01-20', amount: 1000, sourceName: 'Side' }),
      ],
      [bill({
        id: 'rent',
        dueDay: 25,
        creditorName: 'Rent',
        preferredIncomeSourceId: 'job',
        isRecurring: false,
      })],
      '2026-01-01',
      2,
      0
    );

    const fundedOn = schedule.paychecks
      .filter((paycheck) => paycheck.bills.some((item) => item.billId === 'rent' && !item.isUnpayable))
      .map((paycheck) => paycheck.date);
    expect(fundedOn).toEqual(['2026-01-01']);

    const operatingDates = schedule.paychecks
      .filter((paycheck) => paycheck.purpose !== 'savingsAndGoals')
      .map((paycheck) => ({
        date: paycheck.date,
        incomeSourceIds: paycheck.incomeSources.map((source) => source.id),
      }));
    expect(getAssignmentViolation('2026-01-25', '2026-01-01', operatingDates, 'job')).toBeNull();
    expect(getAssignmentViolation('2026-01-25', '2026-01-20', operatingDates, 'job')).toBe('too_early');

    const shortfallSchedule = {
      ...schedule,
      paychecks: [
        {
          id: 'op:2026-01-01',
          purpose: 'operating' as const,
          date: '2026-01-01',
          incomeSources: [{ id: 'job', name: 'Pay', amount: 3000 }],
          totalIncome: 3000,
          bills: [],
          totalBills: 0,
          goalDeposits: [],
          totalGoalDeposits: 0,
          savingsDeposit: 0,
          totalSavings: 0,
          budgetRemaining: 800,
          isShortfall: false,
          targetCashOnHand: 250,
          minCashOnHand: 100,
        },
        {
          id: 'op:2026-01-20',
          purpose: 'operating' as const,
          date: '2026-01-20',
          incomeSources: [{ id: 'side', name: 'Side', amount: 1000 }],
          totalIncome: 1000,
          bills: [],
          totalBills: 0,
          goalDeposits: [],
          totalGoalDeposits: 0,
          savingsDeposit: 0,
          totalSavings: 0,
          budgetRemaining: 800,
          isShortfall: false,
          targetCashOnHand: 250,
          minCashOnHand: 100,
        },
        {
          id: 'op:2026-02-15',
          purpose: 'operating' as const,
          date: '2026-02-15',
          incomeSources: [{ id: 'side', name: 'Side', amount: 200 }],
          totalIncome: 200,
          bills: [{
            billId: 'rent',
            creditorName: 'Rent',
            amount: 400,
            dueDay: 25,
            priority: 'critical' as const,
            billDate: '2026-01-25',
            preferredIncomeSourceId: 'job',
          }],
          totalBills: 400,
          goalDeposits: [],
          totalGoalDeposits: 0,
          savingsDeposit: 0,
          totalSavings: 0,
          budgetRemaining: 50,
          isShortfall: true,
          targetCashOnHand: 250,
          minCashOnHand: 100,
        },
      ] satisfies PaycheckEntry[],
      minCashOnHand: 100,
      maxBudgetRemaining: 250,
    } as ScheduleData;
    const report = analyzeAndProposeFixes(shortfallSchedule);
    expect(report.proposedFixes.some((fix) => fix.toPaycheckDate === '2026-01-20')).toBe(false);
    expect(report.proposedFixes.some((fix) => fix.toPaycheckDate === '2026-01-01')).toBe(true);
  });

  it('attaches an in-horizon bill to a restored $0 first-cycle paycheck during leading leave', () => {
    const pay = income({ id: 'job', cadence: 'biweekly', startDate: '2026-01-02', amount: 2000 });
    const leave: Leave = {
      id: 'leave-1',
      budgetId: 'budget-1',
      incomeId: 'job',
      name: 'Leave',
      type: 'unpaid',
      startDate: '2026-01-01',
      endDate: '2026-02-13',
      createdAt: stamp,
      updatedAt: stamp,
    };
    const schedule = scheduler.generateSchedule(
      [pay],
      [bill({ id: 'rent', dueDay: 20, creditorName: 'Rent', isRecurring: false })],
      '2026-01-01',
      3,
      500,
      new Set(),
      new Map(),
      250,
      [],
      100,
      0,
      new Map(),
      new Map(),
      [leave]
    );

    const dates = schedule.paychecks.map((paycheck) => paycheck.date);
    expect(dates).not.toContain('2026-01-02');
    expect(dates).not.toContain('2026-01-30');
    expect(dates).not.toContain('2026-02-13');

    const jan16 = schedule.paychecks.find((paycheck) => paycheck.date === '2026-01-16');
    expect(jan16).toMatchObject({
      totalIncome: 0,
      hasUnpayableBills: true,
      isShortfall: true,
    });
    expect(jan16?.budgetRemaining).toBe(-400);
    expect(jan16?.bills).toEqual([
      expect.objectContaining({
        billDate: '2026-01-20',
        isUnpayable: true,
        unfundableReason: 'no_eligible_paycheck_in_window',
      }),
    ]);
    expect(schedule.presumedPaidCount ?? 0).toBe(0);

    const feb27 = schedule.paychecks.find((paycheck) => paycheck.date === '2026-02-27');
    expect(feb27).toBeDefined();
    expect(feb27?.bills.some((item) => item.billDate === '2026-01-20')).toBe(false);
    expect(feb27?.totalIncome).toBe(2000);
  });
});