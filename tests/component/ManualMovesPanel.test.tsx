import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import ManualMovesPanel from '../../src/components/schedule/ManualMovesPanel';
import type { Bill, BillAssignment } from '../../src/types';

vi.mock('../../src/components/ConfirmDialog', () => ({
  default: ({
    isOpen,
    onConfirm,
    onClose,
    title,
  }: {
    isOpen: boolean;
    onConfirm: () => void;
    onClose: () => void;
    title: string;
  }) =>
    isOpen ? (
      <div>
        <div>{title}</div>
        <button onClick={onConfirm}>confirm-dialog</button>
        <button onClick={onClose}>cancel-dialog</button>
      </div>
    ) : null,
}));

vi.mock('../../src/components/Modal', () => ({
  default: ({
    isOpen,
    onClose,
    title,
    children,
  }: {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: ReactNode;
  }) =>
    isOpen ? (
      <div>
        <div>{title}</div>
        <button onClick={onClose}>close-modal</button>
        {children}
      </div>
    ) : null,
}));

const bills: Bill[] = [
  {
    id: 'bill-1',
    creditorName: 'Rent',
    budgetedAmount: 1200,
    dueDay: 1,
    isRecurring: true,
    priority: 'critical',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'bill-2',
    creditorName: 'Electric',
    budgetedAmount: 150,
    dueDay: 15,
    isRecurring: true,
    priority: 'normal',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

const assignments: BillAssignment[] = [
  {
    id: 'a-1',
    billId: 'bill-1',
    billDueDate: '2026-02-01',
    paycheckDate: '2026-01-15',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'a-2',
    billId: 'bill-2',
    billDueDate: '2026-01-15',
    paycheckDate: '2026-03-01',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'a-3',
    billId: 'gone-bill',
    billDueDate: '2026-04-01',
    paycheckDate: '2026-01-15',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
];

function renderPanel(overrides: Partial<ComponentProps<typeof ManualMovesPanel>> = {}) {
  return render(
    <ManualMovesPanel
      assignments={assignments}
      bills={bills}
      paycheckDates={['2026-01-15']}
      onRestoreBill={vi.fn()}
      onRestoreAll={vi.fn()}
      onClearStale={vi.fn()}
      restoringBill={null}
      isRestoringAll={false}
      isClearingStale={false}
      {...overrides}
    />
  );
}

describe('ManualMovesPanel', () => {
  it('renders nothing when there are no assignments', () => {
    const { container } = renderPanel({ assignments: [] });
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a compact summary banner without dumping the full list', () => {
    renderPanel();

    expect(screen.getByTestId('manual-moves-panel')).toBeInTheDocument();
    expect(screen.getByTestId('manual-moves-summary')).toHaveTextContent('3 locks');
    expect(screen.getByTestId('manual-moves-summary')).toHaveTextContent('across 3 bills');
    expect(screen.getByTestId('manual-moves-summary')).toHaveTextContent('1 outside the schedule');
    expect(screen.queryByTestId('manual-moves-list')).not.toBeInTheDocument();
    expect(screen.getByTestId('manual-moves-restore-all')).toBeInTheDocument();
    expect(screen.getByTestId('manual-moves-clear-stale')).toHaveTextContent('Clear stale (1)');
  });

  it('opens review modal with rows, stale badges, and deleted-bill labels', () => {
    renderPanel();

    fireEvent.click(screen.getByTestId('manual-moves-review'));
    expect(screen.getByTestId('manual-moves-list')).toBeInTheDocument();
    expect(screen.getByText('Rent')).toBeInTheDocument();
    expect(screen.getByText('Electric')).toBeInTheDocument();
    expect(screen.getByText('Deleted bill')).toBeInTheDocument();
    expect(screen.getByTestId('manual-move-stale-bill-2-2026-01-15')).toHaveTextContent('Stale');
    expect(screen.queryByTestId('manual-move-stale-bill-1-2026-02-01')).not.toBeInTheDocument();
  });

  it('calls onRestoreBill from the review modal', () => {
    const onRestoreBill = vi.fn();
    renderPanel({
      onRestoreBill,
      paycheckDates: ['2026-01-15', '2026-03-01'],
    });

    fireEvent.click(screen.getByTestId('manual-moves-review'));
    fireEvent.click(screen.getByTestId('manual-move-restore-bill-1-2026-02-01'));
    expect(onRestoreBill).toHaveBeenCalledWith('bill-1', '2026-02-01');
  });

  it('confirms before calling onRestoreAll', () => {
    const onRestoreAll = vi.fn();
    renderPanel({ onRestoreAll, paycheckDates: ['2026-01-15', '2026-03-01'] });

    fireEvent.click(screen.getByTestId('manual-moves-restore-all'));
    expect(onRestoreAll).not.toHaveBeenCalled();
    expect(screen.getByText('Restore all manual moves?')).toBeInTheDocument();

    fireEvent.click(screen.getByText('confirm-dialog'));
    expect(onRestoreAll).toHaveBeenCalledTimes(1);
  });

  it('confirms before clearing stale locks', () => {
    const onClearStale = vi.fn();
    renderPanel({ onClearStale });

    fireEvent.click(screen.getByTestId('manual-moves-clear-stale'));
    expect(onClearStale).not.toHaveBeenCalled();
    expect(screen.getByText('Clear stale locks?')).toBeInTheDocument();

    fireEvent.click(screen.getByText('confirm-dialog'));
    expect(onClearStale).toHaveBeenCalledTimes(1);
    const dates = onClearStale.mock.calls[0][0] as Set<string>;
    expect(dates.has('2026-01-15')).toBe(true);
    expect(dates.has('2026-03-01')).toBe(false);
  });

  it('uses singular copy for one active lock and shows busy labels while restoring', () => {
    renderPanel({
      assignments: [assignments[0]],
      paycheckDates: ['2026-01-15'],
      isRestoringAll: true,
    });

    expect(screen.getByTestId('manual-moves-summary')).toHaveTextContent('1 lock');
    expect(screen.getByTestId('manual-moves-summary')).toHaveTextContent('across 1 bill');
    expect(screen.getByTestId('manual-moves-summary')).not.toHaveTextContent('outside the schedule');
    expect(screen.getByTestId('manual-moves-restore-all')).toHaveTextContent('Restoring…');
    expect(screen.getByTestId('manual-moves-restore-all')).toBeDisabled();
    expect(screen.getByTestId('manual-moves-review')).toBeDisabled();
  });

  it('notes remaining active locks when some assignments are stale', () => {
    renderPanel({
      assignments: [assignments[0], assignments[1]],
      paycheckDates: ['2026-01-15'],
    });

    expect(screen.getByText(/1 active lock still force paycheck placement/i)).toBeInTheDocument();
  });

  it('shows clearing label while stale locks are being removed', () => {
    renderPanel({ isClearingStale: true });
    expect(screen.getByTestId('manual-moves-clear-stale')).toHaveTextContent('Clearing…');
    expect(screen.getByTestId('manual-moves-clear-stale')).toBeDisabled();
  });
});
