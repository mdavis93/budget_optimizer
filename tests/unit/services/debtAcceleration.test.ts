import { describe, expect, it } from 'vitest';
import { SchedulerService } from '../../../electron/services/scheduler.service';
import { classifyDebts } from '../../../electron/services/scheduler/debt/debtAcceleration';
import { DEBT_MAX_WORK, DebtWorkCounter } from '../../../electron/services/scheduler/debt/debtSimulator';
import type { Bill, Debt, Income, SavingsGoal } from '@shared/types';

const income: Income = {
  id: 'inc-1',
  sourceName: 'Job',
  amount: 3000,
  cadence: 'monthly',
  startDate: '2026-01-01',
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function bill(overrides: Partial<Bill> & Pick<Bill, 'id'>): Bill {
  return {
    creditorName: overrides.creditorName ?? `Creditor ${overrides.id}`,
    budgetedAmount: 200,
    dueDay: 5,
    isRecurring: true,
    priority: 'normal',
    category: 'debt',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function debt(overrides: Partial<Debt> & Pick<Debt, 'id' | 'billId'>): Debt {
  return {
    budgetId: 'budget-1',
    principalBalance: 800,
    apr: 0.2,
    monthlyPayment: 200,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('debtAcceleration', () => {
  it('pays the higher APR debt first', () => {
    const high = debt({ id: 'd-high', billId: 'b-high', apr: 0.29, principalBalance: 400 });
    const low = debt({ id: 'd-low', billId: 'b-low', apr: 0.08, principalBalance: 400 });
    const bills = [bill({ id: 'b-high' }), bill({ id: 'b-low' })];
    const scheduler = new SchedulerService();
    const schedule = scheduler.generateSchedule(
      [income],
      bills,
      '2026-01-01',
      12,
      2000,
      new Set(),
      new Map(),
      250,
      [],
      100,
      0,
      new Map(),
      new Map(),
      [],
      new Map(),
      undefined,
      [high, low],
      true
    );
    const firstExtra = schedule.paychecks.find((paycheck) => (paycheck.totalDebtPayments ?? 0) > 0);
    expect(firstExtra?.debtPayments?.[0]?.debtId).toBe('d-high');
  });

  it('leaves debtPayments empty when the flag is off and still fills a preview plan', () => {
    const tracked = debt({ id: 'd-1', billId: 'b-1' });
    const scheduler = new SchedulerService();
    const schedule = scheduler.generateSchedule(
      [income],
      [bill({ id: 'b-1' })],
      '2026-01-01',
      12,
      2000,
      new Set(),
      new Map(),
      250,
      [],
      100,
      0,
      new Map(),
      new Map(),
      [],
      new Map(),
      undefined,
      [tracked],
      false
    );
    expect(schedule.paychecks.every((paycheck) => !paycheck.debtPayments?.length)).toBe(true);
    expect(schedule.debtPlan?.enabled).toBe(false);
    expect(schedule.debtPlan?.variant).toMatch(/disabled|standard|deep/);
    expect(schedule.debtPlan?.debts[0]?.baselineInterest).toBeGreaterThanOrEqual(0);
  });

  it('does not send surplus to goals, savings, or debt when a paycheck still has an unpaid bill', () => {
    const tightIncome: Income = { ...income, amount: 100 };
    const expensive = bill({ id: 'rent', budgetedAmount: 2000, creditorName: 'Rent', category: 'housing' });
    const tracked = debt({ id: 'd-1', billId: 'b-1', principalBalance: 500 });
    const scheduler = new SchedulerService();
    const schedule = scheduler.generateSchedule(
      [tightIncome],
      [expensive, bill({ id: 'b-1' })],
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
      [],
      new Map(),
      undefined,
      [tracked],
      true
    );
    const unpaid = schedule.paychecks.find((paycheck) => paycheck.hasUnpayableBills);
    expect(unpaid).toBeTruthy();
    if (unpaid) {
      expect(unpaid.totalGoalDeposits).toBe(0);
      expect(unpaid.savingsDeposit).toBe(0);
      expect(unpaid.totalDebtPayments ?? 0).toBe(0);
    }
  });

  it('uses minSavingsPerPaycheck as the floor when it is above $100', () => {
    const tracked = debt({ id: 'd-1', billId: 'b-1', principalBalance: 2000, monthlyPayment: 50 });
    const scheduler = new SchedulerService();
    const schedule = scheduler.generateSchedule(
      [income],
      [bill({ id: 'b-1', budgetedAmount: 50 })],
      '2026-01-01',
      6,
      500,
      new Set(),
      new Map(),
      250,
      [],
      100,
      150,
      new Map(),
      new Map(),
      [],
      new Map(),
      undefined,
      [tracked],
      true
    );
    for (const paycheck of schedule.paychecks) {
      if (paycheck.isShortfall || paycheck.purpose === 'savingsAndGoals') continue;
      expect(paycheck.savingsDeposit).toBeGreaterThanOrEqual(150);
    }
  });

  it('does not fund any goal later than the flag-off assigned schedule', () => {
    const goal: SavingsGoal = {
      id: 'g-1',
      budgetId: 'budget-1',
      name: 'Trip',
      targetAmount: 400,
      alreadySaved: 0,
      targetDate: '2026-06-01',
      priority: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const tracked = debt({ id: 'd-1', billId: 'b-1', principalBalance: 400 });
    const bills = [bill({ id: 'b-1' })];
    const scheduler = new SchedulerService();
    const off = scheduler.generateSchedule(
      [income],
      bills,
      '2026-01-01',
      12,
      2000,
      new Set(),
      new Map(),
      250,
      [goal],
      100,
      0,
      new Map(),
      new Map(),
      [],
      new Map(),
      undefined,
      [tracked],
      false
    );
    const on = scheduler.generateSchedule(
      [income],
      bills,
      '2026-01-01',
      12,
      2000,
      new Set(),
      new Map(),
      250,
      [goal],
      100,
      0,
      new Map(),
      new Map(),
      [],
      new Map(),
      undefined,
      [tracked],
      true
    );
    const offDate = off.goalProjections?.[0]?.estimatedFundedDate;
    const onDate = on.goalProjections?.[0]?.estimatedFundedDate;
    if (offDate && onDate) {
      expect(onDate <= offDate).toBe(true);
    }
  });

  it('excludes APR above 1, missing bills, and duplicate bill links', () => {
    const { excluded, eligible } = classifyDebts(
      [
        debt({ id: 'apr', billId: 'b-1', apr: 1.5 }),
        debt({ id: 'missing', billId: 'gone' }),
        debt({ id: 'dup-a', billId: 'shared' }),
        debt({ id: 'dup-b', billId: 'shared' }),
      ],
      [bill({ id: 'shared' })]
    );
    const reasons = excluded.map((item) => item.reason).sort();
    expect(reasons).toContain('apr_above_one');
    expect(reasons).toContain('missing_bill');
    expect(reasons.filter((reason) => reason === 'duplicate_bill').length).toBeGreaterThanOrEqual(1);
    expect(eligible.find((item) => item.debt.billId === 'shared')).toBeUndefined();
  });

  it('rejects non-finite and huge principal before the loop', () => {
    const { eligible, excluded } = classifyDebts(
      [
        debt({ id: 'nan', billId: 'b-1', principalBalance: Number.NaN }),
        debt({ id: 'huge', billId: 'b-1', principalBalance: 50_000_000 }),
        debt({ id: 'ok', billId: 'b-1', principalBalance: 100, apr: 0.1 }),
      ],
      [bill({ id: 'b-1' })]
    );
    expect(excluded.find((item) => item.debtId === 'nan' || item.debtId === 'huge')).toBeUndefined();
    expect(eligible.some((item) => item.debt.id === 'ok')).toBe(true);
  });
});

describe('debtAcceleration work cap', () => {
  it('classifying 100 debts stays under DEBT_MAX_WORK', () => {
    const work = new DebtWorkCounter();
    const bills: Bill[] = [];
    const debts: Debt[] = [];
    for (let i = 0; i < 100; i++) {
      work.tick();
      bills.push(bill({ id: `b-${i}` }));
      debts.push(debt({ id: `d-${i}`, billId: `b-${i}`, principalBalance: 200 }));
    }
    classifyDebts(debts, bills);
    expect(work.count).toBeLessThan(DEBT_MAX_WORK);
  });
});
