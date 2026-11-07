import { describe, expect, it } from 'vitest';
import { SchedulerService } from '../../../electron/services/scheduler.service';
import { classifyDebts, runDebtAcceleration } from '../../../electron/services/scheduler/debt/debtAcceleration';
import { DEBT_MAX_WORK, DebtWorkCounter } from '../../../electron/services/scheduler/debt/debtSimulator';
import type { PaycheckAssignment, ProjectedBill } from '../../../electron/services/scheduler/types';
import { billOccurrenceKey } from '../../../electron/services/scheduler/types';
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

function onDate(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}

function projectedBill(
  partial: Partial<ProjectedBill> & Pick<ProjectedBill, 'billId' | 'amount' | 'date'>
): ProjectedBill {
  return {
    creditorName: partial.creditorName ?? partial.billId,
    dueDay: partial.dueDay ?? partial.date.getDate(),
    priority: partial.priority ?? 'normal',
    ...partial,
  };
}

function paycheck(iso: string, amount: number, bills: ProjectedBill[]): PaycheckAssignment {
  return {
    date: onDate(iso),
    incomes: [{ date: onDate(iso), sourceId: 'inc', sourceName: 'Job', amount }],
    bills,
  };
}

const cardBill = bill({ id: 'debt', creditorName: 'Card', budgetedAmount: 100, dueDay: 15 });

function fourPaychecks(): PaycheckAssignment[] {
  return ['2026-01-15', '2026-02-15', '2026-03-15', '2026-04-15'].map((iso) =>
    paycheck(iso, 500, [
      projectedBill({ billId: 'debt', amount: 100, date: onDate(iso), dueDay: 15, creditorName: 'Card' }),
    ])
  );
}

