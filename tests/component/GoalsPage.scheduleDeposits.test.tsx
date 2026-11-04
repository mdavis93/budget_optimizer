import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import GoalsPage from '../../src/pages/GoalsPage';
import ScheduleSummaryCards from '../../src/components/schedule/ScheduleSummaryCards';
import { SchedulerService } from '../../electron/services/scheduler.service';
import { formatCurrency } from '../../src/utils/formatCurrency';
import { createMockGoal, createMockIncome } from '../mocks/electron-api.mock';
import type { PaycheckEntry, SavingsGoal, ScheduleData } from '../../shared/types';

const START = '2026-01-01';
const NOW = new Date('2026-01-01T12:00:00.000Z');
const VIEWPORT_MONTHS = 12;

const mockUseDraftData = vi.fn();
const mockUseDraftActions = vi.fn();
const mockUseSchedule = vi.fn();
const mockUseBudget = vi.fn();
const generateSchedule = vi.fn(async () => null);

vi.mock('../../src/context/DraftContext', () => ({
  useDraft: () => ({ ...mockUseDraftData(), ...mockUseDraftActions(), ...mockUseSchedule() }),
  useDraftData: () => mockUseDraftData(),
  useDraftStatus: () => mockUseDraftData(),
  useDraftActions: () => mockUseDraftActions(),
  useSchedule: () => mockUseSchedule(),
}));

vi.mock('../../src/context/BudgetContext', () => ({
  useBudget: () => mockUseBudget(),
}));

function depositsForGoal(paychecks: PaycheckEntry[], goalId: string): number {
  return paychecks.reduce((sum, paycheck) => {
    if (paycheck.isShortfall) return sum;
    return (
      sum +
      paycheck.goalDeposits
        .filter((deposit) => deposit.goalId === goalId)
        .reduce((depositSum, deposit) => depositSum + deposit.amount, 0)
    );
  }, 0);
}

function totalGoalDeposits(paychecks: PaycheckEntry[]): number {
  return paychecks.reduce((sum, paycheck) => sum + paycheck.totalGoalDeposits, 0);
}

function rateForecast(
  alreadySaved: number,
  actualAllocation: number,
  achievableAmount: number
): number {
  return Math.max(0, achievableAmount - alreadySaved - actualAllocation);
}

function buildSchedule(goals: SavingsGoal[]): ScheduleData {
  return new SchedulerService().generateSchedule(
    [createMockIncome({ amount: 2000, startDate: START })],
    [],
    START,
    VIEWPORT_MONTHS,
    0,
    new Set(),
    new Map(),
    250,
    goals,
    100,
    0,
    new Map(),
    new Map(),
    [],
    new Map(),
    NOW
  );
}

function getGoalCard(goalName: string): HTMLElement {
  const heading = screen.getByRole('heading', { name: goalName });
  const card = heading.closest('.card');
  if (!(card instanceof HTMLElement)) {
    throw new Error(`Goal card not found for ${goalName}`);
  }
  return card;
}

function readLabeledAmount(card: HTMLElement, label: string): string {
  const labelNode = within(card).getByText(label);
  const value = labelNode.nextElementSibling?.textContent;
  if (!value) {
    throw new Error(`Missing value for ${label}`);
  }
  return value;
}

