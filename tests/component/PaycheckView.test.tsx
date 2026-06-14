import { describe, it, expect, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PaycheckView from '../../src/components/schedule/PaycheckView';
import { createMockPaycheck } from '../mocks/electron-api.mock';
import { renderWithRouter } from '../helpers/renderWithProviders';

const formatCurrency = (v: number) => `$${v.toFixed(2)}`;

function baseProps() {
  const paycheck = createMockPaycheck({
    date: '2026-01-15',
    incomeSources: [{ id: 'inc-1', name: 'Salary', amount: 2000 }],
    bills: [
      {
        billId: 'bill-1',
        creditorName: 'Rent',
        amount: 900,
        dueDay: 1,
        billDate: '2026-01-01',
        priority: 'critical',
        isIncomeAttached: false,
      },
    ],
  });

  return {
    paychecks: [paycheck],
    expandedPaychecks: new Set<string>(),
    togglePaycheck: vi.fn(),
    expandAll: vi.fn(),
    collapseAll: vi.fn(),
    formatCurrency,
    maxBudgetRemaining: 500,
    onSkipBill: vi.fn(),
    skippingBill: null,
    onRestoreBill: vi.fn(),
    restoringBill: null,
    onDragStart: vi.fn(),
    onDragEnd: vi.fn(),
    onDragOver: vi.fn(),
    onDragLeave: vi.fn(),
    onDrop: vi.fn(),
    draggedBill: null,
    dropTargetDate: null,
    billAssignments: [],
    isAssigning: false,
    incomeOverrides: [],
    onSaveIncomeOverride: vi.fn(async () => {}),
    onClearIncomeOverride: vi.fn(async () => {}),
    savingIncomeKey: null,
  };
}

describe('PaycheckView', () => {
  describe('happy', () => {
    it('renders paycheck list and expand/collapse controls', async () => {
      const user = userEvent.setup();
      const props = baseProps();
      renderWithRouter(<PaycheckView {...props} />);

      expect(screen.getByText('Paychecks (1)')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Expand All' }));
      await user.click(screen.getByRole('button', { name: 'Collapse All' }));
      await user.click(screen.getByLabelText(/Expand paycheck for/i));

      expect(props.expandAll).toHaveBeenCalledTimes(1);
      expect(props.collapseAll).toHaveBeenCalledTimes(1);
      expect(props.togglePaycheck).toHaveBeenCalledWith('2026-01-15');
    });
  });

  describe('sad', () => {
    it('shows empty-state text with no paychecks', () => {
      const props = baseProps();
      renderWithRouter(<PaycheckView {...props} paychecks={[]} />);
      expect(screen.getByText('No paychecks in the selected period')).toBeInTheDocument();
    });
  });

  describe('hostile', () => {
    it('handles expanded paycheck bill actions', () => {
      const props = baseProps();
      const expandedDate = '2026-01-15';
      renderWithRouter(
        <PaycheckView
          {...props}
          expandedPaychecks={new Set([expandedDate])}
          billAssignments={[{ id: 'a1', billId: 'bill-1', billDueDate: '2026-01-01', paycheckDate: expandedDate, createdAt: '2026-01-01T00:00:00.000Z' }]}
        />
      );

      fireEvent.click(screen.getByTitle('Skip this payment (already paid or not due)'));
      fireEvent.click(screen.getByTitle('Restore to original paycheck'));
      const rentRow = screen.getByText('Rent').closest('div[draggable="true"]');
      const paycheckCard = screen.getByLabelText(/Collapse paycheck for/i).closest('div.card');
      expect(rentRow).toBeTruthy();
      expect(paycheckCard).toBeTruthy();
      fireEvent.dragStart(rentRow!);
      fireEvent.dragOver(paycheckCard!);
      fireEvent.dragLeave(paycheckCard!);
      fireEvent.drop(paycheckCard!);
      fireEvent.dragEnd(rentRow!);

      expect(props.onSkipBill).toHaveBeenCalledWith('bill-1', '2026-01-15');
      expect(props.onRestoreBill).toHaveBeenCalledWith('bill-1', '2026-01-01');
      expect(props.onDragStart).toHaveBeenCalledWith(expect.objectContaining({ billId: 'bill-1' }), '2026-01-15');
      expect(props.onDragOver).toHaveBeenCalled();
      expect(props.onDragLeave).toHaveBeenCalled();
      expect(props.onDrop).toHaveBeenCalled();
      expect(props.onDragEnd).toHaveBeenCalled();
    });

    it('edits paycheck income and clears override', async () => {
      const props = baseProps();
      const expandedDate = '2026-01-15';
      renderWithRouter(
        <PaycheckView
          {...props}
          expandedPaychecks={new Set([expandedDate])}
          incomeOverrides={[
            {
              id: 'ov-1',
              incomeId: 'inc-1',
              paycheckDate: expandedDate,
              amount: 2200,
              createdAt: '2026-01-01T00:00:00.000Z',
            },
          ]}
        />
      );

      fireEvent.click(screen.getByTitle('Edit gross income for this paycheck'));
      fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '2300' } });
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      fireEvent.click(screen.getByTitle('Edit gross income for this paycheck'));
      fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '2300' } });
      fireEvent.click(screen.getByRole('button', { name: /^Save$/i }));

      await waitFor(() => {
        expect(props.onSaveIncomeOverride).toHaveBeenCalledWith('inc-1', expandedDate, 2300);
      });

      fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
      expect(props.onClearIncomeOverride).toHaveBeenCalledWith('inc-1', expandedDate);
    });

    it('renders shortfall styling and unpayable bill indicators', () => {
      const props = baseProps();
      const expandedDate = '2026-01-15';
      renderWithRouter(
        <PaycheckView
          {...props}
          expandedPaychecks={new Set([expandedDate])}
          paychecks={[
            createMockPaycheck({
              date: expandedDate,
              isShortfall: true,
              budgetRemaining: -50,
              bills: [
                {
                  billId: 'bill-1',
                  creditorName: 'Rent',
                  amount: 900,
                  dueDay: 1,
                  billDate: '2026-01-01',
                  priority: 'critical',
                  isIncomeAttached: false,
                  isUnpayable: true,
                  unfundableReason: 'insufficient_funds',
                },
                {
                  billId: 'bill-2',
                  creditorName: '401k',
                  amount: 100,
                  dueDay: 15,
                  billDate: '2026-01-15',
                  priority: 'normal',
                  isIncomeAttached: true,
                },
              ],
            }),
          ]}
        />
      );

      expect(screen.getByText('Unpayable')).toBeInTheDocument();
      expect(screen.getByText('Per Paycheck')).toBeInTheDocument();
      expect(screen.getAllByText('$-50.00').length).toBeGreaterThan(0);
    });
  });
});
