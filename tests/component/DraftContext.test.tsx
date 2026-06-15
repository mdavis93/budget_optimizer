import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DraftProvider, useDraft, useDraftOptional } from '../../src/context/DraftContext';
import { ToastProvider } from '../../src/components/Toast';
import { createMockElectronAPI } from '../mocks/electron-api.mock';

const mockUseAuth = vi.fn();
const mockUseBudget = vi.fn();
const mockPersistDomains = vi.fn();

vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('../../src/context/BudgetContext', () => ({
  useBudget: () => mockUseBudget(),
}));

vi.mock('../../src/utils/draftPersist', async () => {
  const actual = await vi.importActual<typeof import('../../src/utils/draftPersist')>('../../src/utils/draftPersist');
  return {
    ...actual,
    persistDomains: (...args: Parameters<typeof actual.persistDomains>) => mockPersistDomains(...args),
  };
});

function DraftHarness() {
  const draft = useDraft();

  return (
    <div>
      <div data-testid="income-count">{draft.incomes.length}</div>
      <div data-testid="bill-name">{draft.bills[0]?.creditorName ?? ''}</div>
      <div data-testid="dirty-income">{String(draft.isDomainDirty('income'))}</div>
      <div data-testid="dirty-bills">{String(draft.isDomainDirty('bills'))}</div>
      <div data-testid="debt-count">{draft.debts.length}</div>
      <div data-testid="goal-count">{draft.goals.length}</div>
      <div data-testid="skipped-count">{draft.skippedBills.length}</div>
      <div data-testid="assignment-count">{draft.billAssignments.length}</div>
      <div data-testid="assignment-paycheck">{draft.billAssignments[0]?.paycheckDate ?? ''}</div>
      <div data-testid="override-count">{draft.incomeOverrides.length}</div>
      <div data-testid="dirty-goals">{String(draft.isDomainDirty('goals'))}</div>
      <div data-testid="dirty-debts">{String(draft.isDomainDirty('debts'))}</div>
      <div data-testid="dirty-schedule">{String(draft.isDomainDirty('schedule'))}</div>
      <div data-testid="dirty-budget">{String(draft.isDomainDirty('budget'))}</div>
      <div data-testid="budget-starting-balance">{draft.budgetFields?.startingBalance ?? -1}</div>
      <div data-testid="amortization-result">0</div>
      <div data-testid="goal-projection-result">0</div>
      <button
        onClick={() =>
          draft.createIncome({
            sourceName: 'Freelance',
            amount: 1200,
            cadence: 'monthly',
            startDate: '2026-06-01',
            isActive: true,
          })
        }
      >
        create-income
      </button>
      <button
        onClick={() =>
          draft.updateBill('bill-1', {
            creditorName: 'Updated Electric',
            budgetedAmount: 180,
            dueDay: 15,
            isRecurring: true,
            priority: 'normal',
          })
        }
      >
        update-bill
      </button>
      <button
        onClick={() =>
          draft.createBill({
            creditorName: 'Phone',
            budgetedAmount: 90,
            dueDay: 25,
            isRecurring: true,
            priority: 'normal',
          })
        }
      >
        create-bill
      </button>
      <button onClick={() => draft.deleteBill('bill-1')}>delete-bill</button>
      <button onClick={() => void draft.saveDomain('bills')}>save-bills</button>
      <button onClick={() => void draft.saveAll()}>save-all</button>
      <button onClick={() => draft.discardDomain('bills')}>discard-bills</button>
      <button onClick={() => draft.discardDomain('income')}>discard-income</button>
      <button onClick={() => draft.discardDomain('goals')}>discard-goals</button>
      <button onClick={() => draft.discardDomain('debts')}>discard-debts</button>
      <button onClick={() => draft.discardDomain('schedule')}>discard-schedule</button>
      <button onClick={() => draft.discardDomain('budget')}>discard-budget</button>
      <button onClick={() => void draft.saveDomain('budget')}>save-budget</button>
      <button onClick={() => draft.skipBill('bill-1', '2026-01-15')}>duplicate-skip</button>
      <button
        onClick={() =>
          draft.applyReconciliationFixes([
            {
              id: 'fix-dup-skip',
              type: 'skip_bill',
              billId: 'bill-1',
              billDueDate: '2026-01-15',
              fromPaycheckDate: '2026-01-15',
            },
          ])
        }
      >
        apply-duplicate-skip
      </button>
      <button onClick={() => void draft.saveDomain('income')}>save-income-clean</button>
      <button onClick={() => void draft.saveAll()}>save-all-clean</button>
      <div data-testid="overlay-present">{draft.buildDraftOverlay() ? 'yes' : 'no'}</div>
      <button onClick={() => draft.discardAll()}>discard-all</button>
      <button onClick={() => void draft.reloadSnapshot()}>reload-snapshot</button>
      <button onClick={() => draft.deleteIncome('income-1')}>delete-income</button>
      <button
        onClick={() =>
          draft.updateIncome('income-1', {
            sourceName: 'Primary Job Updated',
            amount: 2600,
            cadence: 'biweekly',
            startDate: '2026-01-01',
            isActive: true,
          })
        }
      >
        update-income
      </button>
      <button onClick={() => draft.skipBill('bill-1', '2026-01-15')}>skip-bill</button>
      <button onClick={() => draft.unskipBill('bill-1', '2026-01-15')}>unskip-bill</button>
      <button onClick={() => draft.assignBill('bill-1', '2026-01-15', '2026-01-29')}>assign-bill</button>
      <button onClick={() => draft.removeBillAssignment('bill-1', '2026-01-15')}>remove-assignment</button>
      <button onClick={() => draft.setIncomeOverride('income-1', '2026-01-29', 1500)}>set-override</button>
      <button onClick={() => draft.removeIncomeOverride('income-1', '2026-01-29')}>remove-override</button>
      <button
        onClick={() =>
          draft.applyReconciliationFixes([
            {
              id: 'fix-move',
              type: 'move_bill',
              billId: 'bill-1',
              billDueDate: '2026-01-15',
              fromPaycheckDate: '2026-01-15',
              toPaycheckDate: '2026-01-29',
            },
            {
              id: 'fix-skip',
              type: 'skip_bill',
              billId: 'bill-1',
              billDueDate: '2026-01-15',
              fromPaycheckDate: '2026-01-15',
            },
          ])
        }
      >
        apply-fixes
      </button>
      <button
        onClick={() =>
          draft.applyReconciliationFixes([
            {
              id: 'fix-move-only',
              type: 'move_bill',
              billId: 'bill-1',
              billDueDate: '2026-01-15',
              fromPaycheckDate: '2026-01-15',
              toPaycheckDate: '2026-02-12',
            },
          ])
        }
      >
        apply-move-only
      </button>
      <button
        onClick={() =>
          draft.applyReconciliationFixes([
            {
              id: 'fix-move-no-target',
              type: 'move_bill',
              billId: 'bill-1',
              billDueDate: '2026-01-15',
              fromPaycheckDate: '2026-01-15',
            },
          ])
        }
      >
        apply-move-no-target
      </button>
      <button onClick={() => draft.updateBudgetFields({ startingBalance: 1234 })}>update-budget</button>
      <button
        onClick={() =>
          draft.createDebt({
            billId: 'bill-1',
            principalBalance: 1200,
            apr: 0.2,
            monthlyPayment: 100,
          })
        }
      >
        create-debt
      </button>
      <button
        onClick={() => {
          const id = draft.debts[0]?.id;
          if (id) {
            draft.updateDebt(id, { monthlyPayment: 125 });
          }
        }}
      >
        update-debt
      </button>
      <button
        onClick={() => {
          const id = draft.debts[0]?.id;
          if (id) {
            draft.deleteDebt(id);
          }
        }}
      >
        delete-debt
      </button>
      <button
        onClick={() =>
          draft.createGoal({
            name: 'Emergency Fund',
            targetAmount: 3000,
            targetDate: '2027-01-01',
            priority: 1,
            alreadySaved: 500,
          })
        }
      >
        create-goal
      </button>
      <button
        onClick={() => {
          const id = draft.goals[0]?.id;
          if (id) {
            draft.updateGoal(id, { name: 'Emergency Plus' });
          }
        }}
      >
        update-goal
      </button>
      <button
        onClick={() => {
          const id = draft.goals[0]?.id;
          if (id) {
            draft.deleteGoal(id);
          }
        }}
      >
        delete-goal
      </button>
      <button
        onClick={() => {
          void draft.getDebtsWithAmortization().then((data) => {
            const el = document.querySelector('[data-testid="amortization-result"]');
            if (el) el.textContent = String(data.length);
          });
        }}
      >
        get-amortization
      </button>
      <button
        onClick={() => {
          void draft.getGoalProjections().then((data) => {
            const el = document.querySelector('[data-testid="goal-projection-result"]');
            if (el) el.textContent = String(data.length);
          });
        }}
      >
        get-goal-projections
      </button>
    </div>
  );
}

