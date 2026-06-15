import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { BudgetProvider, useBudget } from '../../src/context/BudgetContext';
import { createMockBudget, createMockElectronAPI } from '../mocks/electron-api.mock';
import { suppressExpectedConsoleErrors } from '../helpers/suppressExpectedConsoleErrors';

function BudgetHarness() {
  const budget = useBudget();
  const [createError, setCreateError] = useState('');
  const [updateError, setUpdateError] = useState('');

  return (
    <div>
      <div data-testid="budget-count">{budget.budgets.length}</div>
      <div data-testid="current-budget">{budget.currentBudget?.id ?? ''}</div>
      <div data-testid="is-quick">{String(budget.isQuickBudget)}</div>
      <div data-testid="has-budget">{String(budget.hasBudgetSelected)}</div>
      <button onClick={() => void budget.loadBudgets()}>load</button>
      <button onClick={() => void budget.switchBudget('budget-2')}>switch</button>
      <button onClick={() => void budget.refreshCurrentBudget()}>refresh-current</button>
      <button onClick={() => void budget.startQuickBudget()}>quick</button>
      <button onClick={() => void budget.endQuickBudget()}>end-quick</button>
      <button onClick={() => void budget.deleteBudget('budget-2')}>delete</button>
      <button
        onClick={() => {
          void budget.updateBudget('budget-2', { name: 'Updated Budget' }).catch((error: unknown) => {
            if (error instanceof Error) {
              setUpdateError(error.message);
            }
          });
        }}
      >
        update
      </button>
      <div data-testid="create-error">{createError}</div>
      <div data-testid="update-error">{updateError}</div>
      <button
        onClick={() => {
          void budget.createBudget('New Budget', 250).catch((error: unknown) => {
            if (error instanceof Error) {
              setCreateError(error.message);
            }
          });
        }}
      >
        create
      </button>
    </div>
  );
}

describe('BudgetContext', () => {
  let mockAPI: ReturnType<typeof createMockElectronAPI>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAPI = createMockElectronAPI();
    window.electronAPI = mockAPI as unknown as Window['electronAPI'];
  });

  function renderProvider() {
    return render(
      <BudgetProvider>
        <BudgetHarness />
      </BudgetProvider>
    );
  }

  describe('happy', () => {
    it('loads budgets into context', async () => {
      mockAPI.budget.getAllWithStats.mockResolvedValue({
        success: true,
        data: [
          { ...createMockBudget({ id: 'budget-1' }), incomeCount: 1, billCount: 1 },
          { ...createMockBudget({ id: 'budget-2' }), incomeCount: 2, billCount: 3 },
        ],
      });

      renderProvider();
      fireEvent.click(screen.getByText('load'));

      await waitFor(() => {
        expect(screen.getByTestId('budget-count')).toHaveTextContent('2');
      });
      expect(mockAPI.budget.getAllWithStats).toHaveBeenCalledTimes(1);
    });

    it('switches budget and saves last budget setting', async () => {
      mockAPI.budget.switch.mockResolvedValue({
        success: true,
        data: createMockBudget({ id: 'budget-2', name: 'Budget Two' }),
      });

      renderProvider();
      fireEvent.click(screen.getByText('switch'));

      await waitFor(() => {
        expect(screen.getByTestId('current-budget')).toHaveTextContent('budget-2');
      });
      expect(screen.getByTestId('is-quick')).toHaveTextContent('false');
      expect(mockAPI.settings.update).toHaveBeenCalledWith({ lastBudgetId: 'budget-2' });
    });

    it('creates budget and starts quick budget mode', async () => {
      mockAPI.budget.create.mockResolvedValue({
        success: true,
        data: createMockBudget({ id: 'budget-3', name: 'New Budget' }),
      });
      mockAPI.budget.getAllWithStats.mockResolvedValue({
        success: true,
        data: [{ ...createMockBudget({ id: 'budget-3' }), incomeCount: 0, billCount: 0 }],
      });

      renderProvider();
      fireEvent.click(screen.getByText('create'));
      await waitFor(() => {
        expect(mockAPI.budget.create).toHaveBeenCalledWith({
          name: 'New Budget',
          startingBalance: 250,
          targetCashOnHand: undefined,
          minCashOnHand: undefined,
        });
      });

      fireEvent.click(screen.getByText('quick'));
      await waitFor(() => {
        expect(screen.getByTestId('is-quick')).toHaveTextContent('true');
      });

      mockAPI.budget.getCurrent.mockResolvedValue({
        success: true,
        data: { budget: createMockBudget({ id: 'budget-3' }), isQuickBudget: false },
      });
      fireEvent.click(screen.getByText('refresh-current'));
      await waitFor(() => {
        expect(screen.getByTestId('current-budget')).toHaveTextContent('budget-3');
      });
    });
  });

  describe('sad', () => {
    it('does not update budgets when load fails', async () => {
      mockAPI.budget.getAllWithStats.mockResolvedValue({ success: false, error: 'db error' });

      renderProvider();
      fireEvent.click(screen.getByText('load'));

      await waitFor(() => {
        expect(mockAPI.budget.getAllWithStats).toHaveBeenCalledTimes(1);
      });
      expect(screen.getByTestId('budget-count')).toHaveTextContent('0');
    });

    it('keeps current budget unchanged when switch fails', async () => {
      mockAPI.budget.switch.mockResolvedValue({ success: false, error: 'missing budget' });

      renderProvider();
      fireEvent.click(screen.getByText('switch'));

      await waitFor(() => {
        expect(mockAPI.budget.switch).toHaveBeenCalledWith('budget-2');
      });
      expect(screen.getByTestId('current-budget')).toHaveTextContent('');
      expect(mockAPI.settings.update).not.toHaveBeenCalled();
    });

    it('returns false when delete fails', async () => {
      mockAPI.budget.delete.mockResolvedValue({ success: false, error: 'cannot delete' });
      renderProvider();
      fireEvent.click(screen.getByText('delete'));
      await waitFor(() => {
        expect(mockAPI.budget.delete).toHaveBeenCalledWith('budget-2');
      });
      expect(mockAPI.budget.getAllWithStats).not.toHaveBeenCalled();
    });
  });

  describe('hostile', () => {
    it('rejects createBudget when IPC returns failure', async () => {
      mockAPI.budget.create.mockResolvedValue({ success: false, error: 'permission denied' });

      renderProvider();
      fireEvent.click(screen.getByText('create'));

      await waitFor(() => {
        expect(screen.getByTestId('create-error')).toHaveTextContent('permission denied');
      });
    });

    it('captures update failure and exits quick mode on success', async () => {
      mockAPI.budget.update.mockResolvedValue({ success: false, error: 'update denied' });
      mockAPI.budget.endQuick.mockResolvedValue({ success: true });

      renderProvider();
      fireEvent.click(screen.getByText('quick'));
      await waitFor(() => {
        expect(screen.getByTestId('is-quick')).toHaveTextContent('true');
      });

      fireEvent.click(screen.getByText('update'));
      await waitFor(() => {
        expect(screen.getByTestId('update-error')).toHaveTextContent('update denied');
      });

      fireEvent.click(screen.getByText('end-quick'));
      await waitFor(() => {
        expect(screen.getByTestId('is-quick')).toHaveTextContent('false');
      });
      expect(screen.getByTestId('has-budget')).toHaveTextContent('false');
    });

    it('throws when useBudget is used outside provider', () => {
      function BadConsumer() {
        useBudget();
        return null;
      }
      suppressExpectedConsoleErrors(() => {
        expect(() => render(<BadConsumer />)).toThrow('useBudget must be used within a BudgetProvider');
      });
    });
  });
});
