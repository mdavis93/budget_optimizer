import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import BudgetsPage from '../../src/pages/BudgetsPage';
import { renderWithRouter } from '../helpers/renderWithProviders';
import { createMockElectronAPI } from '../mocks/electron-api.mock';

const mockUseBudget = vi.fn();
const mockUseDraft = vi.fn();
const mockUseUnsavedChangesGuard = vi.fn();

vi.mock('../../src/context/BudgetContext', () => ({
  useBudget: () => mockUseBudget(),
}));
vi.mock('../../src/context/DraftContext', () => ({
  useDraft: () => mockUseDraft(),
  useDraftData: () => mockUseDraft(),
  useDraftActions: () => mockUseDraft(),
}));
vi.mock('../../src/hooks/useUnsavedChangesGuard', () => ({
  useUnsavedChangesGuard: () => mockUseUnsavedChangesGuard(),
}));

describe('BudgetsPage', () => {
  const mockAPI = createMockElectronAPI();
  const loadBudgets = vi.fn();
  const createBudget = vi.fn();
  const updateBudget = vi.fn();
  const deleteBudget = vi.fn();
  const switchBudget = vi.fn();
  const startQuickBudget = vi.fn();
  const endQuickBudget = vi.fn();
  const updateBudgetFields = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseUnsavedChangesGuard.mockReturnValue({
      guardAction: (action: () => void) => action(),
      unsavedDialog: null,
    });
    mockUseDraft.mockReturnValue({
      isDraftMode: false,
      updateBudgetFields,
    });
    mockUseBudget.mockReturnValue({
      budgets: [
        {
          id: 'budget-1',
          name: 'Primary',
          incomeCount: 2,
          billCount: 5,
          startingBalance: 1400,
          targetCashOnHand: 500,
          minCashOnHand: 100,
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      currentBudget: { id: 'budget-1' },
      isQuickBudget: false,
      isLoading: false,
      loadBudgets,
      createBudget,
      updateBudget,
      deleteBudget,
      switchBudget,
      startQuickBudget,
      endQuickBudget,
    });
    createBudget.mockResolvedValue(undefined);
    updateBudget.mockResolvedValue(undefined);
    deleteBudget.mockResolvedValue(true);
    switchBudget.mockResolvedValue(undefined);
  });

  describe('happy', () => {
    it('renders existing budget list', () => {
      renderWithRouter(<BudgetsPage />, { mockAPI });
      expect(screen.getByText('Primary')).toBeInTheDocument();
      expect(screen.getByText('2 incomes')).toBeInTheDocument();
      expect(screen.getByText('5 bills')).toBeInTheDocument();
    });
  });

  describe('sad', () => {
    it('shows empty state when no budgets exist', () => {
      mockUseBudget.mockReturnValue({
        budgets: [],
        currentBudget: null,
        isQuickBudget: false,
        isLoading: false,
        loadBudgets,
        createBudget,
        updateBudget: vi.fn(),
        deleteBudget: vi.fn(),
        switchBudget: vi.fn(),
        startQuickBudget: vi.fn(),
        endQuickBudget: vi.fn(),
      });
      renderWithRouter(<BudgetsPage />, { mockAPI });
      expect(screen.getByText('No budgets yet. Create your first budget to get started.')).toBeInTheDocument();
    });
  });

  describe('hostile', () => {
    it('creates a budget from the create form', async () => {
      renderWithRouter(<BudgetsPage />, { mockAPI });
      fireEvent.click(screen.getByRole('button', { name: /New Budget/i }));

      fireEvent.change(screen.getByLabelText('Budget Name'), { target: { value: 'Consulting' } });
      fireEvent.change(screen.getByLabelText('Starting Balance'), { target: { value: '2200' } });
      fireEvent.change(screen.getByLabelText('Target Cash on Hand'), { target: { value: '700' } });
      fireEvent.change(screen.getByLabelText('Minimum Cash on Hand'), { target: { value: '200' } });
      fireEvent.click(screen.getByRole('button', { name: 'Create Budget' }));

      await waitFor(() => {
        expect(createBudget).toHaveBeenCalledWith('Consulting', 2200, 700, 200);
      });
    });

    it('edits and deletes a non-current budget', async () => {
      mockUseBudget.mockReturnValue({
        budgets: [
          {
            id: 'budget-1',
            name: 'Primary',
            incomeCount: 2,
            billCount: 5,
            startingBalance: 1400,
            targetCashOnHand: 500,
            minCashOnHand: 100,
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
          {
            id: 'budget-2',
            name: 'Secondary',
            incomeCount: 1,
            billCount: 3,
            startingBalance: 900,
            targetCashOnHand: 300,
            minCashOnHand: 80,
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        currentBudget: { id: 'budget-1' },
        isQuickBudget: false,
        isLoading: false,
        loadBudgets,
        createBudget,
        updateBudget,
        deleteBudget,
        switchBudget,
        startQuickBudget,
        endQuickBudget,
      });
      renderWithRouter(<BudgetsPage />, { mockAPI });

      fireEvent.click(screen.getByLabelText('Edit Secondary'));
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Secondary Updated' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => {
        expect(updateBudget).toHaveBeenCalledWith(
          'budget-2',
          expect.objectContaining({ name: 'Secondary Updated' })
        );
      });

      fireEvent.click(screen.getByLabelText('Delete Secondary'));
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
      await waitFor(() => {
        expect(deleteBudget).toHaveBeenCalledWith('budget-2');
      });
    });

    it('ignores create submit when budget name is blank', () => {
      renderWithRouter(<BudgetsPage />, { mockAPI });
      fireEvent.click(screen.getByRole('button', { name: /New Budget/i }));
      const form = screen.getByRole('button', { name: 'Create Budget' }).closest('form')!;
      fireEvent.change(screen.getByLabelText('Budget Name'), { target: { value: '   ' } });
      fireEvent.submit(form);
      expect(createBudget).not.toHaveBeenCalled();
    });

    it('ignores save when edit name is blank', () => {
      renderWithRouter(<BudgetsPage />, { mockAPI });
      fireEvent.click(screen.getByLabelText('Edit Primary'));
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: '   ' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      expect(updateBudget).not.toHaveBeenCalled();
    });

    it('edits current budget in draft mode and switches from quick budget', async () => {
      mockUseDraft.mockReturnValue({
        isDraftMode: true,
        updateBudgetFields,
      });
      mockUseBudget.mockReturnValue({
        budgets: [
          {
            id: 'budget-1',
            name: 'Primary',
            incomeCount: 2,
            billCount: 5,
            startingBalance: 1400,
            targetCashOnHand: 500,
            minCashOnHand: 100,
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
          {
            id: 'budget-2',
            name: 'Secondary',
            incomeCount: 1,
            billCount: 3,
            startingBalance: 900,
            targetCashOnHand: 300,
            minCashOnHand: 80,
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        currentBudget: { id: 'budget-1' },
        isQuickBudget: true,
        isLoading: false,
        loadBudgets,
        createBudget,
        updateBudget,
        deleteBudget,
        switchBudget,
        startQuickBudget,
        endQuickBudget,
      });
      renderWithRouter(<BudgetsPage />, { mockAPI });

      fireEvent.click(screen.getByLabelText('Edit Primary'));
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Primary Draft Edit' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => {
        expect(updateBudgetFields).toHaveBeenCalledWith(
          expect.objectContaining({ name: 'Primary Draft Edit' })
        );
      });

      fireEvent.click(screen.getAllByRole('button', { name: /^Switch$/ })[1]);
      await waitFor(() => {
        expect(endQuickBudget).toHaveBeenCalled();
        expect(switchBudget).toHaveBeenCalledWith('budget-2');
      });

      expect(screen.getByRole('button', { name: 'Active' })).toBeDisabled();
    });
  });
});
