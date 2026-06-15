import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import BudgetPicker from '../../src/components/BudgetPicker';
import { renderWithRouter } from '../helpers/renderWithProviders';
import { createMockElectronAPI } from '../mocks/electron-api.mock';

const mockUseBudget = vi.fn();

vi.mock('../../src/context/BudgetContext', () => ({
  useBudget: () => mockUseBudget(),
}));

describe('BudgetPicker', () => {
  const mockAPI = createMockElectronAPI();
  const onBudgetSelected = vi.fn();
  const switchBudget = vi.fn();
  const startQuickBudget = vi.fn();
  const createBudget = vi.fn();
  const loadBudgets = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseBudget.mockReturnValue({
      budgets: [
        {
          id: 'budget-1',
          name: 'Personal',
          incomeCount: 1,
          billCount: 2,
          updatedAt: '2026-01-01T00:00:00.000Z',
          startingBalance: 1000,
          targetCashOnHand: 500,
          minCashOnHand: 100,
        },
      ],
      loadBudgets,
      isLoading: false,
      switchBudget,
      startQuickBudget,
      createBudget,
    });
    createBudget.mockResolvedValue({ id: 'budget-2' });
  });

  describe('happy', () => {
    it('selects an existing budget and closes picker', async () => {
      renderWithRouter(<BudgetPicker onBudgetSelected={onBudgetSelected} />, { mockAPI });
      fireEvent.click(screen.getByRole('button', { name: /Personal/i }));

      await waitFor(() => {
        expect(switchBudget).toHaveBeenCalledWith('budget-1');
        expect(onBudgetSelected).toHaveBeenCalled();
      });
    });
  });

  describe('sad', () => {
    it('creates and opens a new budget from form', async () => {
      renderWithRouter(<BudgetPicker onBudgetSelected={onBudgetSelected} />, { mockAPI });
      fireEvent.click(screen.getByRole('button', { name: /Create New Budget/i }));
      fireEvent.change(screen.getByLabelText('Budget Name'), { target: { value: 'Business' } });
      fireEvent.change(screen.getByLabelText('Starting Balance'), { target: { value: '1500.50' } });
      fireEvent.change(screen.getByLabelText('Target Cash on Hand'), { target: { value: '400' } });
      fireEvent.change(screen.getByLabelText('Minimum Cash on Hand'), { target: { value: '150' } });
      fireEvent.click(screen.getByRole('button', { name: /Create & Open/i }));

      await waitFor(() => {
        expect(createBudget).toHaveBeenCalledWith('Business', 1500.5, 400, 150);
        expect(switchBudget).toHaveBeenCalledWith('budget-2');
      });
    });

    it('shows loading state while budgets are loading', () => {
      mockUseBudget.mockReturnValue({
        budgets: [],
        loadBudgets,
        isLoading: true,
        switchBudget,
        startQuickBudget,
        createBudget,
      });
      renderWithRouter(<BudgetPicker onBudgetSelected={onBudgetSelected} />, { mockAPI });
      expect(screen.getByText(/Loading budgets/i)).toBeInTheDocument();
    });

    it('renders singular and plural income and bill labels', () => {
      mockUseBudget.mockReturnValue({
        budgets: [
          {
            id: 'budget-1',
            name: 'Personal',
            incomeCount: 1,
            billCount: 1,
            updatedAt: '2026-01-01T00:00:00.000Z',
            startingBalance: 1000,
            targetCashOnHand: 500,
            minCashOnHand: 100,
          },
          {
            id: 'budget-2',
            name: 'Household',
            incomeCount: 2,
            billCount: 3,
            updatedAt: '2026-02-01T00:00:00.000Z',
            startingBalance: 2000,
            targetCashOnHand: 600,
            minCashOnHand: 200,
          },
        ],
        loadBudgets,
        isLoading: false,
        switchBudget,
        startQuickBudget,
        createBudget,
      });
      renderWithRouter(<BudgetPicker onBudgetSelected={onBudgetSelected} />, { mockAPI });
      expect(screen.getByText('1 income')).toBeInTheDocument();
      expect(screen.getByText('1 bill')).toBeInTheDocument();
      expect(screen.getByText('2 incomes')).toBeInTheDocument();
      expect(screen.getByText('3 bills')).toBeInTheDocument();
    });

    it('shows creating state while budget creation is in flight', async () => {
      let resolveCreate: (value: { id: string }) => void = () => undefined;
      createBudget.mockImplementation(
        () =>
          new Promise<{ id: string }>((resolve) => {
            resolveCreate = resolve;
          })
      );

      renderWithRouter(<BudgetPicker onBudgetSelected={onBudgetSelected} />, { mockAPI });
      fireEvent.click(screen.getByRole('button', { name: /Create New Budget/i }));
      fireEvent.change(screen.getByLabelText('Budget Name'), { target: { value: 'Business' } });
      fireEvent.click(screen.getByRole('button', { name: /Create & Open/i }));

      expect(screen.getByRole('button', { name: /Creating/i })).toBeDisabled();

      resolveCreate({ id: 'budget-2' });
      await waitFor(() => {
        expect(onBudgetSelected).toHaveBeenCalled();
      });
    });
  });

  describe('hostile', () => {
    it('starts quick budget flow', async () => {
      renderWithRouter(<BudgetPicker onBudgetSelected={onBudgetSelected} />, { mockAPI });
      fireEvent.click(screen.getByRole('button', { name: /Quick Budget/i }));

      await waitFor(() => {
        expect(startQuickBudget).toHaveBeenCalled();
        expect(onBudgetSelected).toHaveBeenCalled();
      });
    });

    it('cancels create-budget form without creating', () => {
      renderWithRouter(<BudgetPicker onBudgetSelected={onBudgetSelected} />, { mockAPI });
      fireEvent.click(screen.getByRole('button', { name: /Create New Budget/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(createBudget).not.toHaveBeenCalled();
    });

    it('shows create actions when no budgets exist', () => {
      mockUseBudget.mockReturnValue({
        budgets: [],
        loadBudgets,
        isLoading: false,
        switchBudget,
        startQuickBudget,
        createBudget,
      });
      renderWithRouter(<BudgetPicker onBudgetSelected={onBudgetSelected} />, { mockAPI });
      expect(screen.getByRole('button', { name: /Create New Budget/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Quick Budget/i })).toBeInTheDocument();
    });
  });
});
