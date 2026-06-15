import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import SchedulePage from '../../src/pages/SchedulePage';
import { createMockElectronAPI, createMockSchedule } from '../mocks/electron-api.mock';
import { renderWithRouter } from '../helpers/renderWithProviders';

const mockUseData = vi.fn();
const mockUseDraft = vi.fn();
const mockUseBudget = vi.fn();

vi.mock('../../src/context/DataContext', () => ({
  useData: () => mockUseData(),
}));

vi.mock('../../src/context/DraftContext', () => ({
  useDraft: () => mockUseDraft(),
}));

vi.mock('../../src/context/BudgetContext', () => ({
  useBudget: () => mockUseBudget(),
}));

vi.mock('../../src/components/schedule', () => ({
  ScheduleControls: () => <div>Mock Schedule Controls</div>,
  PaycheckView: ({
    paychecks,
    onSkipBill,
    onRestoreBill,
    onDragStart,
    onDragOver,
    onDrop,
    onDragEnd,
    onSaveIncomeOverride,
    onClearIncomeOverride,
  }: {
    paychecks: Array<{ date: string }>;
    onSkipBill: (billId: string, paycheckDate: string) => void;
    onRestoreBill: (billId: string, billDueDate: string) => void;
    onDragStart: (bill: { billId: string; creditorName: string; amount: number; dueDay: number; billDate: string }, sourcePaycheckDate: string) => void;
    onDragOver: (e: { preventDefault: () => void }, paycheckDate: string) => void;
    onDrop: (e: { preventDefault: () => void }, paycheckDate: string) => void;
    onDragEnd: () => void;
    onSaveIncomeOverride: (incomeId: string, paycheckDate: string, amount: number) => void;
    onClearIncomeOverride: (incomeId: string, paycheckDate: string) => void;
  }) => (
    <div>
      <div>Mock Paycheck View ({paychecks.length})</div>
      <button onClick={() => onSkipBill('bill-1', '2026-01-15')}>mock-skip-bill</button>
      <button onClick={() => onRestoreBill('bill-1', '2026-01-15')}>mock-restore-bill</button>
      <button
        onClick={() =>
          onDragStart(
            { billId: 'bill-1', creditorName: 'Rent', amount: 100, dueDay: 29, billDate: '2026-01-29' },
            '2026-01-15'
          )
        }
      >
        mock-drag-start
      </button>
      <button onClick={() => onDragOver({ preventDefault: vi.fn() }, '2026-01-29')}>mock-drag-over</button>
      <button onClick={() => onDrop({ preventDefault: vi.fn() }, '2026-01-29')}>mock-drop</button>
      <button onClick={onDragEnd}>mock-drag-end</button>
      <button onClick={() => onSaveIncomeOverride('inc-1', '2026-01-15', 1234)}>mock-save-override</button>
      <button onClick={() => onClearIncomeOverride('inc-1', '2026-01-15')}>mock-clear-override</button>
      <button
        onClick={() =>
          onDragStart(
            { billId: 'bill-1', creditorName: 'Rent', amount: 100, dueDay: 1, billDate: '2026-01-01' },
            '2026-01-15'
          )
        }
      >
        mock-drag-start-late
      </button>
      <button onClick={() => onDrop({ preventDefault: vi.fn() }, '2026-01-29')}>mock-drop-late</button>
      <button onClick={() => onDrop({ preventDefault: vi.fn() }, '2026-01-15')}>mock-drop-same</button>
    </div>
  ),
  CalendarView: () => <div>Mock Calendar View</div>,
}));

vi.mock('../../src/components/ReconciliationPage', () => ({
  default: ({ onApplyFixes, onSkip }: { onApplyFixes: (fixes: Array<{ id: string }>) => void; onSkip: () => void }) => (
    <div>
      <button onClick={() => onApplyFixes([{ id: 'fix-1' }])}>apply-fixes</button>
      <button onClick={onSkip}>skip-reconciliation</button>
    </div>
  ),
}));

