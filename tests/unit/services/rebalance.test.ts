import { describe, expect, it } from 'vitest';
import { parseISO } from 'date-fns';
import { rebalancePaycheckAssignments } from '../../../electron/services/scheduler/rebalance';
import { PaycheckAssignment } from '../../../electron/services/scheduler/types';

function buildAssignments(
  specs: Array<{ date: string; income: number; bills: Array<{ id: string; amount: number; dueDate: string; priority?: 'low' | 'normal' | 'high' | 'critical'; isIncomeAttached?: boolean }> }>
): PaycheckAssignment[] {
  return specs.map((spec) => ({
    date: parseISO(spec.date),
    incomes: [{ sourceId: 'income-1', sourceName: 'Salary', amount: spec.income, date: parseISO(spec.date), cadence: 'weekly' as const }],
    bills: spec.bills.map((bill) => ({
      date: parseISO(bill.dueDate),
      billId: bill.id,
      creditorName: bill.id,
      amount: bill.amount,
      dueDay: parseISO(bill.dueDate).getDate(),
      priority: bill.priority ?? 'normal',
      isIncomeAttached: bill.isIncomeAttached,
    })),
  }));
}

const REBALANCE_OPTS = { targetCashOnHand: 250, minCashOnHand: 100 };

describe('rebalancePaycheckAssignments', () => {
  it('moves movable bills earlier when a later paycheck is over capacity', () => {
    const assignments = buildAssignments([
      { date: '2027-02-12', income: 1000, bills: [] },
      {
        date: '2027-02-19',
        income: 1000,
        bills: [{ id: 'bill-a', amount: 600, dueDate: '2027-02-19' }],
      },
      {
        date: '2027-02-26',
        income: 1000,
        bills: [
          { id: 'bill-b', amount: 700, dueDate: '2027-02-26' },
          { id: 'bill-c', amount: 400, dueDate: '2027-02-26', priority: 'low' },
        ],
      },
    ]);

    rebalancePaycheckAssignments(assignments, 0, REBALANCE_OPTS);

    const feb26Load = assignments[2].bills.reduce((sum, bill) => sum + bill.amount, 0);

    expect(feb26Load).toBeLessThanOrEqual(750);
    expect(assignments[2].bills.some((bill) => bill.billId === 'bill-c')).toBe(false);
  });

  it('never moves per-paycheck income-attached bills', () => {
    const assignments = buildAssignments([
      { date: '2027-02-12', income: 1000, bills: [] },
      {
        date: '2027-02-19',
        income: 1000,
        bills: [{ id: 'bill-attached', amount: 200, dueDate: '2027-02-19', isIncomeAttached: true }],
      },
      {
        date: '2027-02-26',
        income: 1000,
        bills: [{ id: 'bill-heavy', amount: 400, dueDate: '2027-02-26' }],
      },
    ]);

    rebalancePaycheckAssignments(assignments, 0, REBALANCE_OPTS);

    expect(assignments[1].bills.some((bill) => bill.billId === 'bill-attached')).toBe(true);
    expect(assignments[0].bills.some((bill) => bill.billId === 'bill-attached')).toBe(false);
  });

  it('preserves minimum cash-on-hand by shifting bills off tight paychecks', () => {
    const assignments = buildAssignments([
      { date: '2027-02-12', income: 1000, bills: [] },
      {
        date: '2027-02-19',
        income: 1000,
        bills: [
          { id: 'bill-core', amount: 760, dueDate: '2027-02-19' },
          { id: 'bill-tight', amount: 200, dueDate: '2027-02-19', priority: 'low' },
        ],
      },
    ]);

    rebalancePaycheckAssignments(assignments, 0, REBALANCE_OPTS);

    const feb19Load = assignments[1].bills.reduce((sum, bill) => sum + bill.amount, 0);
    expect(feb19Load).toBeLessThanOrEqual(900);
    expect(assignments[0].bills.some((bill) => bill.billId === 'bill-tight')).toBe(true);
  });

  it('accepts break-glass cash-on-hand when target is infeasible but min is met', () => {
    const assignments = buildAssignments([
      { date: '2027-04-23', income: 1000, bills: [] },
      {
        date: '2027-04-30',
        income: 1000,
        bills: [
          { id: 'bill-fixed', amount: 800, dueDate: '2027-04-30' },
          { id: 'bill-movable', amount: 50, dueDate: '2027-04-30', priority: 'low' },
        ],
      },
    ]);

    rebalancePaycheckAssignments(assignments, 0, REBALANCE_OPTS);

    const apr30Load = assignments[1].bills.reduce((sum, bill) => sum + bill.amount, 0);
    expect(apr30Load).toBeLessThanOrEqual(900);
    expect(1000 - apr30Load).toBeGreaterThanOrEqual(100);
  });
});
