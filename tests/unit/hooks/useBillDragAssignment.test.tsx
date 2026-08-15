import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useBillDragAssignment } from '../../../src/hooks/useBillDragAssignment';
import { createMockElectronAPI } from '../../mocks/electron-api.mock';
import { needsAssignmentConfirmation } from '../../../src/utils/assignmentConstraints';

const showToast = vi.fn();
const assignBill = vi.fn();
const reloadSnapshot = vi.fn().mockResolvedValue(undefined);
const generateSchedule = vi.fn();
const budgetState = { isQuickBudget: true };

vi.mock('../../../src/components/Toast', () => ({
  useToast: () => ({ showToast, dismissToast: vi.fn() }),
}));

vi.mock('../../../src/context/BudgetContext', () => ({
  useBudget: () => budgetState,
}));

vi.mock('../../../src/context/DraftContext', () => ({
  useDraftActions: () => ({ assignBill, reloadSnapshot }),
  useSchedule: () => ({
    generateSchedule,
    scheduleStartDate: '2026-01-01',
    scheduleMonths: 3,
    scheduleStartingBalance: 500,
  }),
}));

vi.mock('../../../src/utils/assignmentConstraints', () => ({
  needsAssignmentConfirmation: vi.fn(() => false),
}));

function Harness() {
  const drag = useBillDragAssignment();
  return (
    <div>
      <button
        onClick={() =>
          drag.handleDragStart(
            {
              billId: 'bill-1',
              billDate: '2026-01-15',
              amount: 100,
              creditorName: 'Card',
              dueDay: 15,
              status: 'assigned',
            } as never,
            '2026-01-01'
          )
        }
      >
        drag-start
      </button>
      <button
        onClick={() =>
          drag.handleDragOver({ preventDefault: () => undefined } as never, '2026-01-01')
        }
      >
        drag-over-same
      </button>
      <button
        onClick={() =>
          drag.handleDragOver({ preventDefault: () => undefined } as never, '2026-01-10')
        }
      >
        drag-over
      </button>
      <button onClick={() => void drag.handleDrop({ preventDefault: () => undefined } as never, '2026-01-10')}>
        drop
      </button>
      <button onClick={() => void drag.handleConfirmAssignment()}>confirm</button>
      <div data-testid="pending">{drag.pendingAssignment ? 'yes' : 'no'}</div>
    </div>
  );
}

describe('useBillDragAssignment', () => {
  let mockAPI: ReturnType<typeof createMockElectronAPI>;

  beforeEach(() => {
    vi.clearAllMocks();
    budgetState.isQuickBudget = true;
    vi.mocked(needsAssignmentConfirmation).mockReturnValue(false);
    mockAPI = createMockElectronAPI();
    window.electronAPI = mockAPI as unknown as Window['electronAPI'];
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  describe('sad', () => {
    it('toasts assign failures with and without diagnostic copy actions', async () => {
      mockAPI.billAssignments.assign.mockResolvedValueOnce({
        success: false,
        error: 'assign failed',
        diagnosticId: 'diag-assign',
      });
      mockAPI.diagnostics.getEvent.mockResolvedValue({
        success: true,
        data: { errors: [{ id: 'diag-assign' }] },
      });

      render(<Harness />);
      fireEvent.click(screen.getByText('drag-start'));
      fireEvent.click(screen.getByText('drag-over-same'));
      fireEvent.click(screen.getByText('drag-over'));
      fireEvent.click(screen.getByText('drop'));
      await waitFor(() => {
        expect(showToast).toHaveBeenCalledWith(
          'error',
          'assign failed',
          expect.objectContaining({
            action: expect.objectContaining({ label: 'Copy report' }),
          })
        );
      });
      const action = showToast.mock.calls.at(-1)?.[2] as { action: { onClick: () => void } };
      await act(async () => {
        action.action.onClick();
      });
      expect(mockAPI.diagnostics.getEvent).toHaveBeenCalledWith('diag-assign');

      fireEvent.click(screen.getByText('drag-start'));
      mockAPI.billAssignments.assign.mockResolvedValueOnce({ success: false });
      fireEvent.click(screen.getByText('drop'));
      await waitFor(() => {
        expect(showToast).toHaveBeenCalledWith(
          'error',
          'Failed to assign bill',
          expect.objectContaining({ action: undefined })
        );
      });
    });
  });

  describe('happy', () => {
    it('reloads on quick-budget success and assigns in draft mode', async () => {
      mockAPI.billAssignments.assign.mockResolvedValueOnce({ success: true });
      render(<Harness />);
      fireEvent.click(screen.getByText('drag-start'));
      fireEvent.click(screen.getByText('drop'));
      await waitFor(() => {
        expect(reloadSnapshot).toHaveBeenCalled();
        expect(generateSchedule).toHaveBeenCalled();
      });

      budgetState.isQuickBudget = false;
      fireEvent.click(screen.getByText('drag-start'));
      fireEvent.click(screen.getByText('drop'));
      await waitFor(() => {
        expect(assignBill).toHaveBeenCalledWith('bill-1', '2026-01-15', '2026-01-10');
      });
    });

    it('queues confirmation then applies on confirm', async () => {
      vi.mocked(needsAssignmentConfirmation).mockReturnValue(true);
      mockAPI.billAssignments.assign.mockResolvedValue({ success: true });
      render(<Harness />);
      fireEvent.click(screen.getByText('drag-start'));
      fireEvent.click(screen.getByText('drop'));
      await waitFor(() => {
        expect(screen.getByTestId('pending')).toHaveTextContent('yes');
      });
      fireEvent.click(screen.getByText('confirm'));
      await waitFor(() => {
        expect(reloadSnapshot).toHaveBeenCalled();
        expect(screen.getByTestId('pending')).toHaveTextContent('no');
      });
    });
  });

  describe('hostile', () => {
    it('reports thrown assign errors and no-ops confirm without pending', async () => {
      mockAPI.billAssignments.assign.mockRejectedValueOnce(new Error('ipc down'));
      mockAPI.diagnostics.report.mockResolvedValue({ success: true, data: { id: 'diag-x' } });
      render(<Harness />);
      fireEvent.click(screen.getByText('confirm'));
      fireEvent.click(screen.getByText('drag-start'));
      fireEvent.click(screen.getByText('drop'));
      await waitFor(() => {
        expect(mockAPI.diagnostics.report).toHaveBeenCalled();
      });
    });
  });
});
