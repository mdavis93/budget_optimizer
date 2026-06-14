import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GoalAchievabilityPanel from '../../src/components/goals/GoalAchievabilityPanel';
import { buildGoalAchievabilityMessaging } from '../../src/utils/goalAchievabilityMessaging';
import { GoalProjection, SavingsGoal } from '../../src/types';

const goal: SavingsGoal = {
  id: 'goal-1',
  name: 'Emergency Fund',
  targetAmount: 11000,
  targetDate: '2027-05-30',
  alreadySaved: 0,
  priority: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const projection: GoalProjection = {
  goalId: 'goal-1',
  goalName: 'Emergency Fund',
  targetAmount: 11000,
  alreadySaved: 0,
  remainingAmount: 11000,
  targetDate: '2027-05-30',
  paycheckCount: 52,
  requiredPerPaycheck: 211.54,
  adjustedRequiredPerPaycheck: 211.54,
  availablePerPaycheck: 220,
  actualAllocation: 11000,
  achievableAmount: 11000,
  achievabilityPercent: 100,
  status: 'achievable',
  suggestions: [],
  isProjected: false,
  avgAllocationPerPaycheck: 220,
  marginPerPaycheck: 8.46,
  paychecksToFullyFund: 50,
  estimatedFundedDate: '2027-04-15',
  beatsDeadlineByPaychecks: 6,
  missesDeadlineByPaychecks: null,
  scheduleHealth: {
    tightPaycheckCount: 8,
    shortfallCount: 0,
    savingsTotal: 848,
  },
};

describe('GoalAchievabilityPanel', () => {
  it('renders headline and timeline with aria-live region', () => {
    const messaging = buildGoalAchievabilityMessaging(goal, projection);
    render(
      <GoalAchievabilityPanel
        goal={goal}
        projection={projection}
        messaging={messaging}
        onViewSchedule={vi.fn()}
      />
    );

    expect(screen.getByRole('region')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText("Funded, But It's Tight")).toBeInTheDocument();
    expect(screen.getByText(/Funded in ~50 paychecks/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /View funding on Schedule/i })).toBeInTheDocument();
  });

  it('shows loading skeleton when isLoading', () => {
    const { container } = render(
      <GoalAchievabilityPanel goal={goal} projection={null} messaging={null} isLoading />
    );
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('expands suggestions and triggers schedule/edit callbacks', async () => {
    const user = userEvent.setup();
    const onViewSchedule = vi.fn();
    const onEditGoal = vi.fn();
    const projectionWithSuggestions: GoalProjection = {
      ...projection,
      status: 'partial',
      achievabilityPercent: 72,
      actualAllocation: 7920,
      achievableAmount: 7920,
      marginPerPaycheck: -58.46,
      suggestions: [
        {
          type: 'increase_priority',
          description: 'Increase minimum savings by $60 per paycheck',
          newValue: 1,
          resultPercent: 90,
        },
      ],
    };
    const messaging = buildGoalAchievabilityMessaging(goal, projectionWithSuggestions);
    render(
      <GoalAchievabilityPanel
        goal={goal}
        projection={projectionWithSuggestions}
        messaging={messaging}
        onViewSchedule={onViewSchedule}
        onEditGoal={onEditGoal}
      />
    );

    await user.click(screen.getByRole('button', { name: /Show suggestions/i }));
    expect(screen.getByText(/Increase minimum savings by \$60 per paycheck/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /View funding on Schedule/i }));
    expect(onViewSchedule).toHaveBeenCalled();
    expect(onEditGoal).not.toHaveBeenCalled();
  });
});
