import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GoalsPage from '../../src/pages/GoalsPage';
import { createMockGoal } from '../mocks/electron-api.mock';
import { delayedResolve, unstableDraftMock } from '../helpers/unstableDraftMock';

const mockUseDraftData = vi.fn();
const mockUseDraftActions = vi.fn();
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
  useDraft: () => ({ ...mockUseDraftData(), ...mockUseDraftActions() }),
  useDraftData: () => mockUseDraftData(),
  useDraftStatus: () => mockUseDraftData(),
  useDraftActions: () => mockUseDraftActions(),
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

const projectionFixture = {
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
};

describe('GoalsPage', () => {
  const baseDraftData = {
    goals: [createMockGoal({ id: 'goal-1', name: 'Emergency Fund', targetAmount: 5000, targetDate: '2026-12-31' })],
    dirtyDomains: new Set<string>(),
    budgetFields: { minCashOnHand: 100 },
  };

  const baseDraftActions = {
    reloadSnapshot: vi.fn(async () => {}),
    getGoalProjections: vi.fn(async () => []),
    createGoal: vi.fn(() => true),
    updateGoal: vi.fn(() => true),
    deleteGoal: vi.fn(() => true),
  };

  function mockDraftContext(
    dataOverrides: Partial<typeof baseDraftData> = {},
    actionsOverrides: Partial<typeof baseDraftActions> = {},
  ) {
    mockUseDraftData.mockReturnValue({ ...baseDraftData, ...dataOverrides });
    mockUseDraftActions.mockReturnValue({ ...baseDraftActions, ...actionsOverrides });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseBudget.mockReturnValue({ isQuickBudget: false });
    mockDraftContext();
  });

  describe('loading regression', () => {
    it('clears loading when draft data hook returns new object references each render', async () => {
      mockUseDraftData.mockImplementation(unstableDraftMock(() => ({ ...baseDraftData })));
      mockUseDraftActions.mockReturnValue({
        ...baseDraftActions,
        getGoalProjections: vi.fn(() => delayedResolve([], 100)),
      });

      render(<GoalsPage />);
      expect(document.querySelector('.animate-spin')).toBeTruthy();

      await waitFor(() => {
        expect(document.querySelector('.animate-spin')).toBeNull();
      });
      expect(await screen.findByText('Emergency Fund')).toBeInTheDocument();
    });
  });

  describe('happy', () => {
    it('renders goal list after projections load', async () => {
      mockDraftContext({}, {
        getGoalProjections: vi.fn(async () => [projectionFixture]),
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
      mockDraftContext({ goals: [] });

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
        expect(baseDraftActions.createGoal).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'Vacation',
            targetAmount: 3000,
            targetDate: '2026-11-01',
          })
        );
      });

      await user.click(screen.getByRole('button', { name: /Edit Emergency Fund/i }));
      fireEvent.change(screen.getByLabelText('Goal Name'), { target: { value: 'Emergency Fund Plus' } });
      await user.click(screen.getByRole('button', { name: /Save Changes/i }));
      await waitFor(() => {
        expect(baseDraftActions.updateGoal).toHaveBeenCalledWith(
          'goal-1',
          expect.objectContaining({ name: 'Emergency Fund Plus' })
        );
      });

      expect(screen.getByText('Goal Achievability')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /Delete Emergency Fund/i }));
      await user.click(screen.getByRole('button', { name: /^Delete$/i }));
      await waitFor(() => {
        expect(baseDraftActions.deleteGoal).toHaveBeenCalledWith('goal-1');
      });

      await user.click(screen.getByRole('button', { name: /Add Goal/i }));
      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      await user.click(screen.getByRole('button', { name: 'panel-edit' }));
    });

    it('updates priority and already saved fields when editing', async () => {
      const user = userEvent.setup();
      render(<GoalsPage />);
      await user.click(await screen.findByRole('button', { name: /Edit Emergency Fund/i }));

      fireEvent.change(screen.getByLabelText('Already Saved'), { target: { value: '500' } });
      await user.selectOptions(screen.getByLabelText('Priority'), '2');
      await user.click(screen.getByRole('button', { name: /Save Changes/i }));

      await waitFor(() => {
        expect(baseDraftActions.updateGoal).toHaveBeenCalledWith(
          'goal-1',
          expect.objectContaining({ alreadySaved: 500, priority: 2 })
        );
      });
    });

    it('navigates to schedule from achievability panel link', async () => {
      const user = userEvent.setup();
      mockDraftContext({}, {
        getGoalProjections: vi.fn(async () => [projectionFixture]),
      });

      render(<GoalsPage />);
      await user.click(await screen.findByRole('button', { name: 'go-to-schedule' }));
      expect(mockNavigate).toHaveBeenCalledWith(
        '/schedule?goalId=goal-1&paycheck=2026-10-31'
      );
    });

    it('cancels delete confirmation without deleting', async () => {
      const user = userEvent.setup();
      render(<GoalsPage />);
      await user.click(await screen.findByRole('button', { name: /Delete Emergency Fund/i }));
      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(baseDraftActions.deleteGoal).not.toHaveBeenCalled();
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

    it('shows loading spinner while projections load', () => {
      mockDraftContext({}, {
        getGoalProjections: vi.fn(() => new Promise(() => undefined)),
      });
      render(<GoalsPage />);
      expect(document.querySelector('.animate-spin')).toBeTruthy();
    });

    it('renders warning achievability color for mid-range projections', async () => {
      mockDraftContext({}, {
        getGoalProjections: vi.fn(async () => [
          { ...projectionFixture, actualAllocation: 2500, achievableAmount: 2500, achievabilityPercent: 75, status: 'tight' },
        ]),
      });
      render(<GoalsPage />);
      expect(await screen.findByText('75%')).toBeInTheDocument();
      expect(screen.getByText(/allocated/)).toBeInTheDocument();
    });

    it('renders danger achievability color for low projections', async () => {
      mockDraftContext({}, {
        getGoalProjections: vi.fn(async () => [
          { ...projectionFixture, actualAllocation: 500, achievableAmount: 500, achievabilityPercent: 25, status: 'unlikely' },
        ]),
      });
      render(<GoalsPage />);
      expect(await screen.findByText('25%')).toBeInTheDocument();
    });

    it('shows loading achievability panel when projection is missing', async () => {
      render(<GoalsPage />);
      expect(await screen.findByText('Emergency Fund')).toBeInTheDocument();
      expect(screen.getByText('Goal Achievability')).toBeInTheDocument();
    });

    it('keeps create modal open when createGoal returns false', async () => {
      const createGoal = vi.fn(() => false);
      mockDraftContext({}, { createGoal });
      const user = userEvent.setup();
      render(<GoalsPage />);
      await user.click(await screen.findByRole('button', { name: /Add Goal/i }));
      fireEvent.change(screen.getByLabelText('Goal Name'), { target: { value: 'Car' } });
      fireEvent.change(screen.getByLabelText('Target Amount'), { target: { value: '8000' } });
      fireEvent.change(screen.getByLabelText('Target Date'), { target: { value: '2027-06-01' } });
      await user.click(screen.getByRole('button', { name: /Create Goal/i }));

      await waitFor(() => {
        expect(createGoal).toHaveBeenCalled();
      });
      expect(screen.getByRole('dialog', { name: /Create Savings Goal/i })).toBeInTheDocument();
    });

    it('reloads snapshot on mount in quick-budget mode', async () => {
      const reloadSnapshot = vi.fn(async () => {});
      mockUseBudget.mockReturnValue({ isQuickBudget: true });
      mockDraftContext({}, { reloadSnapshot });
      render(<GoalsPage />);
      await waitFor(() => {
        expect(reloadSnapshot).toHaveBeenCalled();
      });
    });

    it('recovers when projection loading fails', async () => {
      mockDraftContext({}, {
        getGoalProjections: vi.fn(async () => {
          throw new Error('projection failed');
        }),
      });
      render(<GoalsPage />);
      expect(await screen.findByText('Emergency Fund')).toBeInTheDocument();
    });
  });
});
