import { addDays, format, parseISO } from 'date-fns';
import { describe, expect, it } from 'vitest';
import { calculateGoalProjections } from '../../../electron/services/scheduler/goals';
import type { PaycheckEntry, SavingsGoal } from '@shared/types';

function paycheck(date: string, amount: number, goalId: string): PaycheckEntry {
  return {
    date,
    isShortfall: false,
    goalDeposits: amount > 0 ? [{ goalId, goalName: 'New Car', amount }] : [],
    incomeSources: [],
    totalIncome: 0,
    bills: [],
    totalBills: 0,
    totalGoalDeposits: amount,
    budgetRemaining: 0,
    savingsDeposit: 0,
    totalSavings: 0,
  } as PaycheckEntry;
}

function openGoal(overrides: Partial<SavingsGoal> = {}): SavingsGoal {
  return {
    id: 'car',
    budgetId: 'budget-1',
    name: 'New Car',
    targetAmount: 1000,
    targetDate: '',
    alreadySaved: 0,
    priority: 0,
    openEnded: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('open-ended goal projections', () => {
  it('estimates a completion date past the schedule from the current surplus rate', () => {
    const [projection] = calculateGoalProjections(
      [openGoal()],
      [
        paycheck('2026-01-02', 100, 'car'),
        paycheck('2026-01-16', 100, 'car'),
        paycheck('2026-01-30', 100, 'car'),
      ],
      '2026-12-31',
      parseISO('2026-01-02')
    );

    expect(projection.status).toBe('achievable');
    expect(projection.achievabilityPercent).toBe(100);
    expect(projection.isProjected).toBe(true);
    expect(projection.paychecksToFullyFund).toBe(10);
    expect(projection.estimatedFundedDate).toBe(format(addDays(parseISO('2026-01-30'), 14 * 7), 'yyyy-MM-dd'));
    expect(projection.targetDate).toBe('');
  });

  it('uses the paycheck that finishes the goal when it lands inside the schedule', () => {
    const [projection] = calculateGoalProjections(
      [openGoal()],
      [
        paycheck('2026-01-02', 400, 'car'),
        paycheck('2026-01-16', 600, 'car'),
        paycheck('2026-01-30', 0, 'car'),
      ],
      '2026-12-31',
      parseISO('2026-01-02')
    );

    expect(projection.isProjected).toBe(false);
    expect(projection.estimatedFundedDate).toBe('2026-01-16');
    expect(projection.paychecksToFullyFund).toBe(2);
    expect(projection.actualAllocation).toBe(1000);
  });

  it('reports no funding date when the schedule has no surplus for the goal', () => {
    const [projection] = calculateGoalProjections(
      [openGoal()],
      [paycheck('2026-01-02', 0, 'car'), paycheck('2026-01-16', 0, 'car')],
      '2026-12-31',
      parseISO('2026-01-02')
    );

    expect(projection.status).toBe('impossible');
    expect(projection.estimatedFundedDate).toBeNull();
    expect(projection.paychecksToFullyFund).toBeNull();
    expect(projection.achievabilityPercent).toBe(0);
  });
});