describe('DraftContext', () => {
  let mockAPI: ReturnType<typeof createMockElectronAPI>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAPI = createMockElectronAPI();
    (mockAPI as unknown as {
      debts: {
        getAll: ReturnType<typeof vi.fn>;
        getAllWithAmortization: ReturnType<typeof vi.fn>;
      };
    }).debts = {
      getAll: vi.fn().mockResolvedValue({ success: true, data: [] }),
      getAllWithAmortization: vi.fn().mockResolvedValue({ success: true, data: [] }),
    };
    window.electronAPI = mockAPI as unknown as Window['electronAPI'];

    mockUseAuth.mockReturnValue({ isUnlocked: true });
    mockUseBudget.mockReturnValue({
      currentBudget: {
        id: 'budget-1',
        name: 'Main',
        startingBalance: 1000,
        targetCashOnHand: 500,
        minCashOnHand: 100,
        minSavingsPerPaycheck: 50,
        scheduleStartDate: '2026-01-01',
      },
      isQuickBudget: false,
      hasBudgetSelected: true,
      refreshCurrentBudget: vi.fn().mockResolvedValue(undefined),
      loadBudgets: vi.fn().mockResolvedValue(undefined),
    });

    mockPersistDomains.mockResolvedValue({
      success: true,
      nextCommitted: {
        incomes: [{
          id: 'income-1',
          sourceName: 'Salary',
          amount: 2000,
          cadence: 'biweekly',
          startDate: '2026-01-01',
          isActive: true,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        }],
        bills: [{
          id: 'bill-1',
          creditorName: 'Electric Company',
          budgetedAmount: 150,
          dueDay: 15,
          isRecurring: true,
          priority: 'normal',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        }],
        debts: [],
        goals: [],
        skippedBills: [],
        billAssignments: [],
        incomeOverrides: [],
        budget: {
          startingBalance: 1000,
          targetCashOnHand: 500,
          minCashOnHand: 100,
          minSavingsPerPaycheck: 50,
          scheduleStartDate: '2026-01-01',
        },
      },
      nextDraft: {
        incomes: [{
          id: 'income-1',
          sourceName: 'Salary',
          amount: 2000,
          cadence: 'biweekly',
          startDate: '2026-01-01',
          isActive: true,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        }],
        bills: [{
          id: 'bill-1',
          creditorName: 'Electric Company',
          budgetedAmount: 150,
          dueDay: 15,
          isRecurring: true,
          priority: 'normal',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        }],
        debts: [],
        goals: [],
        skippedBills: [],
        billAssignments: [],
        incomeOverrides: [],
        budget: {
          startingBalance: 1000,
          targetCashOnHand: 500,
          minCashOnHand: 100,
          minSavingsPerPaycheck: 50,
          scheduleStartDate: '2026-01-01',
        },
      },
    });
    mockAPI.debts.getAllWithAmortization.mockResolvedValue({
      success: true,
      data: [{ debt: { id: 'debt-1' }, amortization: { monthsToPayoff: 10 }, bill: null }],
    });
    mockAPI.goals.getProjections.mockResolvedValue({
      success: true,
      data: [{ goalId: 'goal-1', status: 'achievable' }],
    });
  });

  function renderProvider() {
    return render(
      <ToastProvider>
        <DraftProvider>
          <DraftHarness />
        </DraftProvider>
      </ToastProvider>
    );
  }

  describe('happy', () => {
    it('creates income and marks income domain dirty', async () => {
      renderProvider();

      await waitFor(() => {
        expect(screen.getByTestId('income-count')).toHaveTextContent('1');
      });

      fireEvent.click(screen.getByText('create-income'));
      await waitFor(() => {
        expect(screen.getByTestId('income-count')).toHaveTextContent('2');
      });
      expect(screen.getByTestId('dirty-income')).toHaveTextContent('true');
    });

    it('updates income and marks income domain dirty', async () => {
      renderProvider();

      await waitFor(() => {
        expect(screen.getByTestId('income-count')).toHaveTextContent('1');
      });

      fireEvent.click(screen.getByText('update-income'));
      await waitFor(() => {
        expect(screen.getByTestId('dirty-income')).toHaveTextContent('true');
      });
    });

    it('loads amortization and goal projections when IPC succeeds', async () => {
      mockAPI.goals.getProjections.mockResolvedValueOnce({
        success: true,
        data: [{ goalId: 'goal-1', status: 'achievable' }],
      });
      (mockAPI as unknown as { debts: { getAllWithAmortization: ReturnType<typeof vi.fn> } }).debts
        .getAllWithAmortization.mockResolvedValueOnce({
          success: true,
          data: [{ debt: { id: 'debt-1' }, bill: { id: 'bill-1' }, amortization: { monthsToPayoff: 6 } }],
        });

      renderProvider();
      await waitFor(() => {
        expect(screen.getByTestId('income-count')).toHaveTextContent('1');
      });

      fireEvent.click(screen.getByText('get-amortization'));
      fireEvent.click(screen.getByText('get-goal-projections'));

      await waitFor(() => {
        expect(screen.getByTestId('amortization-result')).toHaveTextContent('1');
        expect(screen.getByTestId('goal-projection-result')).toHaveTextContent('1');
      });
    });

    it('hides draft overlay after discard-all', async () => {
      renderProvider();
      await waitFor(() => {
        expect(screen.getByTestId('bill-name')).toHaveTextContent('Electric Company');
      });

      fireEvent.click(screen.getByText('update-bill'));
      expect(screen.getByTestId('overlay-present')).toHaveTextContent('yes');
      fireEvent.click(screen.getByText('discard-all'));
      expect(screen.getByTestId('overlay-present')).toHaveTextContent('no');
    });

    it('updates bill, marks bills dirty, and saves bills domain', async () => {
      renderProvider();

      await waitFor(() => {
        expect(screen.getByTestId('bill-name')).toHaveTextContent('Electric Company');
      });

      fireEvent.click(screen.getByText('update-bill'));
      await waitFor(() => {
        expect(screen.getByTestId('bill-name')).toHaveTextContent('Updated Electric');
      });
      expect(screen.getByTestId('dirty-bills')).toHaveTextContent('true');

      fireEvent.click(screen.getByText('save-bills'));
      await waitFor(() => {
        expect(mockPersistDomains).toHaveBeenCalled();
      });
    });

    it('supports delete/discard/reload/save-all and projection lookups', async () => {
      renderProvider();
      await waitFor(() => {
        expect(screen.getByTestId('income-count')).toHaveTextContent('1');
      });

      fireEvent.click(screen.getByText('create-bill'));
      fireEvent.click(screen.getByText('delete-income'));
      fireEvent.click(screen.getByText('set-override'));
      fireEvent.click(screen.getByText('update-budget'));
      expect(screen.getByTestId('dirty-budget')).toHaveTextContent('true');
      expect(screen.getByTestId('override-count')).toHaveTextContent('1');

      fireEvent.click(screen.getByText('save-all'));
      await waitFor(() => {
        expect(mockPersistDomains).toHaveBeenCalled();
      });

      fireEvent.click(screen.getByText('reload-snapshot'));
      await waitFor(() => {
        expect(mockAPI.income.getAll).toHaveBeenCalled();
      });

      fireEvent.click(screen.getByText('get-amortization'));
      fireEvent.click(screen.getByText('get-goal-projections'));
      await waitFor(() => {
        expect(screen.getByTestId('amortization-result')).toHaveTextContent('1');
        expect(screen.getByTestId('goal-projection-result')).toHaveTextContent('1');
      });

      fireEvent.click(screen.getByText('discard-all'));
      expect(screen.getByTestId('dirty-bills')).toHaveTextContent('false');
    });

    it('discards individual domains and saves budget changes with refresh', async () => {
      const refreshCurrentBudget = vi.fn().mockResolvedValue(undefined);
      const loadBudgets = vi.fn().mockResolvedValue(undefined);
      mockUseBudget.mockReturnValue({
        currentBudget: {
          id: 'budget-1',
          name: 'Main',
          startingBalance: 1000,
          targetCashOnHand: 500,
          minCashOnHand: 100,
          minSavingsPerPaycheck: 50,
          scheduleStartDate: '2026-01-01',
        },
        isQuickBudget: false,
        hasBudgetSelected: true,
        refreshCurrentBudget,
        loadBudgets,
      });

      renderProvider();
      await waitFor(() => {
        expect(screen.getByTestId('income-count')).toHaveTextContent('1');
      });

      fireEvent.click(screen.getByText('create-income'));
      fireEvent.click(screen.getByText('discard-income'));
      expect(screen.getByTestId('income-count')).toHaveTextContent('1');

      fireEvent.click(screen.getByText('create-goal'));
      fireEvent.click(screen.getByText('discard-goals'));
      expect(screen.getByTestId('goal-count')).toHaveTextContent('1');

      fireEvent.click(screen.getByText('create-debt'));
      fireEvent.click(screen.getByText('discard-debts'));
      expect(screen.getByTestId('debt-count')).toHaveTextContent('0');

      fireEvent.click(screen.getByText('skip-bill'));
      fireEvent.click(screen.getByText('discard-schedule'));
      expect(screen.getByTestId('skipped-count')).toHaveTextContent('0');

      fireEvent.click(screen.getByText('update-budget'));
      expect(screen.getByTestId('overlay-present')).toHaveTextContent('yes');
      fireEvent.click(screen.getByText('discard-budget'));
      expect(screen.getByTestId('budget-starting-balance')).toHaveTextContent('1000');

      fireEvent.click(screen.getByText('update-budget'));
      fireEvent.click(screen.getByText('save-budget'));
      await waitFor(() => {
        expect(refreshCurrentBudget).toHaveBeenCalled();
        expect(loadBudgets).toHaveBeenCalled();
      });
    });
  });

  describe('sad', () => {
    it('keeps dirty domain when saveDomain fails', async () => {
      mockPersistDomains.mockResolvedValueOnce({
        success: false,
        error: 'save failed',
      });

      renderProvider();
      await waitFor(() => {
        expect(screen.getByTestId('bill-name')).toHaveTextContent('Electric Company');
      });

      fireEvent.click(screen.getByText('update-bill'));
      fireEvent.click(screen.getByText('save-bills'));

      await waitFor(() => {
        expect(mockPersistDomains).toHaveBeenCalled();
      });
      expect(screen.getByTestId('dirty-bills')).toHaveTextContent('true');
    });

    it('returns empty projection results when IPC responses are unsuccessful', async () => {
      mockAPI.debts.getAllWithAmortization.mockResolvedValueOnce({ success: false, error: 'no amortization' });
      mockAPI.goals.getProjections.mockResolvedValueOnce({ success: false, error: 'no goals' });
      renderProvider();

      fireEvent.click(screen.getByText('get-amortization'));
      fireEvent.click(screen.getByText('get-goal-projections'));
      await waitFor(() => {
        expect(screen.getByTestId('amortization-result')).toHaveTextContent('0');
        expect(screen.getByTestId('goal-projection-result')).toHaveTextContent('0');
      });
    });

    it('returns empty projection results when IPC succeeds without data', async () => {
      mockAPI.debts.getAllWithAmortization.mockResolvedValueOnce({ success: true, data: undefined });
      mockAPI.goals.getProjections.mockResolvedValueOnce({ success: true, data: null });
      renderProvider();

      await waitFor(() => {
        expect(screen.getByTestId('income-count')).toHaveTextContent('1');
      });

      fireEvent.click(screen.getByText('get-amortization'));
      fireEvent.click(screen.getByText('get-goal-projections'));
      await waitFor(() => {
        expect(screen.getByTestId('amortization-result')).toHaveTextContent('0');
        expect(screen.getByTestId('goal-projection-result')).toHaveTextContent('0');
      });
    });

    it('keeps dirty state when saveAll fails', async () => {
      mockPersistDomains.mockResolvedValueOnce({ success: false, error: 'save all failed' });
      renderProvider();

      await waitFor(() => {
        expect(screen.getByTestId('income-count')).toHaveTextContent('1');
      });

      fireEvent.click(screen.getByText('update-bill'));
      fireEvent.click(screen.getByText('save-all'));

      await waitFor(() => {
        expect(mockPersistDomains).toHaveBeenCalled();
      });
      expect(screen.getByTestId('dirty-bills')).toHaveTextContent('true');
    });
  });

  describe('hostile', () => {
    it('blocks draft mutations in quick budget mode', async () => {
      mockUseBudget.mockReturnValue({
        currentBudget: null,
        isQuickBudget: true,
        hasBudgetSelected: true,
        refreshCurrentBudget: vi.fn().mockResolvedValue(undefined),
        loadBudgets: vi.fn().mockResolvedValue(undefined),
      });

      renderProvider();

      await waitFor(() => {
        expect(screen.getByTestId('income-count')).toHaveTextContent('1');
      });

      fireEvent.click(screen.getByText('create-income'));
      fireEvent.click(screen.getByText('create-bill'));
      fireEvent.click(screen.getByText('discard-all'));
      fireEvent.click(screen.getByText('reload-snapshot'));
      expect(screen.getByTestId('income-count')).toHaveTextContent('1');
      expect(screen.getByTestId('bill-name')).toHaveTextContent('Electric Company');
      expect(screen.getByTestId('dirty-income')).toHaveTextContent('false');
    });

    it('covers schedule/debt/goal draft mutations', async () => {
      renderProvider();

      await waitFor(() => {
        expect(screen.getByTestId('income-count')).toHaveTextContent('1');
      });

      fireEvent.click(screen.getByText('skip-bill'));
      fireEvent.click(screen.getByText('assign-bill'));
      fireEvent.click(screen.getByText('create-debt'));
      fireEvent.click(screen.getByText('create-goal'));

      await waitFor(() => {
        expect(screen.getByTestId('skipped-count')).toHaveTextContent('1');
        expect(screen.getByTestId('assignment-count')).toHaveTextContent('1');
        expect(screen.getByTestId('debt-count')).toHaveTextContent('1');
        expect(screen.getByTestId('goal-count')).toHaveTextContent('2');
      });

      fireEvent.click(screen.getByText('update-debt'));
      fireEvent.click(screen.getByText('delete-debt'));
      fireEvent.click(screen.getByText('update-goal'));
      fireEvent.click(screen.getByText('delete-goal'));

      await waitFor(() => {
        expect(screen.getByTestId('debt-count')).toHaveTextContent('0');
        expect(screen.getByTestId('goal-count')).toHaveTextContent('1');
      });

      fireEvent.click(screen.getByText('remove-assignment'));
      fireEvent.click(screen.getByText('set-override'));
      fireEvent.click(screen.getByText('remove-override'));
      fireEvent.click(screen.getByText('apply-fixes'));
      fireEvent.click(screen.getByText('delete-bill'));
      fireEvent.click(screen.getByText('discard-bills'));
      fireEvent.click(screen.getByText('unskip-bill'));

      await waitFor(() => {
        expect(screen.getByTestId('dirty-schedule')).toHaveTextContent('true');
      });
    });

    it('ignores duplicate skip entries in draft mode', async () => {
      renderProvider();
      await waitFor(() => {
        expect(screen.getByTestId('income-count')).toHaveTextContent('1');
      });

      fireEvent.click(screen.getByText('skip-bill'));
      fireEvent.click(screen.getByText('duplicate-skip'));
      expect(screen.getByTestId('skipped-count')).toHaveTextContent('1');
    });

    it('ignores duplicate skip fixes during reconciliation apply', async () => {
      renderProvider();
      await waitFor(() => {
        expect(screen.getByTestId('income-count')).toHaveTextContent('1');
      });

      fireEvent.click(screen.getByText('skip-bill'));
      fireEvent.click(screen.getByText('apply-duplicate-skip'));
      expect(screen.getByTestId('skipped-count')).toHaveTextContent('1');
    });

    it('no-ops saveDomain when domain is already clean', async () => {
      renderProvider();
      await waitFor(() => {
        expect(screen.getByTestId('income-count')).toHaveTextContent('1');
      });

      fireEvent.click(screen.getByText('save-income-clean'));
      await waitFor(() => {
        expect(mockPersistDomains).not.toHaveBeenCalled();
      });
    });

    it('no-ops saveAll when nothing is dirty', async () => {
      renderProvider();
      await waitFor(() => {
        expect(screen.getByTestId('income-count')).toHaveTextContent('1');
      });

      fireEvent.click(screen.getByText('save-all-clean'));
      await waitFor(() => {
        expect(mockPersistDomains).not.toHaveBeenCalled();
      });
    });

    it('reloads quick-budget snapshot with debts when current budget exists', async () => {
      mockUseBudget.mockReturnValue({
        currentBudget: {
          id: 'budget-1',
          name: 'Quick',
          startingBalance: 500,
          scheduleStartDate: '2026-01-01',
        },
        isQuickBudget: true,
        hasBudgetSelected: true,
        refreshCurrentBudget: vi.fn().mockResolvedValue(undefined),
        loadBudgets: vi.fn().mockResolvedValue(undefined),
      });
      (mockAPI as unknown as { debts: { getAll: ReturnType<typeof vi.fn> } }).debts.getAll.mockResolvedValue({
        success: true,
        data: [{ id: 'debt-1', billId: 'bill-1', budgetId: 'budget-1', principalBalance: 500, apr: 0.1, monthlyPayment: 50, createdAt: '2026-01-01', updatedAt: '2026-01-01' }],
      });

      renderProvider();
      fireEvent.click(screen.getByText('reload-snapshot'));

      await waitFor(() => {
        expect(mockAPI.debts.getAll).toHaveBeenCalled();
      });
    });

    it('removes linked debt when deleting a bill that has debt attached', async () => {
      renderProvider();
      await waitFor(() => {
        expect(screen.getByTestId('bill-name')).toHaveTextContent('Electric Company');
      });

      fireEvent.click(screen.getByText('create-debt'));
      await waitFor(() => {
        expect(screen.getByTestId('debt-count')).toHaveTextContent('1');
      });

      fireEvent.click(screen.getByText('delete-bill'));

      await waitFor(() => {
        expect(screen.getByTestId('debt-count')).toHaveTextContent('0');
        expect(screen.getByTestId('dirty-bills')).toHaveTextContent('true');
      });
    });

    it('resets to empty snapshot when locked or no budget is selected', async () => {
      mockUseAuth.mockReturnValue({ isUnlocked: false });
      mockUseBudget.mockReturnValue({
        currentBudget: null,
        isQuickBudget: false,
        hasBudgetSelected: false,
        refreshCurrentBudget: vi.fn().mockResolvedValue(undefined),
        loadBudgets: vi.fn().mockResolvedValue(undefined),
      });
      renderProvider();

      await waitFor(() => {
        expect(screen.getByTestId('income-count')).toHaveTextContent('0');
        expect(screen.getByTestId('bill-name')).toHaveTextContent('');
      });
    });

    it('applyReconciliationFixes move_bill replaces existing assignment', async () => {
      renderProvider();
      await waitFor(() => {
        expect(screen.getByTestId('bill-name')).toHaveTextContent('Electric Company');
      });

      fireEvent.click(screen.getByText('assign-bill'));
      await waitFor(() => {
        expect(screen.getByTestId('assignment-paycheck')).toHaveTextContent('2026-01-29');
      });

      fireEvent.click(screen.getByText('apply-move-only'));
      await waitFor(() => {
        expect(screen.getByTestId('assignment-count')).toHaveTextContent('1');
        expect(screen.getByTestId('assignment-paycheck')).toHaveTextContent('2026-02-12');
        expect(screen.getByTestId('dirty-schedule')).toHaveTextContent('true');
      });
    });

    it('applyReconciliationFixes move_bill without toPaycheckDate is a no-op', async () => {
      renderProvider();
      await waitFor(() => {
        expect(screen.getByTestId('bill-name')).toHaveTextContent('Electric Company');
      });

      fireEvent.click(screen.getByText('apply-move-no-target'));
      expect(screen.getByTestId('assignment-count')).toHaveTextContent('0');
      expect(screen.getByTestId('dirty-schedule')).toHaveTextContent('false');
    });

    it('blocks applyReconciliationFixes when not in draft mode', async () => {
      mockUseBudget.mockReturnValue({
        currentBudget: null,
        isQuickBudget: true,
        hasBudgetSelected: true,
        refreshCurrentBudget: vi.fn().mockResolvedValue(undefined),
        loadBudgets: vi.fn().mockResolvedValue(undefined),
      });

      renderProvider();
      await waitFor(() => {
        expect(screen.getByTestId('income-count')).toHaveTextContent('1');
      });

      fireEvent.click(screen.getByText('apply-fixes'));
      expect(screen.getByTestId('assignment-count')).toHaveTextContent('0');
      expect(screen.getByTestId('skipped-count')).toHaveTextContent('0');
      expect(screen.getByTestId('dirty-schedule')).toHaveTextContent('false');
    });

    it('blocks createDebt in quick budget mode', async () => {
      mockUseBudget.mockReturnValue({
        currentBudget: null,
        isQuickBudget: true,
        hasBudgetSelected: true,
        refreshCurrentBudget: vi.fn().mockResolvedValue(undefined),
        loadBudgets: vi.fn().mockResolvedValue(undefined),
      });

      renderProvider();
      await waitFor(() => {
        expect(screen.getByTestId('income-count')).toHaveTextContent('1');
      });

      fireEvent.click(screen.getByText('create-debt'));
      expect(screen.getByTestId('debt-count')).toHaveTextContent('0');
      expect(screen.getByTestId('dirty-debts')).toHaveTextContent('false');
    });

    it('blocks updateBudgetFields when budget snapshot is null', async () => {
      mockUseBudget.mockReturnValue({
        currentBudget: null,
        isQuickBudget: true,
        hasBudgetSelected: true,
        refreshCurrentBudget: vi.fn().mockResolvedValue(undefined),
        loadBudgets: vi.fn().mockResolvedValue(undefined),
      });

      renderProvider();
      await waitFor(() => {
        expect(screen.getByTestId('budget-starting-balance')).toHaveTextContent('-1');
      });

      fireEvent.click(screen.getByText('update-budget'));
      expect(screen.getByTestId('budget-starting-balance')).toHaveTextContent('-1');
      expect(screen.getByTestId('dirty-budget')).toHaveTextContent('false');
    });

    it('blocks createDebt when no current budget is selected', async () => {
      mockUseBudget.mockReturnValue({
        currentBudget: null,
        isQuickBudget: false,
        hasBudgetSelected: false,
        refreshCurrentBudget: vi.fn().mockResolvedValue(undefined),
        loadBudgets: vi.fn().mockResolvedValue(undefined),
      });

      renderProvider();
      await waitFor(() => {
        expect(screen.getByTestId('income-count')).toHaveTextContent('0');
      });

      fireEvent.click(screen.getByText('create-debt'));
      expect(screen.getByTestId('debt-count')).toHaveTextContent('0');
    });

    it('blocks draft mutations and save in quick budget mode', async () => {
      mockUseBudget.mockReturnValue({
        currentBudget: null,
        isQuickBudget: true,
        hasBudgetSelected: true,
        refreshCurrentBudget: vi.fn().mockResolvedValue(undefined),
        loadBudgets: vi.fn().mockResolvedValue(undefined),
      });
      mockAPI.skippedBills.getAll.mockResolvedValue({ success: true, data: [] });
      mockAPI.goals.getAll.mockResolvedValue({ success: true, data: [] });

      renderProvider();
      await waitFor(() => {
        expect(screen.getByTestId('income-count')).toHaveTextContent('1');
      });

      fireEvent.click(screen.getByText('create-income'));
      fireEvent.click(screen.getByText('update-income'));
      fireEvent.click(screen.getByText('delete-income'));
      fireEvent.click(screen.getByText('create-bill'));
      fireEvent.click(screen.getByText('update-bill'));
      fireEvent.click(screen.getByText('create-goal'));
      fireEvent.click(screen.getByText('skip-bill'));
      fireEvent.click(screen.getByText('assign-bill'));
      fireEvent.click(screen.getByText('set-override'));
      fireEvent.click(screen.getByText('update-debt'));
      fireEvent.click(screen.getByText('delete-debt'));
      fireEvent.click(screen.getByText('update-goal'));
      fireEvent.click(screen.getByText('delete-goal'));
      fireEvent.click(screen.getByText('unskip-bill'));
      fireEvent.click(screen.getByText('remove-assignment'));
      fireEvent.click(screen.getByText('remove-override'));
      fireEvent.click(screen.getByText('save-bills'));
      fireEvent.click(screen.getByText('discard-bills'));

      expect(screen.getByTestId('income-count')).toHaveTextContent('1');
      expect(screen.getByTestId('bill-name')).toHaveTextContent('Electric Company');
      expect(screen.getByTestId('goal-count')).toHaveTextContent('0');
      expect(screen.getByTestId('assignment-count')).toHaveTextContent('0');
      expect(screen.getByTestId('override-count')).toHaveTextContent('0');
      expect(mockPersistDomains).not.toHaveBeenCalled();
    });
  });

  it('throws when useDraft is called outside provider', () => {
    function BadConsumer() {
      useDraft();
      return null;
    }
    expect(() => render(<BadConsumer />)).toThrow('useDraft must be used within a DraftProvider');
  });

  it('returns null from useDraftOptional outside provider', () => {
    function OptionalConsumer() {
      const draft = useDraftOptional();
      return <div data-testid="optional-draft">{draft ? 'yes' : 'no'}</div>;
    }
    render(<OptionalConsumer />);
    expect(screen.getByTestId('optional-draft')).toHaveTextContent('no');
  });
});
