import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GoalsPage from '../../src/pages/GoalsPage';
import { createMockGoal } from '../mocks/electron-api.mock';

const mockUseDraft = vi.fn();
const mockUseBudget = vi.fn();
const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('../../src/context/DraftContext', () => ({
  useDraft: () => mockUseDraft(),
}));

vi.mock('../../src/context/BudgetContext', () => ({
  useBudget: () => mockUseBudget(),
}));

vi.mock('../../src/components/goals/GoalAchievabilityPanel', () => ({
  default: ({
    onViewSchedule,
    onEditGoal,
    messaging,
  }: {
    onViewSchedule?: (link: { goalId: string; highlightPaycheckDate?: string }) => void;
    onEditGoal?: () => void;
    messaging?: { scheduleLink?: { goalId: string; highlightPaycheckDate?: string } | null };
  }) => (
    <div>
      <div>Goal Achievability</div>
      <button
        onClick={() => {
          if (onViewSchedule && messaging?.scheduleLink) {
            onViewSchedule(messaging.scheduleLink);
          }
        }}
      >
        go-to-schedule
      </button>
      <button onClick={() => onEditGoal?.()}>panel-edit</button>
    </div>
  ),
}));

describe('GoalsPage', () => {
  const baseDraft = {
    goals: [createMockGoal({ id: 'goal-1', name: 'Emergency Fund', targetAmount: 5000, targetDate: '2026-12-31' })],
    dirtyDomains: new Set<string>(),
    budgetFields: { minCashOnHand: 100 },
    reloadSnapshot: vi.fn(async () => {}),
    getGoalProjections: vi.fn(async () => []),
    createGoal: vi.fn(() => true),
    updateGoal: vi.fn(() => true),
    deleteGoal: vi.fn(() => true),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseBudget.mockReturnValue({ isQuickBudget: false });
    mockUseDraft.mockReturnValue(baseDraft);
  });

  describe('happy', () => {
    it('renders goal list after projections load', async () => {
      mockUseDraft.mockReturnValue({
        ...baseDraft,
        getGoalProjections: vi.fn(async () => [
          {
            goalId: 'goal-1',
            goalName: 'Emergency Fund',
            targetAmount: 5000,
            alreadySaved: 0,
            remainingAmount: 5000,
            targetDate: '2026-12-31',
            paycheckCount: 20,
            requiredPerPaycheck: 250,
            adjustedRequiredPerPaycheck: 250,
            availablePerPaycheck: 300,
            actualAllocation: 5000,
            achievableAmount: 5000,
            achievabilityPercent: 100,
            status: 'achievable',
            suggestions: [],
            isProjected: false,
            avgAllocationPerPaycheck: 250,
            marginPerPaycheck: 50,
            paychecksToFullyFund: 18,
            estimatedFundedDate: '2026-10-31',
            beatsDeadlineByPaychecks: 2,
            missesDeadlineByPaychecks: null,
            scheduleHealth: { tightPaycheckCount: 0, shortfallCount: 0, savingsTotal: 1000 },
          },
        ]),
      });
      render(<GoalsPage />);
      expect(await screen.findByText('Emergency Fund')).toBeInTheDocument();
      expect(screen.getByText('Priority: 1')).toBeInTheDocument();
      expect(screen.getByText('100%')).toBeInTheDocument();
    });
  });

  describe('sad', () => {
    it('shows empty-state panel with no goals', async () => {
      const user = userEvent.setup();
      mockUseDraft.mockReturnValue({
        ...baseDraft,
        goals: [],
      });

      render(<GoalsPage />);
      expect(await screen.findByText('No savings goals yet')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /Create Your First Goal/i }));
      expect(screen.getByRole('button', { name: /Create Goal/i })).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Cancel' }));
    });
  });

  describe('hostile', () => {
    it('creates, edits, deletes, and opens achievability actions', async () => {
      const user = userEvent.setup();
      render(<GoalsPage />);
      await user.click(await screen.findByRole('button', { name: /Add Goal/i }));

      fireEvent.change(screen.getByLabelText('Goal Name'), { target: { value: 'Vacation' } });
      fireEvent.change(screen.getByLabelText('Target Amount'), { target: { value: '3000' } });
      fireEvent.change(screen.getByLabelText('Target Date'), { target: { value: '2026-11-01' } });
      await user.click(screen.getByRole('button', { name: /Create Goal/i }));

      await waitFor(() => {
        expect(baseDraft.createGoal).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'Vacation',
            targetAmount: 3000,
            targetDate: '2026-11-01',
          })
        );
      });

      await user.click(screen.getByRole('button', { name: /Edit Emergency Fund/i }));
      const editName = screen.getByLabelText('Goal Name');
      await user.clear(editName);
      await user.type(editName, 'Emergency Fund Plus');
      await user.click(screen.getByRole('button', { name: /Save Changes/i }));
      await waitFor(() => {
        expect(baseDraft.updateGoal).toHaveBeenCalledWith(
          'goal-1',
          expect.objectContaining({ name: 'Emergency Fund Plus' })
        );
      });

      expect(screen.getByText('Goal Achievability')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /Delete Emergency Fund/i }));
      await user.click(screen.getByRole('button', { name: /^Delete$/i }));
      await waitFor(() => {
        expect(baseDraft.deleteGoal).toHaveBeenCalledWith('goal-1');
      });

      await user.click(screen.getByRole('button', { name: /Add Goal/i }));
      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      await user.click(screen.getByRole('button', { name: 'panel-edit' }));
    });

    it('uses quick-budget IPC create/update/delete handlers', async () => {
      const user = userEvent.setup();
      mockUseBudget.mockReturnValue({ isQuickBudget: true });
      window.electronAPI = {
        goals: {
          create: vi.fn(async () => ({ success: true, data: { id: 'goal-2' } })),
          update: vi.fn(async () => ({ success: true, data: { id: 'goal-1' } })),
          delete: vi.fn(async () => ({ success: true, data: true })),
        },
      } as unknown as Window['electronAPI'];

      render(<GoalsPage />);
      await user.click(await screen.findByRole('button', { name: /Add Goal/i }));
      fireEvent.change(screen.getByLabelText('Goal Name'), { target: { value: 'House' } });
      fireEvent.change(screen.getByLabelText('Target Amount'), { target: { value: '10000' } });
      fireEvent.change(screen.getByLabelText('Target Date'), { target: { value: '2027-01-01' } });
      await user.click(screen.getByRole('button', { name: /Create Goal/i }));

      await waitFor(() => {
        expect(window.electronAPI.goals.create).toHaveBeenCalled();
      });

      await user.click(screen.getByRole('button', { name: /Edit Emergency Fund/i }));
      await user.click(screen.getByRole('button', { name: /Save Changes/i }));
      await waitFor(() => {
        expect(window.electronAPI.goals.update).toHaveBeenCalled();
      });

      await user.click(screen.getByRole('button', { name: /Delete Emergency Fund/i }));
      await user.click(screen.getByRole('button', { name: /^Delete$/i }));
      await waitFor(() => {
        expect(window.electronAPI.goals.delete).toHaveBeenCalled();
      });
    });
  });
});
