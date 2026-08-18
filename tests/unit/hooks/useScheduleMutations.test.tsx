import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useScheduleMutations } from '../../../src/hooks/useScheduleMutations';
import { createMockElectronAPI } from '../../mocks/electron-api.mock';

const applyBreakGlassPlan = vi.fn(() => true);
const applyReconciliationFixes = vi.fn(() => true);
const clearBillAssignments = vi.fn();
const clearStaleBillAssignments = vi.fn();
const reloadSnapshot = vi.fn().mockResolvedValue(undefined);
const removeBillAssignment = vi.fn();
const removeIncomeOverride = vi.fn(() => true);
const setIncomeOverride = vi.fn(() => true);
const skipBill = vi.fn(() => true);
const unskipBill = vi.fn(() => true);
const generateSchedule = vi.fn().mockResolvedValue(undefined);
const budgetState = { isQuickBudget: true };
const draftDataState = {
  billAssignments: [
    { billId: 'bill-1', billDueDate: '2026-01-15', paycheckDate: '2026-01-10' },
  ],
};

vi.mock('../../../src/context/BudgetContext', () => ({
  useBudget: () => budgetState,
}));

vi.mock('../../../src/context/DraftContext', () => ({
  useDraftActions: () => ({
    applyBreakGlassPlan,
    applyReconciliationFixes,
    clearBillAssignments,
    clearStaleBillAssignments,
    reloadSnapshot,
    removeBillAssignment,
    removeIncomeOverride,
    setIncomeOverride,
    skipBill,
    unskipBill,
  }),
  useDraftData: () => draftDataState,
  useSchedule: () => ({
    schedule: {
      breakGlassAdvisor: {
        plans: [
          {
            id: 'plan-1',
            steps: [
              {
                billId: 'bill-1',
                billDueDate: '2026-01-15',
                fromPaycheckDate: '2026-01-01',
                toPaycheckDate: '2026-01-10',
              },
            ],
          },
        ],
      },
    },
    generateSchedule,
    scheduleStartDate: '2026-01-01',
    scheduleMonths: 3,
    scheduleStartingBalance: 1000,
  }),
}));

function Harness() {
  const m = useScheduleMutations();
  return (
    <div>
      <button
        onClick={() =>
          void m.handleApplyFixes([
            {
              id: 'fix-1',
              type: 'move_bill',
              billId: 'bill-1',
              billDueDate: '2026-01-15',
              fromPaycheckDate: '2026-01-01',
              toPaycheckDate: '2026-01-10',
            },
          ])
        }
      >
        apply-fixes
      </button>
      <button
        onClick={() =>
          void m.handleAcceptBreakGlassPlan({
            id: 'plan-1',
            steps: [
              {
                billId: 'bill-1',
                billDueDate: '2026-01-15',
                fromPaycheckDate: '2026-01-01',
                toPaycheckDate: '2026-01-10',
              },
            ],
          } as never)
        }
      >
        accept-plan
      </button>
      <button onClick={() => void m.handleSkipBill('bill-1', '2026-01-15')}>skip</button>
      <button onClick={() => void m.handleUnskipBill('bill-1', '2026-01-15')}>unskip</button>
      <button onClick={() => void m.handleRestoreBill('bill-1', '2026-01-15')}>restore</button>
      <button onClick={() => void m.handleRestoreAllBills()}>restore-all</button>
      <button onClick={() => void m.handleClearStaleBills(new Set(['2026-02-01']))}>
        clear-stale
      </button>
      <button
        onClick={() => void m.handleSaveIncomeOverride('income-1', '2026-01-10', 500)}
      >
        save-override
      </button>
      <button
        onClick={() => void m.handleClearIncomeOverride('income-1', '2026-01-10')}
      >
        remove-override
      </button>
    </div>
  );
}

