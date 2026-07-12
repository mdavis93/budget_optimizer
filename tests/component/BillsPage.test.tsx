import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BillsPage from '../../src/pages/BillsPage';
import { createMockBill, createMockIncome } from '../mocks/electron-api.mock';

const mockUseData = vi.fn();

vi.mock('../../src/context/DraftContext', () => ({
  useDraftData: () => {
    const data = mockUseData();
    return { bills: data.bills, incomes: data.incomes };
  },
  useDraftActions: () => mockUseData(),
}));

describe('BillsPage', () => {
  const createBill = vi.fn(async () => true);
  const updateBill = vi.fn(async () => true);
  const deleteBill = vi.fn(async () => true);
  const incomes = [createMockIncome({ id: 'inc-1', sourceName: 'Salary', isActive: true })];

  beforeEach(() => {
    vi.clearAllMocks();
    createBill.mockResolvedValue(true);
    updateBill.mockResolvedValue(true);
    deleteBill.mockResolvedValue(true);
    mockUseData.mockReturnValue({
      bills: [
        createMockBill({
          id: 'bill-1',
          creditorName: 'Internet',
          budgetedAmount: 80,
          dueDay: 5,
          priority: 'high',
          category: 'utilities',
        }),
        createMockBill({
          id: 'bill-2',
          creditorName: 'Rent',
          budgetedAmount: 1200,
          dueDay: 1,
          priority: 'critical',
          category: 'housing',
        }),
      ],
      incomes,
      createBill,
      updateBill,
      deleteBill,
    });
  });

  describe('happy', () => {
    it('renders bill rows with amount', () => {
      render(<BillsPage />);
      expect(screen.getByText('Internet')).toBeInTheDocument();
      expect(screen.getAllByText('$80.00').length).toBeGreaterThan(0);
      expect(screen.getByText(/Due:\s*5th/)).toBeInTheDocument();
    });
  });

  describe('sad', () => {
    it('shows empty state when no bills are available', () => {
      mockUseData.mockReturnValue({
        bills: [],
        incomes,
        createBill,
        updateBill,
        deleteBill,
      });

      render(<BillsPage />);
      expect(screen.getByText('No bills added')).toBeInTheDocument();
    });
  });

  describe('hostile', () => {
    it('creates, edits, deletes, and filters bills', async () => {
      const user = userEvent.setup();
      render(<BillsPage />);

      await user.click(screen.getByRole('button', { name: /Add Bill/i }));
      fireEvent.change(screen.getByLabelText('Creditor / Vendor Name'), { target: { value: 'Phone' } });
      fireEvent.change(screen.getByLabelText('Budgeted Amount'), { target: { value: '65' } });
      await user.click(screen.getByRole('button', { name: 'Per Paycheck' }));
      await user.selectOptions(screen.getByLabelText('Attach to Income Source'), 'inc-1');
      await user.click(screen.getAllByRole('button', { name: 'Add Bill' }).at(-1)!);

      await waitFor(() => {
        expect(createBill).toHaveBeenCalledWith(
          expect.objectContaining({
            creditorName: 'Phone',
            budgetedAmount: 65,
            dueDay: 1,
            isIncomeAttached: true,
            preferredIncomeSourceId: 'inc-1',
          })
        );
      });

      await user.click(screen.getAllByRole('button', { name: /Add Bill/i })[0]);
      fireEvent.change(screen.getByLabelText('Creditor / Vendor Name'), { target: { value: 'Gym' } });
      fireEvent.change(screen.getByLabelText('Budgeted Amount'), { target: { value: '40' } });
      await user.selectOptions(screen.getByLabelText('Due Day of Month'), '15');
      await user.selectOptions(screen.getByLabelText(/Preferred Income Source \(Optional\)/i), 'inc-1');
      await user.selectOptions(screen.getByLabelText(/Category \(Optional\)/i), 'Healthcare');
      await user.click(screen.getByRole('button', { name: 'Critical' }));
      await user.click(screen.getByLabelText('Recurring monthly bill'));
      await user.click(screen.getAllByRole('button', { name: 'Add Bill' }).at(-1)!);

      await waitFor(() => {
        expect(createBill).toHaveBeenCalledWith(
          expect.objectContaining({
            creditorName: 'Gym',
            dueDay: 15,
            preferredIncomeSourceId: 'inc-1',
            category: 'Healthcare',
            priority: 'critical',
            isRecurring: false,
            isIncomeAttached: false,
          })
        );
      });

      await user.click(screen.getByRole('button', { name: /Edit Internet/i }));
      fireEvent.change(screen.getByLabelText('Creditor / Vendor Name'), {
        target: { value: 'Fiber Internet' },
      });
      await user.click(screen.getByRole('button', { name: 'Update Bill' }));

      await waitFor(() => {
        expect(updateBill).toHaveBeenCalledWith(
          'bill-1',
          expect.objectContaining({
            creditorName: 'Fiber Internet',
          })
        );
      });

      await user.click(screen.getByRole('button', { name: /Delete Internet/i }));
      await user.click(screen.getByRole('button', { name: /^Delete$/i }));
      await waitFor(() => {
        expect(deleteBill).toHaveBeenCalledWith('bill-1');
      });

      await user.click(screen.getByRole('button', { name: 'housing' }));
      expect(screen.queryByText('Internet')).not.toBeInTheDocument();
      expect(screen.getByText('Rent')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /All/i }));
      await user.click(screen.getByRole('button', { name: /Amount/i }));
      await user.click(screen.getByRole('button', { name: /Due date/i }));
      await user.click(screen.getByRole('button', { name: /Default/i }));

      await user.click(screen.getAllByRole('button', { name: /Add Bill/i })[0]);
      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      await user.click(screen.getByRole('button', { name: /Edit Rent/i }));
      await user.click(screen.getByRole('button', { name: 'Cancel' }));
    }, 15000);

    it('keeps add modal open when createBill returns false', async () => {
      createBill.mockResolvedValue(false);
      const user = userEvent.setup();
      render(<BillsPage />);

      await user.click(screen.getByRole('button', { name: /Add Bill/i }));
      fireEvent.change(screen.getByLabelText('Creditor / Vendor Name'), { target: { value: 'Phone' } });
      fireEvent.change(screen.getByLabelText('Budgeted Amount'), { target: { value: '65' } });
      await user.click(screen.getAllByRole('button', { name: 'Add Bill' }).at(-1)!);

      await waitFor(() => {
        expect(createBill).toHaveBeenCalled();
      });
      expect(screen.getByRole('dialog', { name: /Add Bill/i })).toBeInTheDocument();
    });

    it('opens add modal from empty-state action', async () => {
      mockUseData.mockReturnValue({
        bills: [],
        incomes,
        createBill,
        updateBill,
        deleteBill,
      });
      const user = userEvent.setup();
      render(<BillsPage />);

      const emptyState = screen.getByText('No bills added').parentElement as HTMLElement;
      await user.click(within(emptyState).getByRole('button', { name: /Add Bill/i }));
      expect(screen.getByRole('dialog', { name: /Add Bill/i })).toBeInTheDocument();
    });

    it('shows estimated total label and per-paycheck bill details', () => {
      mockUseData.mockReturnValue({
        bills: [
          createMockBill({
            id: 'bill-3',
            creditorName: '401k',
            budgetedAmount: 200,
            priority: 'normal',
            isIncomeAttached: true,
            preferredIncomeSourceId: 'inc-1',
            category: undefined,
          }),
          createMockBill({
            id: 'bill-4',
            creditorName: 'Gym',
            budgetedAmount: 30,
            priority: 'low',
            isRecurring: false,
            dueDay: 10,
          }),
        ],
        incomes,
        createBill,
        updateBill,
        deleteBill,
      });

      render(<BillsPage />);
      expect(screen.getByText(/Total Monthly Bills \(estimated\)/)).toBeInTheDocument();
      expect(screen.getByText(/Per Paycheck: Salary/)).toBeInTheDocument();
      expect(screen.getByText('One-time')).toBeInTheDocument();
      expect(screen.getByText('Low')).toBeInTheDocument();
    });

    it('shows unknown income source when preferred income id is missing', () => {
      mockUseData.mockReturnValue({
        bills: [
          createMockBill({
            id: 'bill-5',
            creditorName: 'Savings',
            budgetedAmount: 100,
            isIncomeAttached: true,
            preferredIncomeSourceId: 'missing-inc',
          }),
        ],
        incomes,
        createBill,
        updateBill,
        deleteBill,
      });

      render(<BillsPage />);
      expect(screen.getByText(/Per Paycheck: Unknown/)).toBeInTheDocument();
    });

    it('filters by utilities category and keeps edit modal open on failed update', async () => {
      updateBill.mockResolvedValue(false);
      const user = userEvent.setup();
      render(<BillsPage />);

      await user.click(screen.getByRole('button', { name: 'utilities' }));
      expect(screen.getByText('Internet')).toBeInTheDocument();
      expect(screen.queryByText('Rent')).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /Edit Internet/i }));
      await user.click(screen.getByRole('button', { name: 'Update Bill' }));
      await waitFor(() => {
        expect(updateBill).toHaveBeenCalled();
      });
      expect(screen.getByRole('dialog', { name: /Edit Bill/i })).toBeInTheDocument();
    });
  });
});