const hundredGoal: SavingsGoal = {
  id: 'g',
  budgetId: 'budget-1',
  name: 'Trip',
  targetAmount: 100,
  alreadySaved: 0,
  targetDate: '2026-04-15',
  priority: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('debtAcceleration', () => {
  it('pays the higher APR debt first', () => {
    const high = debt({ id: 'd-high', billId: 'b-high', apr: 0.29, principalBalance: 400 });
    const low = debt({ id: 'd-low', billId: 'b-low', apr: 0.08, principalBalance: 400 });
    const schedule = new SchedulerService().generateSchedule(
      [income],
      [bill({ id: 'b-high' }), bill({ id: 'b-low' })],
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
    const withPayments = schedule.paychecks.filter((paycheck) => paycheck.totalDebtPayments > 0);
    expect(withPayments.length).toBeGreaterThan(0);
    expect(withPayments[0].debtPayments[0].debtId).toBe('d-high');
  });

  it('keeps debtPayments empty and occurrence locks in force when acceleration is off', () => {
    const febBill = projectedBill({
      billId: 'debt',
      amount: 100,
      date: onDate('2026-02-15'),
      dueDay: 15,
      creditorName: 'Card',
    });
    const assignments = [
      paycheck('2026-01-15', 500, [
        projectedBill({ billId: 'debt', amount: 100, date: onDate('2026-01-15'), dueDay: 15, creditorName: 'Card' }),
      ]),
      paycheck('2026-02-15', 500, [febBill]),
    ];
    const manuals = new Map([[billOccurrenceKey(febBill.billId, febBill.date), '2026-02-15']]);
    const input = {
      assignments,
      debts: [debt({ id: 'd', billId: 'debt', principalBalance: 100, apr: 0, monthlyPayment: 100 })],
      bills: [cardBill],
      startIso: '2026-01-15',
      startingBalance: 0,
      maxBudgetRemaining: 250,
      minCashOnHand: 100,
      minSavingsPerPaycheck: 0,
      manualAssignments: manuals,
      accelerateDebtPayoff: false,
    };
    const off = runDebtAcceleration(input);
    expect(off.paychecks.every((paycheck) => paycheck.debtPayments === undefined)).toBe(true);
    expect(off.paychecks[1].bills.map((item) => item.billId)).toEqual(['debt']);
    expect(off.ignoredPins).toBe(0);
    expect(off.debtPlan.enabled).toBe(false);

    const on = runDebtAcceleration({ ...input, accelerateDebtPayoff: true });
    expect(on.paychecks[1].bills.map((item) => item.billId)).toEqual([]);
    expect(on.ignoredPins).toBe(1);
  });

  it('fills the would-be variant with baseline and accelerated figures while the flag is off', () => {
    const input = {
      assignments: fourPaychecks(),
      debts: [debt({ id: 'd', billId: 'debt', principalBalance: 220, apr: 0.18, monthlyPayment: 100 })],
      bills: [cardBill],
      startIso: '2026-01-15',
      startingBalance: 0,
      maxBudgetRemaining: 250,
      minCashOnHand: 100,
      minSavingsPerPaycheck: 0,
      goals: [hundredGoal],
      accelerateDebtPayoff: false,
    };
    const off = runDebtAcceleration(input);
    expect(off.debtPlan.enabled).toBe(false);
    expect(off.debtPlan.variant).toBe('deep');
    expect(off.debtPlan.debts[0]).toEqual({
      debtId: 'd',
      billId: 'debt',
      creditorName: 'Card',
      baselinePayoffDate: '2026-03-15',
      acceleratedPayoffDate: '2026-02-15',
      baselineInterest: 5.53,
      acceleratedInterest: 3.65,
    });
    expect(off.debtPlan.totalInterestSaved).toBe(1.88);
    expect(off.paychecks.map((paycheck) => paycheck.totalGoalDeposits)).toEqual([0, 0, 50, 50]);
  });

  it('reports baseline figures and zero interest saved when the chosen variant is disabled', () => {
    const input = {
      assignments: fourPaychecks(),
      debts: [debt({ id: 'd', billId: 'debt', principalBalance: 220, apr: 0.18, monthlyPayment: 100 })],
      bills: [cardBill],
      startIso: '2026-01-15',
      startingBalance: 0,
      maxBudgetRemaining: 250,
      minCashOnHand: 100,
      minSavingsPerPaycheck: 0,
      goals: [hundredGoal],
      accelerateDebtPayoff: false,
      forcedVariant: 'disabled' as const,
    };
    const result = runDebtAcceleration(input);
    const row = result.debtPlan.debts[0];
    expect(result.debtPlan.variant).toBe('disabled');
    expect(result.debtPlan.enabled).toBe(false);
    expect(result.debtPlan.totalInterestSaved).toBe(0);
    expect(result.debtPlan.freedMonthlyCash).toBe(0);
    expect(row.acceleratedPayoffDate).toBe(row.baselinePayoffDate);
    expect(row.acceleratedInterest).toBe(row.baselineInterest);
  });

  it('sends nothing to goals, savings, or debt when a paycheck still has an unpaid bill', () => {
    const result = runDebtAcceleration({
      assignments: [
        paycheck('2026-01-15', 100, [
          projectedBill({
            billId: 'rent',
            amount: 2000,
            date: onDate('2026-01-20'),
            dueDay: 20,
            creditorName: 'Rent',
            priority: 'critical',
            isUnpayable: true,
            unfundableReason: 'insufficient_income_in_window',
          }),
          projectedBill({
            billId: 'debt',
            amount: 50,
            date: onDate('2026-01-15'),
            dueDay: 15,
            creditorName: 'Card',
          }),
        ]),
      ],
      debts: [debt({ id: 'd', billId: 'debt', principalBalance: 500, apr: 0.2, monthlyPayment: 50 })],
      bills: [cardBill, bill({ id: 'rent', creditorName: 'Rent', budgetedAmount: 2000, category: 'housing' })],
      startIso: '2026-01-15',
      startingBalance: 0,
      maxBudgetRemaining: 250,
      minCashOnHand: 100,
      minSavingsPerPaycheck: 0,
      goals: [hundredGoal],
      accelerateDebtPayoff: true,
    });
    expect(result.paychecks[0].hasUnpayableBills).toBe(true);
    expect(result.paychecks[0].totalGoalDeposits).toBe(0);
    expect(result.paychecks[0].savingsDeposit).toBe(0);
    expect(result.paychecks[0].totalDebtPayments).toBe(0);
    expect(result.paychecks[0].debtPayments).toEqual([]);
  });

  it('repairs an unpaid bill only on an eligible paycheck', () => {
    const rent = projectedBill({
      billId: 'rent',
      amount: 40,
      date: onDate('2026-02-01'),
      dueDay: 1,
      creditorName: 'Rent',
      priority: 'high',
      isUnpayable: true,
      unfundableReason: 'insufficient_income_in_window',
    });
    const result = runDebtAcceleration({
      assignments: [
        paycheck('2026-01-01', 800, [
          projectedBill({ billId: 'debt', amount: 100, date: onDate('2026-01-01'), dueDay: 1, creditorName: 'Card' }),
        ]),
        paycheck('2026-01-20', 800, [
          projectedBill({ billId: 'debt', amount: 100, date: onDate('2026-01-20'), dueDay: 1, creditorName: 'Card' }),
        ]),
        paycheck('2026-02-15', 800, [rent]),
      ],
      debts: [debt({ id: 'd', billId: 'debt', principalBalance: 100, apr: 0, monthlyPayment: 100 })],
      bills: [bill({ id: 'debt', creditorName: 'Card', budgetedAmount: 100, dueDay: 1 })],
      startIso: '2026-01-01',
      startingBalance: 0,
      maxBudgetRemaining: 250,
      minCashOnHand: 100,
      minSavingsPerPaycheck: 0,
      accelerateDebtPayoff: true,
    });
    expect(result.paychecks[0].bills.map((item) => item.billId)).toEqual(['debt']);
    expect(result.paychecks[1].bills.map((item) => item.billId)).toEqual(['rent']);
    expect(result.paychecks[1].bills[0].isUnpayable).toBe(false);
    expect(result.paychecks[2].bills).toEqual([]);
  });

  it('rolls a freed minimum to the next debt without reducing savings', () => {
    const result = runDebtAcceleration({
      assignments: [
        paycheck('2026-01-15', 500, [
          projectedBill({ billId: 'high', amount: 100, date: onDate('2026-01-15'), dueDay: 15, creditorName: 'High' }),
          projectedBill({ billId: 'low', amount: 40, date: onDate('2026-01-15'), dueDay: 15, creditorName: 'Low' }),
        ]),
        paycheck('2026-02-15', 500, [
          projectedBill({ billId: 'high', amount: 100, date: onDate('2026-02-15'), dueDay: 15, creditorName: 'High' }),
          projectedBill({ billId: 'low', amount: 40, date: onDate('2026-02-15'), dueDay: 15, creditorName: 'Low' }),
        ]),
      ],
      debts: [
        debt({ id: 'high', billId: 'high', principalBalance: 100, apr: 0.2, monthlyPayment: 100 }),
        debt({ id: 'low', billId: 'low', principalBalance: 200, apr: 0.05, monthlyPayment: 40 }),
      ],
      bills: [
        bill({ id: 'high', creditorName: 'High', budgetedAmount: 100, dueDay: 15 }),
        bill({ id: 'low', creditorName: 'Low', budgetedAmount: 40, dueDay: 15 }),
      ],
      startIso: '2026-01-15',
      startingBalance: 0,
      maxBudgetRemaining: 250,
      minCashOnHand: 100,
      minSavingsPerPaycheck: 0,
      accelerateDebtPayoff: true,
    });
    const february = result.paychecks[1];
    expect(february.bills.map((item) => item.billId)).toEqual(['low']);
    expect(february.savingsDeposit).toBe(100);
    expect(february.debtPayments).toEqual([
      { debtId: 'low', billId: 'low', creditorName: 'Low', amount: 110 },
    ]);
    expect(february.totalGoalDeposits + february.savingsDeposit + february.totalDebtPayments).toBe(210);
  });

  it('does not give a cancelled debt payment to a goal after that goal deadline', () => {
    const earlyGoal: SavingsGoal = {
      ...hundredGoal,
      targetAmount: 500,
      targetDate: '2026-01-20',
    };
    const result = runDebtAcceleration({
      assignments: [
        paycheck('2026-01-15', 800, [
          projectedBill({ billId: 'debt', amount: 100, date: onDate('2026-01-15'), dueDay: 15, creditorName: 'Card' }),
        ]),
        paycheck('2026-02-15', 800, [
          projectedBill({ billId: 'debt', amount: 100, date: onDate('2026-02-15'), dueDay: 15, creditorName: 'Card' }),
        ]),
      ],
      debts: [debt({ id: 'd', billId: 'debt', principalBalance: 100, apr: 0, monthlyPayment: 100 })],
      bills: [bill({ id: 'debt', creditorName: 'Card', budgetedAmount: 100, dueDay: 15 })],
      startIso: '2026-01-15',
      startingBalance: 0,
      maxBudgetRemaining: 250,
      minCashOnHand: 100,
      minSavingsPerPaycheck: 0,
      goals: [earlyGoal],
      accelerateDebtPayoff: true,
    });
    const february = result.paychecks.find((paycheck) => paycheck.date === '2026-02-15');
    expect(february?.bills.map((item) => item.billId)).not.toContain('debt');
    expect(february?.goalDeposits.find((deposit) => deposit.goalId === 'g')?.amount ?? 0).toBe(0);
    expect(february?.savingsDeposit ?? 0).toBeGreaterThanOrEqual(100);
  });

  it('does not fund a goal later than the flag-off schedule', () => {
    const input = {
      assignments: fourPaychecks(),
      debts: [debt({ id: 'd', billId: 'debt', principalBalance: 220, apr: 0.18, monthlyPayment: 100 })],
      bills: [cardBill],
      startIso: '2026-01-15',
      startingBalance: 0,
      maxBudgetRemaining: 250,
      minCashOnHand: 100,
      minSavingsPerPaycheck: 0,
      goals: [hundredGoal],
      accelerateDebtPayoff: true,
    };
    const on = runDebtAcceleration(input);
    const off = runDebtAcceleration({ ...input, accelerateDebtPayoff: false });
    expect(off.paychecks.map((paycheck) => paycheck.totalGoalDeposits)).toEqual([0, 0, 50, 50]);
    expect(on.paychecks.map((paycheck) => paycheck.totalGoalDeposits)).toEqual([0, 0, 100, 0]);
    expect(on.paychecks[2].date < off.paychecks[3].date).toBe(true);
  });

  it('accepts deep only when a goal is funded on an earlier paycheck than with acceleration off', () => {
    const early = {
      assignments: fourPaychecks(),
      debts: [debt({ id: 'd', billId: 'debt', principalBalance: 220, apr: 0.18, monthlyPayment: 100 })],
      bills: [cardBill],
      startIso: '2026-01-15',
      startingBalance: 0,
      maxBudgetRemaining: 250,
      minCashOnHand: 100,
      minSavingsPerPaycheck: 0,
      goals: [hundredGoal],
      accelerateDebtPayoff: true,
    };
    const movedEarlier = runDebtAcceleration(early);
    expect(movedEarlier.debtPlan.variant).toBe('deep');
    expect(movedEarlier.paychecks[2].goalDeposits).toEqual([
      { goalId: 'g', goalName: 'Trip', amount: 100 },
    ]);

    const notEarlier = runDebtAcceleration({
      ...early,
      debts: [debt({ id: 'd', billId: 'debt', principalBalance: 400, apr: 0.18, monthlyPayment: 100 })],
    });
    expect(notEarlier.debtPlan.variant).toBe('standard');
    expect(notEarlier.paychecks.map((paycheck) => paycheck.totalGoalDeposits)).toEqual([0, 0, 50, 50]);
  });

  it('keeps savings at the minSavingsPerPaycheck floor when that floor is above $100', () => {
    const result = runDebtAcceleration({
      assignments: [
        paycheck('2026-01-15', 2000, [
          projectedBill({ billId: 'debt', amount: 100, date: onDate('2026-01-15'), dueDay: 15, creditorName: 'Card' }),
        ]),
      ],
      debts: [debt({ id: 'd', billId: 'debt', principalBalance: 5000, apr: 0.2, monthlyPayment: 100 })],
      bills: [cardBill],
      startIso: '2026-01-15',
      startingBalance: 0,
      maxBudgetRemaining: 250,
      minCashOnHand: 100,
      minSavingsPerPaycheck: 150,
      accelerateDebtPayoff: true,
    });
    expect(result.paychecks[0].savingsDeposit).toBe(150);
    expect(result.paychecks[0].totalDebtPayments).toBe(1500);
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
    expect(excluded).toEqual([
      { debtId: 'apr', reason: 'apr_above_one' },
      { debtId: 'missing', reason: 'missing_bill' },
      { debtId: 'dup-b', reason: 'duplicate_bill' },
      { debtId: 'dup-a', reason: 'duplicate_bill' },
    ]);
    expect(eligible).toEqual([]);
  });

  it('rejects non-finite and huge principal before the loop', () => {
    const { eligible } = classifyDebts(
      [
        debt({ id: 'nan', billId: 'b-1', principalBalance: Number.NaN }),
        debt({ id: 'huge', billId: 'b-1', principalBalance: 50_000_000 }),
        debt({ id: 'ok', billId: 'b-1', principalBalance: 100, apr: 0.1 }),
      ],
      [bill({ id: 'b-1' })]
    );
    expect(eligible.map((item) => item.debt.id)).toEqual(['ok']);
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