describe('useScheduleMutations', () => {
  let mockAPI: ReturnType<typeof createMockElectronAPI>;

  beforeEach(() => {
    vi.clearAllMocks();
    budgetState.isQuickBudget = true;
    draftDataState.billAssignments = [
      { billId: 'bill-1', billDueDate: '2026-01-15', paycheckDate: '2026-01-10' },
    ];
    skipBill.mockReturnValue(true);
    unskipBill.mockReturnValue(true);
    setIncomeOverride.mockReturnValue(true);
    removeIncomeOverride.mockReturnValue(true);
    applyReconciliationFixes.mockReturnValue(true);
    applyBreakGlassPlan.mockReturnValue(true);
    mockAPI = createMockElectronAPI();
    window.electronAPI = mockAPI as unknown as Window['electronAPI'];
  });

  describe('sad', () => {
    it('applies reconciliation and break-glass via draft plus preferredAssignments', async () => {
      render(<Harness />);
      fireEvent.click(screen.getByText('apply-fixes'));
      fireEvent.click(screen.getByText('accept-plan'));

      await waitFor(() => {
        expect(applyReconciliationFixes).toHaveBeenCalled();
        expect(applyBreakGlassPlan).toHaveBeenCalled();
        expect(generateSchedule).toHaveBeenCalledWith('2026-01-01', 3, 1000, {
          force: true,
          preferredAssignments: [['bill-1-2026-01-15', '2026-01-10']],
        });
      });
    });

    it('covers draft skip/unskip/restore success and no-op failure paths', async () => {
      skipBill.mockReturnValueOnce(false);
      unskipBill.mockReturnValueOnce(true);
      setIncomeOverride.mockReturnValueOnce(false);
      removeIncomeOverride.mockReturnValueOnce(false);

      render(<Harness />);
      fireEvent.click(screen.getByText('skip'));
      fireEvent.click(screen.getByText('unskip'));
      fireEvent.click(screen.getByText('restore'));
      fireEvent.click(screen.getByText('restore-all'));
      fireEvent.click(screen.getByText('clear-stale'));
      fireEvent.click(screen.getByText('save-override'));
      fireEvent.click(screen.getByText('remove-override'));

      await waitFor(() => {
        expect(unskipBill).toHaveBeenCalled();
        expect(removeBillAssignment).toHaveBeenCalled();
        expect(clearBillAssignments).toHaveBeenCalled();
        expect(clearStaleBillAssignments).toHaveBeenCalled();
      });
      expect(mockAPI.skippedBills.skip).not.toHaveBeenCalled();
      expect(generateSchedule).toHaveBeenCalled();
    });
  });

  describe('hostile', () => {
    it('reports thrown errors from apply/skip handlers', async () => {
      applyReconciliationFixes.mockImplementationOnce(() => {
        throw new Error('boom');
      });
      skipBill.mockImplementationOnce(() => {
        throw new Error('skip boom');
      });
      mockAPI.diagnostics.report.mockResolvedValue({ success: true, data: { id: 'diag-x' } });

      render(<Harness />);
      fireEvent.click(screen.getByText('apply-fixes'));
      fireEvent.click(screen.getByText('skip'));

      await waitFor(() => {
        expect(mockAPI.diagnostics.report).toHaveBeenCalled();
      });
    });

    it('covers draft-mode success paths and empty assignment early returns', async () => {
      budgetState.isQuickBudget = false;

      const first = render(<Harness />);
      fireEvent.click(screen.getByText('apply-fixes'));
      fireEvent.click(screen.getByText('accept-plan'));
      fireEvent.click(screen.getByText('skip'));
      fireEvent.click(screen.getByText('unskip'));
      fireEvent.click(screen.getByText('restore'));
      fireEvent.click(screen.getByText('restore-all'));
      fireEvent.click(screen.getByText('clear-stale'));
      fireEvent.click(screen.getByText('save-override'));
      fireEvent.click(screen.getByText('remove-override'));

      await waitFor(() => {
        expect(applyReconciliationFixes).toHaveBeenCalled();
        expect(generateSchedule).toHaveBeenCalled();
        expect(clearBillAssignments).toHaveBeenCalled();
        expect(clearStaleBillAssignments).toHaveBeenCalled();
      });
      first.unmount();

      applyReconciliationFixes.mockReturnValueOnce(false);
      applyBreakGlassPlan.mockReturnValueOnce(false);
      skipBill.mockReturnValueOnce(false);
      unskipBill.mockReturnValueOnce(false);
      setIncomeOverride.mockReturnValueOnce(false);
      removeIncomeOverride.mockReturnValueOnce(false);
      const second = render(<Harness />);
      fireEvent.click(screen.getByText('apply-fixes'));
      fireEvent.click(screen.getByText('accept-plan'));
      fireEvent.click(screen.getByText('skip'));
      fireEvent.click(screen.getByText('unskip'));
      fireEvent.click(screen.getByText('save-override'));
      fireEvent.click(screen.getByText('remove-override'));
      second.unmount();

      draftDataState.billAssignments = [];
      render(<Harness />);
      fireEvent.click(screen.getByText('restore-all'));
      fireEvent.click(screen.getByText('clear-stale'));
      expect(clearBillAssignments).toHaveBeenCalledTimes(1);
    });

    it('covers restore when draft assignment removal is a no-op', async () => {
      render(<Harness />);
      fireEvent.click(screen.getByText('apply-fixes'));
      fireEvent.click(screen.getByText('restore'));
      fireEvent.click(screen.getByText('unskip'));
      await waitFor(() => {
        expect(generateSchedule).toHaveBeenCalled();
        expect(removeBillAssignment).toHaveBeenCalled();
        expect(unskipBill).toHaveBeenCalled();
      });
      expect(mockAPI.billAssignments.remove).not.toHaveBeenCalled();
    });
  });
});
