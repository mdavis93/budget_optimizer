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
      fireEvent.click(screen.getByRole('button', { name: /Create & Open/i }));

      await waitFor(() => {
        expect(createBudget).toHaveBeenCalledWith('Business', 0, 250, 100);
        expect(switchBudget).toHaveBeenCalledWith('budget-2');
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
  });
});
