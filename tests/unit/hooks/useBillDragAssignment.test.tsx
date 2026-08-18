import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useBillDragAssignment } from '../../../src/hooks/useBillDragAssignment';
import { createMockElectronAPI } from '../../mocks/electron-api.mock';
import { needsAssignmentConfirmation } from '../../../src/utils/assignmentConstraints';

const assignBill = vi.fn();

vi.mock('../../../src/components/Toast', () => ({
  useToast: () => ({ showToast: vi.fn(), dismissToast: vi.fn() }),
}));

vi.mock('../../../src/context/DraftContext', () => ({
  useDraftActions: () => ({ assignBill }),
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
    vi.mocked(needsAssignmentConfirmation).mockReturnValue(false);
    mockAPI = createMockElectronAPI();
    window.electronAPI = mockAPI as unknown as Window['electronAPI'];
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  describe('sad', () => {
    it('reports thrown assign errors via diagnostics', async () => {
      assignBill.mockImplementationOnce(() => {
        throw new Error('assign failed');
      });
      mockAPI.diagnostics.report.mockResolvedValue({ success: true, data: { id: 'diag-assign' } });

      render(<Harness />);
      fireEvent.click(screen.getByText('drag-start'));
      fireEvent.click(screen.getByText('drag-over-same'));
      fireEvent.click(screen.getByText('drag-over'));
      fireEvent.click(screen.getByText('drop'));
      await waitFor(() => {
        expect(mockAPI.diagnostics.report).toHaveBeenCalled();
      });
    });
  });

  describe('happy', () => {
    it('assigns through draft actions on drop', async () => {
      render(<Harness />);
      fireEvent.click(screen.getByText('drag-start'));
      fireEvent.click(screen.getByText('drop'));
      await waitFor(() => {
        expect(assignBill).toHaveBeenCalledWith('bill-1', '2026-01-15', '2026-01-10');
      });
      expect(mockAPI.billAssignments.assign).not.toHaveBeenCalled();
    });

    it('queues confirmation then applies on confirm', async () => {
      vi.mocked(needsAssignmentConfirmation).mockReturnValue(true);
      render(<Harness />);
      fireEvent.click(screen.getByText('drag-start'));
      fireEvent.click(screen.getByText('drop'));
      await waitFor(() => {
        expect(screen.getByTestId('pending')).toHaveTextContent('yes');
      });
      fireEvent.click(screen.getByText('confirm'));
      await waitFor(() => {
        expect(assignBill).toHaveBeenCalledWith('bill-1', '2026-01-15', '2026-01-10');
        expect(screen.getByTestId('pending')).toHaveTextContent('no');
      });
    });
  });

  describe('hostile', () => {
    it('reports thrown assign errors and no-ops confirm without pending', async () => {
      assignBill.mockImplementationOnce(() => {
        throw new Error('ipc down');
      });
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
