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
  it('renders an on-track goal without restating the funding date in a sentence', () => {
    const onTrackProjection: GoalProjection = {
      ...projection,
      marginPerPaycheck: 40,
      requiredPerPaycheck: 200,
      adjustedRequiredPerPaycheck: 200,
      paychecksToFullyFund: 104,
      estimatedFundedDate: '2029-01-12',
      beatsDeadlineByPaychecks: 61,
    };
    const messaging = buildGoalAchievabilityMessaging(goal, onTrackProjection);
    render(
      <GoalAchievabilityPanel
        goal={goal}
        projection={onTrackProjection}
        messaging={messaging}
      />
    );

    expect(screen.getByText('On Track')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'On Track To Hit Your Target' })).toBeInTheDocument();
    expect(screen.queryByText(/You'll fund the full/)).not.toBeInTheDocument();
    expect(screen.getByText(/Funded in ~104 paychecks/)).toBeInTheDocument();
    expect(screen.getByText(/est\. Jan 12, 2029/)).toBeInTheDocument();
    expect(screen.getByText('61 paychecks before your deadline')).toBeInTheDocument();
    expect(
      screen.getByText("Most paychecks still leave some room beyond this goal's share.")
    ).toBeInTheDocument();
    expect(screen.getByText(/Assumes .* min cash each paycheck/)).toBeInTheDocument();
  });

  it('renders an open-ended goal with its funding date and paycheck count', () => {
    const openGoal: SavingsGoal = {
      ...goal,
      name: 'New Car',
      targetDate: '',
      openEnded: true,
      priority: 0,
    };
    const openProjection: GoalProjection = {
      ...projection,
      goalName: 'New Car',
      targetDate: '',
      paychecksToFullyFund: 48,
      estimatedFundedDate: '2028-03-04',
      marginPerPaycheck: 0,
      isProjected: false,
      status: 'achievable',
      achievabilityPercent: 100,
    };
    const messaging = buildGoalAchievabilityMessaging(openGoal, openProjection);
    render(
      <GoalAchievabilityPanel
        goal={openGoal}
        projection={openProjection}
        messaging={messaging}
      />
    );

    expect(screen.getByText('Open-Ended Goal')).toBeInTheDocument();
    expect(screen.getByText(
      "You'll fund the full $11,000.00 for New Car by Mar 4, 2028, about 48 paychecks from now."
    )).toBeInTheDocument();
    expect(screen.getByText(/Funded in ~48 paychecks/)).toBeInTheDocument();
    expect(screen.getByText(/est\. Mar 4, 2028/)).toBeInTheDocument();
    expect(screen.queryByText(/your deadline/i)).not.toBeInTheDocument();
  });

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
    expect(screen.getByText(/est\. Apr 15, 2027/)).toBeInTheDocument();
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

  it('renders unavailable state and supports edit callback without schedule link', async () => {
    const user = userEvent.setup();
    const onEditGoal = vi.fn();
    const unachievableProjection: GoalProjection = {
      ...projection,
      status: 'impossible',
      achievabilityPercent: 0,
      actualAllocation: 0,
      achievableAmount: 0,
      marginPerPaycheck: -150,
      missesDeadlineByPaychecks: 8,
      beatsDeadlineByPaychecks: null,
      suggestions: [{ type: 'extend_deadline', description: 'Extend target date', newValue: '2028-01-01', resultPercent: 80 }],
    };
    const messaging = buildGoalAchievabilityMessaging(goal, unachievableProjection);
    render(
      <GoalAchievabilityPanel
        goal={goal}
        projection={unachievableProjection}
        messaging={messaging}
        onEditGoal={onEditGoal}
      />
    );

    expect(screen.getByRole('heading', { name: /No Room In This Budget/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Show suggestions/i }));
    await user.click(screen.getByRole('button', { name: /Hide suggestions/i }));
    await user.click(screen.getByRole('button', { name: /Adjust priority or deadline/i }));
    expect(onEditGoal).toHaveBeenCalledWith('goal-1');
  });

  it('renders error state when projection messaging is unavailable', () => {
    render(<GoalAchievabilityPanel goal={goal} projection={null} messaging={null} error />);
    expect(screen.getByText(/Couldn't load funding outlook/i)).toBeInTheDocument();
  });
});
