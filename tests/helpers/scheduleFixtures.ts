import {
  DEFAULT_MIN_CASH_ON_HAND,
  DEFAULT_TARGET_CASH_ON_HAND,
} from '@shared/constants';
import type { Bill, Income, Leave, SavingsGoal, ScheduleData } from '@shared/types';
import { SchedulerService } from '../../electron/services/scheduler.service';

const STAMP = '2026-01-01T00:00:00.000Z';
const SCHEDULE_NOW = new Date('2026-01-01T12:00:00.000Z');

const PAYCHECKS_PER_YEAR: Record<Income['cadence'], number> = {
  weekly: 52,
  biweekly: 26,
  semimonthly: 24,
  monthly: 12,
};

export type AssignmentPair = readonly [occurrenceKey: string, paycheckDate: string];

export interface ScheduleScenario {
  id: string;
  description: string;
  incomes: Income[];
  bills: Bill[];
  startDate: string;
  /** Viewport passed to generateSchedule. The engine still builds the full horizon. */
  months: number;
  startingBalance: number;
  goals?: SavingsGoal[];
  leaves?: Leave[];
  manualAssignments?: readonly AssignmentPair[];
  preferredAssignments?: readonly AssignmentPair[];
  targetCashOnHand?: number;
  minCashOnHand?: number;
  /**
   * Steady-state annual bill dollars divided by annual operating income.
   * Recurring monthly bills and 52/26/24/12 paychecks. Not a measured horizon ratio.
   */
  load?: number;
  /** Takes tens of seconds on the current engine: benchmarked, kept out of unit tests. */
  isStress?: boolean;
}

export function makeIncome(
  overrides: Partial<Income> &
    Pick<Income, 'id' | 'sourceName' | 'amount' | 'cadence' | 'startDate'>
): Income {
  return {
    isActive: true,
    createdAt: STAMP,
    updatedAt: STAMP,
    ...overrides,
  };
}

export function makeBill(
  overrides: Partial<Bill> &
    Pick<Bill, 'id' | 'creditorName' | 'budgetedAmount' | 'dueDay' | 'priority'>
): Bill {
  return {
    isRecurring: true,
    createdAt: STAMP,
    updatedAt: STAMP,
    ...overrides,
  };
}

export function makeGoal(
  overrides: Partial<SavingsGoal> &
    Pick<SavingsGoal, 'id' | 'name' | 'targetAmount' | 'targetDate'>
): SavingsGoal {
  return {
    budgetId: 'budget-1',
    alreadySaved: 0,
    priority: 1,
    createdAt: STAMP,
    ...overrides,
  };
}

export function makeLeave(
  overrides: Partial<Leave> &
    Pick<Leave, 'id' | 'incomeId' | 'name' | 'type' | 'startDate' | 'endDate'>
): Leave {
  return {
    budgetId: 'budget-1',
    createdAt: STAMP,
    updatedAt: STAMP,
    ...overrides,
  };
}

export function annualOperatingIncome(incomes: readonly Income[]): number {
  return incomes.reduce((sum, income) => {
    if (!income.isActive || income.purpose === 'savingsAndGoals') return sum;
    return sum + income.amount * PAYCHECKS_PER_YEAR[income.cadence];
  }, 0);
}

export function monthlyAmountsForLoad(
  annualIncome: number,
  load: number,
  weights: readonly number[]
): number[] {
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  if (weights.length === 0 || weightSum <= 0) {
    throw new Error('load weights must be positive');
  }
  const monthlyPool = (annualIncome * load) / 12;
  return weights.map((weight) => Math.round(((monthlyPool * weight) / weightSum) * 100) / 100);
}

export function approximateAnnualLoad(scenario: ScheduleScenario): number {
  const income = annualOperatingIncome(scenario.incomes);
  if (income <= 0) return 0;
  const annualBills = scenario.bills.reduce((sum, bill) => {
    if (bill.isIncomeAttached || !bill.isRecurring) return sum;
    return sum + bill.budgetedAmount * 12;
  }, 0);
  return annualBills / income;
}

function toAssignmentMap(pairs: readonly AssignmentPair[] | undefined): Map<string, string> {
  return new Map(pairs ?? []);
}

export function runScenario(
  scenario: ScheduleScenario,
  scheduler: SchedulerService = new SchedulerService()
): ScheduleData {
  return scheduler.generateSchedule(
    scenario.incomes,
    scenario.bills,
    scenario.startDate,
    scenario.months,
    scenario.startingBalance,
    new Set(),
    toAssignmentMap(scenario.manualAssignments),
    scenario.targetCashOnHand ?? DEFAULT_TARGET_CASH_ON_HAND,
    scenario.goals ?? [],
    scenario.minCashOnHand ?? DEFAULT_MIN_CASH_ON_HAND,
    0,
    new Map(),
    new Map(),
    scenario.leaves ?? [],
    toAssignmentMap(scenario.preferredAssignments),
    SCHEDULE_NOW
  );
}