describe('GoalsPage schedule deposits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseBudget.mockReturnValue({ isQuickBudget: false });
    mockUseDraftActions.mockReturnValue({
      reloadSnapshot: vi.fn(async () => {}),
      createGoal: vi.fn(() => true),
      updateGoal: vi.fn(() => true),
      deleteGoal: vi.fn(() => true),
    });
  });

  function stubDraft(goals: SavingsGoal[], schedule: ScheduleData) {
    mockUseDraftData.mockReturnValue({
      goals,
      incomes: [createMockIncome({ amount: 2000, startDate: START })],
      bills: [],
      dirtyDomains: new Set<string>(),
      budgetFields: { minCashOnHand: 100 },
    });
    mockUseSchedule.mockReturnValue({
      generateSchedule,
      schedule,
      scheduleStartDate: START,
      scheduleMonths: VIEWPORT_MONTHS,
      isViewportReady: true,
      scheduleStartingBalance: 0,
      scheduleInputHash: 'goals-schedule-deposits',
      isLoading: false,
      error: null,
    });
  }

  function renderGoalsAndScheduleSummary(schedule: ScheduleData) {
    const goalsTotal = totalGoalDeposits(schedule.paychecks);
    render(
      <MemoryRouter>
        <GoalsPage />
        <ScheduleSummaryCards
          summary={schedule.summary}
          totalGoalDeposits={goalsTotal}
          hasAtRiskGoals={(schedule.goalProjections ?? []).some(
            (projection) => projection.status !== 'achievable'
          )}
        />
      </MemoryRouter>
    );
    return goalsTotal;
  }

  it('matches Goals Total to scheduler-funded amounts excluding already saved and rate forecasts', () => {
    const goals = [
      createMockGoal({
        id: 'goal-one',
        name: 'Goal One',
        priority: 1,
        targetAmount: 5000,
        targetDate: '2026-06-30',
        alreadySaved: 0,
      }),
      createMockGoal({
        id: 'goal-two',
        name: 'Goal Two',
        priority: 2,
        targetAmount: 8000,
        targetDate: '2026-12-31',
        alreadySaved: 2000,
      }),
      createMockGoal({
        id: 'goal-three',
        name: 'Goal Three',
        priority: 3,
        targetAmount: 500000,
        targetDate: '2032-01-01',
        alreadySaved: 0,
      }),
    ];

    const schedule = buildSchedule(goals);
    expect(schedule.calculationMonths).toBe(60);
    stubDraft(goals, schedule);

    const goalsTotal = renderGoalsAndScheduleSummary(schedule);
    const goalsTotalLabel = screen.getByText('Goals Total');
    const goalsTotalCard = goalsTotalLabel.closest('.card');
    expect(goalsTotalCard).toBeTruthy();
    expect(within(goalsTotalCard as HTMLElement).getByText(formatCurrency(goalsTotal))).toBeInTheDocument();

    const funding = goals.map((goal) => {
      const projection = schedule.goalProjections!.find((item) => item.goalId === goal.id)!;
      const scheduled = depositsForGoal(schedule.paychecks, goal.id);
      const fullHorizon = depositsForGoal(schedule.fullPaychecks, goal.id);
      const forecast = rateForecast(
        projection.alreadySaved,
        projection.actualAllocation,
        projection.achievableAmount
      );
      const card = getGoalCard(goal.name);

      expect(readLabeledAmount(card, 'Already Saved')).toBe(formatCurrency(goal.alreadySaved));

      if (projection.achievabilityPercent < 90) {
        expect(
          within(card).getByText(`${formatCurrency(goal.alreadySaved + projection.actualAllocation)} allocated`)
        ).toBeInTheDocument();
      }

      return {
        goal,
        projection,
        scheduled,
        fullHorizon,
        forecast,
      };
    });

    const scheduledSum = funding.reduce((sum, item) => sum + item.scheduled, 0);
    expect(scheduledSum).toBeCloseTo(goalsTotal, 2);

    const goalTwo = funding.find((item) => item.goal.id === 'goal-two')!;
    expect(goalTwo.goal.alreadySaved).toBeGreaterThan(0);
    expect(scheduledSum + goalTwo.goal.alreadySaved).not.toBeCloseTo(goalsTotal, 2);

    const goalThree = funding.find((item) => item.goal.id === 'goal-three')!;
    expect(goalThree.projection.isProjected).toBe(true);
    expect(goalThree.forecast).toBeGreaterThan(0);
    expect(scheduledSum + goalThree.forecast).not.toBeCloseTo(goalsTotal, 2);

    const goalThreeCard = getGoalCard('Goal Three');
    expect(
      within(goalThreeCard).getAllByText(/Long-Term Estimate Only|Projected To Reach/i).length
    ).toBeGreaterThan(0);
    expect(
      within(goalThreeCard).getAllByText(
        new RegExp(formatCurrency(goalThree.projection.achievableAmount).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      ).length
    ).toBeGreaterThan(0);
    expect(goalThree.projection.achievableAmount).not.toBeCloseTo(goalThree.scheduled, 2);
    expect(goalThree.projection.achievableAmount).not.toBeCloseTo(goalsTotal, 2);
  });

  it('keeps an 18-month goal aligned with real deposits past the 12-month window', () => {
    const goals = [
      createMockGoal({
        id: 'goal-eighteen',
        name: 'Eighteen Month',
        priority: 1,
        targetAmount: 200000,
        targetDate: '2027-07-01',
        alreadySaved: 0,
      }),
      createMockGoal({
        id: 'goal-near',
        name: 'Near Goal',
        priority: 2,
        targetAmount: 5000,
        targetDate: '2026-12-31',
        alreadySaved: 0,
      }),
      createMockGoal({
        id: 'goal-partial',
        name: 'Partial Saved',
        priority: 3,
        targetAmount: 8000,
        targetDate: '2026-12-31',
        alreadySaved: 2000,
      }),
    ];

    const schedule = buildSchedule(goals);
    expect(schedule.calculationMonths).toBe(18);
    stubDraft(goals, schedule);

    const goalsTotal = renderGoalsAndScheduleSummary(schedule);
    const goalsTotalLabel = screen.getByText('Goals Total');
    const goalsTotalCard = goalsTotalLabel.closest('.card');
    expect(goalsTotalCard).toBeTruthy();
    expect(within(goalsTotalCard as HTMLElement).getByText(formatCurrency(goalsTotal))).toBeInTheDocument();

    const eighteen = schedule.goalProjections!.find((item) => item.goalId === 'goal-eighteen')!;
    const inWindow = depositsForGoal(schedule.paychecks, 'goal-eighteen');
    const fullHorizon = depositsForGoal(schedule.fullPaychecks, 'goal-eighteen');
    const afterWindow = fullHorizon - inWindow;
    const forecast = rateForecast(
      eighteen.alreadySaved,
      eighteen.actualAllocation,
      eighteen.achievableAmount
    );

    expect(eighteen.isProjected).toBe(false);
    expect(forecast).toBe(0);
    expect(eighteen.achievableAmount).toBeCloseTo(
      eighteen.alreadySaved + eighteen.actualAllocation,
      2
    );
    expect(afterWindow).toBeGreaterThan(0);
    expect(eighteen.actualAllocation).toBeCloseTo(fullHorizon, 2);

    const card = getGoalCard('Eighteen Month');
    expect(readLabeledAmount(card, 'Already Saved')).toBe(formatCurrency(0));
    expect(
      within(card).getByText(`${formatCurrency(eighteen.actualAllocation)} allocated`)
    ).toBeInTheDocument();

    const goalsPageSchedulerTotal = goals.reduce((sum, goal) => {
      const projection = schedule.goalProjections!.find((item) => item.goalId === goal.id)!;
      return sum + projection.actualAllocation;
    }, 0);
    const afterWindowAllGoals = goals.reduce((sum, goal) => {
      const full = depositsForGoal(schedule.fullPaychecks, goal.id);
      const windowed = depositsForGoal(schedule.paychecks, goal.id);
      return sum + (full - windowed);
    }, 0);

    expect(goalsTotal).toBeCloseTo(
      goals.reduce((sum, goal) => sum + depositsForGoal(schedule.paychecks, goal.id), 0),
      2
    );
    expect(goalsPageSchedulerTotal - goalsTotal).toBeCloseTo(afterWindowAllGoals, 2);
    expect(afterWindowAllGoals).toBeCloseTo(afterWindow, 2);
    expect(forecast).toBe(0);
  });
});
