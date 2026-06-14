import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DataProvider, useData } from '../../src/context/DataContext';
import { createMockElectronAPI, createMockSchedule } from '../mocks/electron-api.mock';

const mockUseAuth = vi.fn();
const mockUseBudget = vi.fn();
const mockUseDraft = vi.fn();

vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('../../src/context/BudgetContext', () => ({
  useBudget: () => mockUseBudget(),
}));

vi.mock('../../src/context/DraftContext', () => ({
  useDraft: () => mockUseDraft(),
}));

function DataHarness() {
  const data = useData();

  return (
    <div>
      <div data-testid="schedule-start-date">{data.scheduleStartDate}</div>
      <div data-testid="schedule-length">{data.schedule?.paychecks.length ?? 0}</div>
      <div data-testid="error">{data.error ?? ''}</div>
      <div data-testid="income-size">{data.incomes.length}</div>
      <div data-testid="bill-size">{data.bills.length}</div>
      <button
        onClick={() =>
          void data.generateSchedule(
            data.scheduleStartDate,
            12,
            data.scheduleStartingBalance
          )
        }
      >
        generate
      </button>
      <button onClick={() => data.setScheduleMonths(2)}>viewport-2</button>
      <button onClick={() => data.setScheduleStartDate('2026-07-01')}>set-start-date</button>
      <button onClick={() => void data.refreshAllData()}>refresh-all</button>
      <button onClick={() => void data.refreshIncomes()}>refresh-income</button>
      <button onClick={() => void data.refreshBills()}>refresh-bills</button>
      <button
        onClick={() =>
          void data.createIncome({
            sourceName: 'Side Gig',
            amount: 400,
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
          void data.updateIncome('income-1', {
            sourceName: 'Updated Salary',
            amount: 2200,
            cadence: 'biweekly',
            startDate: '2026-01-01',
            isActive: true,
          })
        }
      >
        update-income
      </button>
      <button onClick={() => void data.deleteIncome('income-1')}>delete-income</button>
      <button
        onClick={() =>
          void data.createBill({
            creditorName: 'Internet',
            budgetedAmount: 80,
            dueDay: 5,
            isRecurring: true,
            priority: 'normal',
          })
        }
      >
        create-bill
      </button>
      <button
        onClick={() =>
          void data.updateBill('bill-1', {
            creditorName: 'Updated Rent',
            budgetedAmount: 1100,
            dueDay: 1,
            isRecurring: true,
            priority: 'critical',
          })
        }
      >
        update-bill
      </button>
      <button onClick={() => void data.deleteBill('bill-1')}>delete-bill</button>
      <button onClick={() => data.setScheduleStartingBalance(900)}>set-starting-balance</button>
      <button onClick={() => data.clearError()}>clear-error</button>
    </div>
  );
}

function createDraftMock() {
  return {
    incomes: [{ id: 'income-1', sourceName: 'Salary', amount: 2000, cadence: 'biweekly', startDate: '2026-01-01', isActive: true, createdAt: '2026-01-01', updatedAt: '2026-01-01' }],
    bills: [{ id: 'bill-1', creditorName: 'Rent', budgetedAmount: 1000, dueDay: 1, isRecurring: true, priority: 'critical', createdAt: '2026-01-01', updatedAt: '2026-01-01' }],
    budgetFields: {
      startingBalance: 400,
      targetCashOnHand: 100,
      minCashOnHand: 50,
      minSavingsPerPaycheck: 25,
      scheduleStartDate: '2026-04-01',
    },
    isLoading: false,
    isDraftMode: true,
    reloadSnapshot: vi.fn().mockResolvedValue(undefined),
    buildDraftOverlay: vi.fn(() => ({ scheduleStartDate: '2026-04-01' })),
    updateBudgetFields: vi.fn(),
    createIncome: vi.fn().mockReturnValue(true),
    updateIncome: vi.fn().mockReturnValue(true),
    deleteIncome: vi.fn().mockReturnValue(true),
    createBill: vi.fn().mockReturnValue(true),
    updateBill: vi.fn().mockReturnValue(true),
    deleteBill: vi.fn().mockReturnValue(true),
  };
}

describe('DataContext', () => {
  let mockAPI: ReturnType<typeof createMockElectronAPI>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAPI = createMockElectronAPI();
    window.electronAPI = mockAPI as unknown as Window['electronAPI'];

    mockUseAuth.mockReturnValue({ isUnlocked: true });
    mockUseBudget.mockReturnValue({
      isQuickBudget: false,
      hasBudgetSelected: true,
      currentBudget: {
        id: 'budget-1',
        name: 'Main',
        startingBalance: 300,
        scheduleStartDate: '2026-01-01',
      },
    });
    mockUseDraft.mockReturnValue(createDraftMock());
  });

  function renderProvider() {
    return render(
      <DataProvider>
        <DataHarness />
      </DataProvider>
    );
  }

  describe('happy', () => {
    it('uses draft scheduleStartDate and generates schedule', async () => {
      renderProvider();

      expect(screen.getByTestId('schedule-start-date')).toHaveTextContent('2026-04-01');
      fireEvent.click(screen.getByText('generate'));

      await waitFor(() => {
        expect(mockAPI.schedule.build).toHaveBeenCalledWith(
          '2026-04-01',
          12,
          400,
          expect.objectContaining({ scheduleStartDate: '2026-04-01' })
        );
      });
      expect(screen.getByTestId('schedule-length')).toHaveTextContent('1');
    });

    it('updates viewport without a second IPC schedule call', async () => {
      mockAPI.schedule.build.mockResolvedValue({
        success: true,
        data: createMockSchedule({
          startDate: '2026-04-01',
          endDate: '2027-03-31',
          viewportMonths: 12,
          fullPaychecks: [
            { ...createMockSchedule().fullPaychecks[0], date: '2026-04-15' },
            { ...createMockSchedule().fullPaychecks[0], date: '2026-05-15' },
            { ...createMockSchedule().fullPaychecks[0], date: '2026-10-15' },
          ],
          paychecks: [
            { ...createMockSchedule().fullPaychecks[0], date: '2026-04-15' },
            { ...createMockSchedule().fullPaychecks[0], date: '2026-05-15' },
            { ...createMockSchedule().fullPaychecks[0], date: '2026-10-15' },
          ],
        }),
      });

      renderProvider();
      fireEvent.click(screen.getByText('generate'));
      await waitFor(() => {
        expect(screen.getByTestId('schedule-length')).toHaveTextContent('3');
      });

      fireEvent.click(screen.getByText('viewport-2'));
      await waitFor(() => {
        expect(screen.getByTestId('schedule-length')).toHaveTextContent('2');
      });
      expect(mockAPI.schedule.build).toHaveBeenCalledTimes(1);
    });

    it('routes create/update/delete income and bills through draft in standard mode', async () => {
      const draft = createDraftMock();
      mockUseDraft.mockReturnValue(draft);
      renderProvider();

      fireEvent.click(screen.getByText('create-income'));
      fireEvent.click(screen.getByText('update-income'));
      fireEvent.click(screen.getByText('delete-income'));
      fireEvent.click(screen.getByText('create-bill'));
      fireEvent.click(screen.getByText('update-bill'));
      fireEvent.click(screen.getByText('delete-bill'));
      fireEvent.click(screen.getByText('refresh-all'));
      fireEvent.click(screen.getByText('refresh-income'));
      fireEvent.click(screen.getByText('refresh-bills'));
      fireEvent.click(screen.getByText('set-start-date'));

      await waitFor(() => {
        expect(draft.createIncome).toHaveBeenCalled();
        expect(draft.updateIncome).toHaveBeenCalled();
        expect(draft.deleteIncome).toHaveBeenCalledWith('income-1');
        expect(draft.createBill).toHaveBeenCalled();
        expect(draft.updateBill).toHaveBeenCalled();
        expect(draft.deleteBill).toHaveBeenCalledWith('bill-1');
        expect(draft.updateBudgetFields).toHaveBeenCalledWith({ scheduleStartDate: '2026-07-01' });
        expect(draft.reloadSnapshot).toHaveBeenCalled();
      });
    });
  });

  describe('sad', () => {
    it('sets error when schedule build returns unsuccessful result', async () => {
      mockAPI.schedule.build.mockResolvedValue({ success: false, error: 'bad schedule' });

      renderProvider();
      fireEvent.click(screen.getByText('generate'));

      await waitFor(() => {
        expect(screen.getByTestId('error')).toHaveTextContent('bad schedule');
      });
    });

    it('sets and clears errors from quick-budget CRUD failures', async () => {
      mockUseBudget.mockReturnValue({
        isQuickBudget: true,
        hasBudgetSelected: true,
        currentBudget: { id: 'budget-1', name: 'QB', startingBalance: 0, scheduleStartDate: '2026-01-01' },
      });
      mockAPI.income.create.mockResolvedValue({ success: false, error: 'quick create income failed' });
      mockAPI.bills.create.mockRejectedValue(new Error('quick create bill failed'));

      renderProvider();
      fireEvent.click(screen.getByText('create-income'));
      await waitFor(() => {
        expect(screen.getByTestId('error')).toHaveTextContent('quick create income failed');
      });

      fireEvent.click(screen.getByText('create-bill'));
      await waitFor(() => {
        expect(screen.getByTestId('error')).toHaveTextContent('Failed to create bill');
      });

      fireEvent.click(screen.getByText('clear-error'));
      expect(screen.getByTestId('error')).toHaveTextContent('');
    });

    it('surfaces update/delete failures in quick-budget mode', async () => {
      mockUseBudget.mockReturnValue({
        isQuickBudget: true,
        hasBudgetSelected: true,
        currentBudget: { id: 'budget-1', name: 'QB', startingBalance: 0, scheduleStartDate: '2026-01-01' },
      });
      mockAPI.income.update.mockResolvedValue({ success: false, error: 'update income failed' });
      mockAPI.bills.delete.mockResolvedValue({ success: false, error: 'delete bill failed' });

      renderProvider();
      fireEvent.click(screen.getByText('update-income'));
      await waitFor(() => {
        expect(screen.getByTestId('error')).toHaveTextContent('update income failed');
      });

      fireEvent.click(screen.getByText('delete-bill'));
      await waitFor(() => {
        expect(screen.getByTestId('error')).toHaveTextContent('delete bill failed');
      });
    });

    it('no-ops refresh helpers when locked', async () => {
      const draft = createDraftMock();
      mockUseAuth.mockReturnValue({ isUnlocked: false });
      mockUseDraft.mockReturnValue(draft);

      renderProvider();
      fireEvent.click(screen.getByText('refresh-income'));
      fireEvent.click(screen.getByText('refresh-bills'));
      fireEvent.click(screen.getByText('refresh-all'));

      expect(draft.reloadSnapshot).not.toHaveBeenCalled();
    });
  });

  describe('hostile', () => {
    it('handles thrown error during schedule generation', async () => {
      mockAPI.schedule.build.mockRejectedValue(new Error('IPC down'));

      renderProvider();
      fireEvent.click(screen.getByText('generate'));

      await waitFor(() => {
        expect(screen.getByTestId('error')).toHaveTextContent('Failed to generate schedule');
      });
    });

    it('uses quick-budget IPC paths for updates/deletes and refreshes snapshot', async () => {
      const draft = createDraftMock();
      mockUseDraft.mockReturnValue(draft);
      mockUseBudget.mockReturnValue({
        isQuickBudget: true,
        hasBudgetSelected: true,
        currentBudget: { id: 'budget-1', name: 'QB', startingBalance: 0, scheduleStartDate: '2026-01-01' },
      });
      mockAPI.income.update.mockResolvedValue({ success: true, data: {} });
      mockAPI.income.delete.mockResolvedValue({ success: true, data: true });
      mockAPI.bills.update.mockResolvedValue({ success: true, data: {} });
      mockAPI.bills.delete.mockResolvedValue({ success: true, data: true });

      renderProvider();
      fireEvent.click(screen.getByText('update-income'));
      fireEvent.click(screen.getByText('delete-income'));
      fireEvent.click(screen.getByText('update-bill'));
      fireEvent.click(screen.getByText('delete-bill'));
      fireEvent.click(screen.getByText('set-start-date'));

      await waitFor(() => {
        expect(mockAPI.income.update).toHaveBeenCalled();
        expect(mockAPI.income.delete).toHaveBeenCalledWith('income-1');
        expect(mockAPI.bills.update).toHaveBeenCalled();
        expect(mockAPI.bills.delete).toHaveBeenCalledWith('bill-1');
        expect(draft.reloadSnapshot).toHaveBeenCalled();
      });
    });

    it('uses quick-budget IPC create paths for income and bills', async () => {
      mockUseBudget.mockReturnValue({
        isQuickBudget: true,
        hasBudgetSelected: true,
        currentBudget: { id: 'budget-1', name: 'QB', startingBalance: 0, scheduleStartDate: '2026-01-01' },
      });
      mockAPI.income.create.mockResolvedValue({ success: true, data: {} });
      mockAPI.bills.create.mockResolvedValue({ success: true, data: {} });

      renderProvider();
      fireEvent.click(screen.getByText('create-income'));
      fireEvent.click(screen.getByText('create-bill'));

      await waitFor(() => {
        expect(mockAPI.income.create).toHaveBeenCalled();
        expect(mockAPI.bills.create).toHaveBeenCalled();
      });
    });

    it('routes draft-mode CRUD through draft helpers and updates starting balance', async () => {
      const draft = createDraftMock();
      mockUseDraft.mockReturnValue(draft);

      renderProvider();
      fireEvent.click(screen.getByText('create-income'));
      fireEvent.click(screen.getByText('update-bill'));
      fireEvent.click(screen.getByText('delete-income'));
      fireEvent.click(screen.getByText('set-starting-balance'));

      expect(draft.createIncome).toHaveBeenCalled();
      expect(draft.updateBill).toHaveBeenCalled();
      expect(draft.deleteIncome).toHaveBeenCalled();
    });

    it('uses quick budget local start date when budget has no scheduleStartDate', async () => {
      mockUseBudget.mockReturnValue({
        isQuickBudget: true,
        hasBudgetSelected: true,
        currentBudget: { id: 'budget-1', name: 'QB', startingBalance: 0 },
      });

      renderProvider();
      fireEvent.click(screen.getByText('set-start-date'));

      expect(screen.getByTestId('schedule-start-date')).toHaveTextContent('2026-07-01');
    });
  });

  it('throws when useData is called outside provider', () => {
    function BadConsumer() {
      useData();
      return null;
    }
    expect(() => render(<BadConsumer />)).toThrow('useData must be used within a DataProvider');
  });
});