vi.mock('../../src/components/ConfirmDialog', () => ({
  default: ({ isOpen, onConfirm }: { isOpen: boolean; onConfirm: () => void }) => (
    isOpen ? <button onClick={onConfirm}>confirm-assignment</button> : null
  ),
}));

describe('SchedulePage', () => {
  const mockAPI = createMockElectronAPI();
  const generateSchedule = vi.fn();
  const applyReconciliationFixes = vi.fn(() => true);
  const skipBill = vi.fn(() => true);
  const removeBillAssignment = vi.fn(() => true);
  const assignBill = vi.fn(() => true);
  const setIncomeOverride = vi.fn(() => true);
  const removeIncomeOverride = vi.fn(() => true);
  const reloadSnapshot = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    window.electronAPI = mockAPI as unknown as Window['electronAPI'];
    mockUseBudget.mockReturnValue({ isQuickBudget: false });
    mockUseDraft.mockReturnValue({
      billAssignments: [],
      incomeOverrides: [],
      skippedBills: [],
      reloadSnapshot,
      skipBill,
      removeBillAssignment,
      assignBill,
      setIncomeOverride,
      removeIncomeOverride,
      applyReconciliationFixes,
    });
    mockUseData.mockReturnValue({
      incomes: [{ id: 'inc-1' }],
      bills: [{ id: 'bill-1' }],
      schedule: createMockSchedule({
        paychecks: [createMockSchedule().paychecks[0]],
        recommendations: [],
      }),
      generateSchedule,
      isLoading: false,
      scheduleStartDate: '2026-01-01',
      scheduleMonths: 3,
      scheduleStartingBalance: 1000,
      setScheduleStartDate: vi.fn(),
      setScheduleMonths: vi.fn(),
      setScheduleStartingBalance: vi.fn(),
    });
  });

  describe('happy', () => {
    it('renders summary cards from schedule data', () => {
      renderWithRouter(<SchedulePage />, { mockAPI });
      expect(screen.getByText('Total Income')).toBeInTheDocument();
      expect(screen.getAllByText('$2,000.00').length).toBeGreaterThan(0);
      expect(screen.getByText('Total Expenses')).toBeInTheDocument();
      expect(screen.getByText('Mock Paycheck View (1)')).toBeInTheDocument();
    });
  });

  describe('sad', () => {
    it('renders empty schedule state when no income or bills exist', () => {
      mockUseData.mockReturnValue({
        incomes: [],
        bills: [],
        schedule: null,
        generateSchedule,
        isLoading: false,
        scheduleStartDate: '2026-01-01',
        scheduleMonths: 3,
        scheduleStartingBalance: 1000,
        setScheduleStartDate: vi.fn(),
        setScheduleMonths: vi.fn(),
        setScheduleStartingBalance: vi.fn(),
      });

      renderWithRouter(<SchedulePage />, { mockAPI });
      expect(screen.getByText('No Schedule Available')).toBeInTheDocument();
      expect(screen.getByText(/Add income sources and bills/i)).toBeInTheDocument();
    });
  });

  describe('hostile', () => {
    it('switches to calendar mode and refreshes schedule', () => {
      renderWithRouter(<SchedulePage />, { mockAPI });

      fireEvent.click(screen.getByRole('button', { name: /Calendar View/i }));
      expect(screen.getByText('Mock Calendar View')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /Paycheck View/i }));
      expect(screen.getByText('Mock Paycheck View (1)')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /Refresh/i }));
      expect(generateSchedule).toHaveBeenCalledWith('2026-01-01', 3, 1000);
    });

    it('applies reconciliation fixes and regenerates schedule', async () => {
      mockUseData.mockReturnValue({
        incomes: [{ id: 'inc-1' }],
        bills: [{ id: 'bill-1' }],
        schedule: createMockSchedule({
          paychecks: [createMockSchedule().paychecks[0]],
          recommendations: [],
          reconciliation: {
            needsReconciliation: true,
            shortfalls: [{ paycheckDate: '2026-01-15', deficit: 100 }],
            totalDeficit: 100,
            proposedFixes: [{ id: 'fix-1' }],
          },
        }),
        generateSchedule,
        isLoading: false,
        scheduleStartDate: '2026-01-01',
        scheduleMonths: 3,
        scheduleStartingBalance: 1000,
        setScheduleStartDate: vi.fn(),
        setScheduleMonths: vi.fn(),
        setScheduleStartingBalance: vi.fn(),
      });

      renderWithRouter(<SchedulePage />, { mockAPI });
      fireEvent.click(screen.getByRole('button', { name: 'apply-fixes' }));

      await waitFor(() => {
        expect(applyReconciliationFixes).toHaveBeenCalled();
        expect(generateSchedule).toHaveBeenCalledWith('2026-01-01', 3, 1000);
      });
    });

    it('handles reconciliation skip and re-open suggested fixes banner', async () => {
      mockUseData.mockReturnValue({
        incomes: [{ id: 'inc-1' }],
        bills: [{ id: 'bill-1' }],
        schedule: createMockSchedule({
          recommendations: ['deficit shortfall detected'],
          reconciliation: {
            needsReconciliation: true,
            shortfalls: [{ paycheckDate: '2026-01-15', deficit: 100 }],
            totalDeficit: 100,
            proposedFixes: [{ id: 'fix-1' }],
          },
        }),
        generateSchedule,
        isLoading: false,
        scheduleStartDate: '2026-01-01',
        scheduleMonths: 3,
        scheduleStartingBalance: 1000,
        setScheduleStartDate: vi.fn(),
        setScheduleMonths: vi.fn(),
        setScheduleStartingBalance: vi.fn(),
      });

      renderWithRouter(<SchedulePage />, { mockAPI });
      fireEvent.click(screen.getByRole('button', { name: 'skip-reconciliation' }));
      expect(await screen.findByText('Budget Has Unresolved Shortfalls')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /view suggested fixes/i }));
      expect(await screen.findByRole('button', { name: 'apply-fixes' })).toBeInTheDocument();
    });

    it('runs skip/restore, drag-drop assignment, and income override handlers', async () => {
      renderWithRouter(<SchedulePage />, { mockAPI });

      fireEvent.click(screen.getByRole('button', { name: 'mock-skip-bill' }));
      fireEvent.click(screen.getByRole('button', { name: 'mock-restore-bill' }));
      fireEvent.click(screen.getByRole('button', { name: 'mock-drag-start' }));
      fireEvent.click(screen.getByRole('button', { name: 'mock-drag-over' }));
      fireEvent.click(screen.getByRole('button', { name: 'mock-drop' }));
      fireEvent.click(screen.getByRole('button', { name: 'mock-drag-end' }));
      fireEvent.click(screen.getByRole('button', { name: 'mock-save-override' }));
      fireEvent.click(screen.getByRole('button', { name: 'mock-clear-override' }));

      await waitFor(() => {
        expect(skipBill).toHaveBeenCalledWith('bill-1', '2026-01-15');
        expect(removeBillAssignment).toHaveBeenCalledWith('bill-1', '2026-01-15');
        expect(assignBill).toHaveBeenCalledWith('bill-1', '2026-01-29', '2026-01-29');
        expect(setIncomeOverride).toHaveBeenCalledWith('inc-1', '2026-01-15', 1234);
        expect(removeIncomeOverride).toHaveBeenCalledWith('inc-1', '2026-01-15');
      });
    });

    it('uses quick-budget IPC handlers for skip and overrides', async () => {
      mockUseBudget.mockReturnValue({ isQuickBudget: true });
      mockAPI.skippedBills.skip = vi.fn().mockResolvedValue({ success: true });
      mockAPI.billAssignments.remove = vi.fn().mockResolvedValue({ success: true });
      mockAPI.incomeOverrides.set = vi.fn().mockResolvedValue({ success: true });
      mockAPI.incomeOverrides.remove = vi.fn().mockResolvedValue({ success: true });
      mockAPI.billAssignments.assign = vi.fn().mockResolvedValue({ success: true });

      renderWithRouter(<SchedulePage />, { mockAPI });
      fireEvent.click(screen.getByRole('button', { name: 'mock-skip-bill' }));
      fireEvent.click(screen.getByRole('button', { name: 'mock-restore-bill' }));
      fireEvent.click(screen.getByRole('button', { name: 'mock-save-override' }));
      fireEvent.click(screen.getByRole('button', { name: 'mock-clear-override' }));

      await waitFor(() => {
        expect(mockAPI.skippedBills.skip).toHaveBeenCalled();
        expect(mockAPI.billAssignments.remove).toHaveBeenCalled();
        expect(mockAPI.incomeOverrides.set).toHaveBeenCalled();
        expect(mockAPI.incomeOverrides.remove).toHaveBeenCalled();
        expect(reloadSnapshot).toHaveBeenCalled();
      });
    });

    it('requires and confirms assignment warning for unusual drag-drop', async () => {
      renderWithRouter(<SchedulePage />, { mockAPI });
      fireEvent.click(screen.getByRole('button', { name: 'mock-drag-start-late' }));
      fireEvent.click(screen.getByRole('button', { name: 'mock-drop-late' }));
      fireEvent.click(await screen.findByRole('button', { name: 'confirm-assignment' }));

      await waitFor(() => {
        expect(assignBill).toHaveBeenCalled();
      });
    });

    it('expands and collapses recommendation insights panel', () => {
      mockUseData.mockReturnValue({
        incomes: [{ id: 'inc-1' }],
        bills: [{ id: 'bill-1' }],
        schedule: createMockSchedule({
          recommendations: ['Increase target cash buffer'],
          reconciliation: {
            needsReconciliation: false,
            shortfalls: [],
            totalDeficit: 0,
            proposedFixes: [],
          },
        }),
        generateSchedule,
        isLoading: false,
        scheduleStartDate: '2026-01-01',
        scheduleMonths: 3,
        scheduleStartingBalance: 1000,
        setScheduleStartDate: vi.fn(),
        setScheduleMonths: vi.fn(),
        setScheduleStartingBalance: vi.fn(),
      });

      renderWithRouter(<SchedulePage />, { mockAPI });
      fireEvent.click(screen.getByRole('button', { name: /Budget Insights/i }));
      expect(screen.getByText('Increase target cash buffer')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /Budget Insights/i }));
    });

    it('no-ops drag-drop when dropping on the same paycheck', async () => {
      renderWithRouter(<SchedulePage />, { mockAPI });
      fireEvent.click(screen.getByRole('button', { name: 'mock-drag-start' }));
      fireEvent.click(screen.getByRole('button', { name: 'mock-drop-same' }));
      expect(screen.queryByRole('button', { name: 'confirm-assignment' })).not.toBeInTheDocument();
      await waitFor(() => {
        expect(assignBill).not.toHaveBeenCalled();
      });
    });

    it('assigns bills through quick-budget IPC on drop', async () => {
      mockUseBudget.mockReturnValue({ isQuickBudget: true });
      mockAPI.billAssignments.assign = vi.fn().mockResolvedValue({ success: true });

      renderWithRouter(<SchedulePage />, { mockAPI });
      fireEvent.click(screen.getByRole('button', { name: 'mock-drag-start' }));
      fireEvent.click(screen.getByRole('button', { name: 'mock-drop' }));

      await waitFor(() => {
        expect(mockAPI.billAssignments.assign).toHaveBeenCalled();
        expect(reloadSnapshot).toHaveBeenCalled();
      });
    });
  });
});
