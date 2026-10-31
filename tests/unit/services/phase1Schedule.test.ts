import { describe, expect, it } from 'vitest';
import { presumedPaidRecommendation } from '@shared/schedulePresentation';
import { SchedulerService } from '../../../electron/services/scheduler.service';
import type { Bill, Income, Leave } from '../../../electron/services/database.service';

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
});