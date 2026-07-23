import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import IncomePage from '../../src/pages/IncomePage';
import { createMockIncome, createMockLeave } from '../mocks/electron-api.mock';

const mockUseData = vi.fn();
const mockUseBudget = vi.fn();

vi.mock('../../src/context/DraftContext', () => ({
  useDraftData: () => ({
    incomes: mockUseData().incomes,
    leaves: mockUseData().leaves ?? [],
    budgetFields: mockUseData().budgetFields ?? null,
  }),
  useDraftActions: () => mockUseData(),
}));

vi.mock('../../src/context/BudgetContext', () => ({
  useBudget: () => mockUseBudget(),
}));

describe('IncomePage', () => {
  const createIncome = vi.fn(async () => true);
  const updateIncome = vi.fn(async () => true);
  const deleteIncome = vi.fn(async () => true);
  const createLeave = vi.fn(() => true);
  const updateLeave = vi.fn(() => true);
  const deleteLeave = vi.fn(() => true);

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseBudget.mockReturnValue({
      currentBudget: {
        id: 'budget-1',
        targetCashOnHand: 250,
        minCashOnHand: 100,
      },
    });
    mockUseData.mockReturnValue({
      incomes: [createMockIncome({ sourceName: 'Primary Job', amount: 2500, startDate: '2026-01-01' })],
      leaves: [],
      budgetFields: null,
      createIncome,
      updateIncome,
      deleteIncome,
      createLeave,
      updateLeave,
      deleteLeave,
    });
  });

  describe('happy', () => {
    it('renders income list details', () => {
      render(<IncomePage />);
      expect(screen.getByText('Primary Job')).toBeInTheDocument();
      expect(screen.getByText('$2,500.00')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Edit Primary Job/i })).toBeInTheDocument();
    });

    it('shows end date on income card when set', () => {
      mockUseData.mockReturnValue({
        incomes: [
          createMockIncome({
            sourceName: 'Side Gig',
            amount: 500,
            startDate: '2026-01-01',
            endDate: '2026-08-31',
          }),
        ],
        leaves: [],
        createIncome,
        updateIncome,
        deleteIncome,
        createLeave,
        updateLeave,
        deleteLeave,
      });

      render(<IncomePage />);
      expect(screen.getByText(/Ending Aug 31, 2026/i)).toBeInTheDocument();
    });
  });

  describe('sad', () => {
    it('shows empty state when there are no income sources', () => {
      mockUseData.mockReturnValue({
        incomes: [],
        leaves: [],
        createIncome,
        updateIncome,
        deleteIncome,
        createLeave,
        updateLeave,
        deleteLeave,
      });

      render(<IncomePage />);
      expect(screen.getByText('No income sources')).toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: /Add Income/i }).length).toBeGreaterThan(0);
    });
  });

  describe('hostile', () => {
    it('submits end date when enabled on add income form', async () => {
      const user = userEvent.setup();
      render(<IncomePage />);
      await user.click(screen.getAllByRole('button', { name: /Add Income/i })[0]);

      fireEvent.change(screen.getByLabelText('Income Source Name'), { target: { value: 'Temp Job' } });
      fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '1200' } });
      await user.click(screen.getByText('Set an end date (last payment)').closest('div')!.querySelector('button')!);
      fireEvent.change(screen.getByLabelText('Ends On (Last Payment)'), { target: { value: '2026-12-31' } });
      await user.click(screen.getAllByRole('button', { name: 'Add Income' })[1]);

      await waitFor(() => {
        expect(createIncome).toHaveBeenCalledWith(
          expect.objectContaining({ endDate: '2026-12-31' })
        );
      });
    });

    it('submits add, edit, and delete income actions', async () => {
      const user = userEvent.setup();
      render(<IncomePage />);
      await user.click(screen.getAllByRole('button', { name: /Add Income/i })[0]);

      fireEvent.change(screen.getByLabelText('Income Source Name'), { target: { value: 'Freelance' } });
      fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '900' } });
      fireEvent.change(screen.getByLabelText('Start Date (First Payment)'), { target: { value: '2026-03-15' } });
      await user.click(screen.getAllByRole('button', { name: 'Add Income' })[1]);

      await waitFor(() => {
        expect(createIncome).toHaveBeenCalledWith(
          expect.objectContaining({
            sourceName: 'Freelance',
            amount: 900,
            startDate: '2026-03-15',
          })
        );
      });

      await user.click(screen.getAllByRole('button', { name: /Add Income/i })[0]);
      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      await user.click(screen.getByRole('button', { name: /Edit Primary Job/i }));
      fireEvent.change(screen.getByLabelText('Income Source Name'), {
        target: { value: 'Primary Job Updated' },
      });
      await user.click(screen.getByRole('button', { name: 'Update Income' }));
      await waitFor(() => {
        expect(updateIncome).toHaveBeenCalledWith(
          'income-1',
          expect.objectContaining({ sourceName: 'Primary Job Updated' })
        );
      });

      await user.click(screen.getByRole('button', { name: /Delete Primary Job/i }));
      await user.click(screen.getByRole('button', { name: /^Delete$/i }));
      await waitFor(() => {
        expect(deleteIncome).toHaveBeenCalledWith('income-1');
      });
    });

    it('updates cadence and active status when editing income', async () => {
      const user = userEvent.setup();
      render(<IncomePage />);

      await user.click(screen.getByRole('button', { name: /Edit Primary Job/i }));
      await user.selectOptions(screen.getByLabelText('Payment Frequency'), 'monthly');
      await user.click(screen.getByText('Active Income Source').closest('div')!.querySelector('button')!);
      await user.click(screen.getByRole('button', { name: 'Update Income' }));

      await waitFor(() => {
        expect(updateIncome).toHaveBeenCalledWith(
          'income-1',
          expect.objectContaining({ cadence: 'monthly', isActive: false })
        );
      });
    });
  });


  describe('leave', () => {
    it('shows leave CTA gated on income sources', () => {
      mockUseData.mockReturnValue({
        incomes: [],
        leaves: [],
        createIncome,
        updateIncome,
        deleteIncome,
        createLeave,
        updateLeave,
        deleteLeave,
      });
      render(<IncomePage />);
      expect(screen.getByText(/Add an income source before recording leave/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Add Leave/i })).toBeDisabled();
    });

    it('creates unpaid leave from the leave form', async () => {
      const user = userEvent.setup();
      render(<IncomePage />);
      await user.click(screen.getAllByRole('button', { name: /Add Leave/i })[0]);
      const dialog = screen.getByRole('dialog', { name: 'Add Leave' });
      fireEvent.change(screen.getByLabelText('Leave Name'), { target: { value: 'Medical Leave' } });
      fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'unpaid' } });
      fireEvent.change(screen.getByLabelText('Start Date'), { target: { value: '2026-02-01' } });
      fireEvent.change(screen.getByLabelText('End Date'), { target: { value: '2026-02-14' } });
      expect(screen.getByLabelText('Target Cash On-Hand')).toBeInTheDocument();
      expect(screen.getByLabelText('Min Cash On-Hand')).toBeInTheDocument();
      await user.click(dialog.querySelector('button[type="submit"]')!);
      expect(createLeave).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Medical Leave',
          type: 'unpaid',
          startDate: '2026-02-01',
          endDate: '2026-02-14',
        })
      );
      expect(createLeave.mock.calls[0][0].targetCashOnHand).toBeUndefined();
      expect(createLeave.mock.calls[0][0].minCashOnHand).toBeUndefined();
    });

    it('shows cash fields only for unpaid leave and submits temporary overrides', async () => {
      const user = userEvent.setup();
      render(<IncomePage />);
      await user.click(screen.getAllByRole('button', { name: /Add Leave/i })[0]);
      const dialog = screen.getByRole('dialog', { name: 'Add Leave' });

      fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'paid' } });
      expect(screen.queryByLabelText('Target Cash On-Hand')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Min Cash On-Hand')).not.toBeInTheDocument();

      fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'unpaid' } });
      fireEvent.change(screen.getByLabelText('Leave Name'), { target: { value: 'Medical Leave' } });
      fireEvent.change(screen.getByLabelText('Start Date'), { target: { value: '2026-02-01' } });
      fireEvent.change(screen.getByLabelText('End Date'), { target: { value: '2026-02-14' } });
      fireEvent.change(screen.getByLabelText('Target Cash On-Hand'), { target: { value: '100' } });
      fireEvent.change(screen.getByLabelText('Min Cash On-Hand'), { target: { value: '40' } });
      await user.click(dialog.querySelector('button[type="submit"]')!);

      expect(createLeave).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'unpaid',
          targetCashOnHand: 100,
          minCashOnHand: 40,
        })
      );
    });

    it('clears cash overrides from submit payload when switching unpaid to paid', async () => {
      const user = userEvent.setup();
      render(<IncomePage />);
      await user.click(screen.getAllByRole('button', { name: /Add Leave/i })[0]);
      const dialog = screen.getByRole('dialog', { name: 'Add Leave' });

      fireEvent.change(screen.getByLabelText('Leave Name'), { target: { value: 'Vacation' } });
      fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'unpaid' } });
      fireEvent.change(screen.getByLabelText('Target Cash On-Hand'), { target: { value: '80' } });
      fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'paid' } });
      expect(screen.queryByLabelText('Target Cash On-Hand')).not.toBeInTheDocument();
      await user.click(dialog.querySelector('button[type="submit"]')!);

      expect(createLeave).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Vacation',
          type: 'paid',
        })
      );
      expect(createLeave.mock.calls[0][0].targetCashOnHand).toBeUndefined();
      expect(createLeave.mock.calls[0][0].minCashOnHand).toBeUndefined();
    });

    it('shows temporary cash hint on unpaid leave cards', () => {
      mockUseData.mockReturnValue({
        incomes: [createMockIncome({ sourceName: 'Primary Job', amount: 2500, startDate: '2026-01-01' })],
        leaves: [
          createMockLeave({
            name: 'Medical Leave',
            type: 'unpaid',
            targetCashOnHand: 100,
            minCashOnHand: 50,
          }),
        ],
        budgetFields: null,
        createIncome,
        updateIncome,
        deleteIncome,
        createLeave,
        updateLeave,
        deleteLeave,
      });
      render(<IncomePage />);
      expect(screen.getByText(/Target \$100\.00/)).toBeInTheDocument();
      expect(screen.getByText(/Min \$50\.00/)).toBeInTheDocument();
    });

    it('edits and deletes an existing leave', async () => {
      const user = userEvent.setup();
      mockUseData.mockReturnValue({
        incomes: [createMockIncome({ sourceName: 'Primary Job', amount: 2500, startDate: '2026-01-01' })],
        leaves: [createMockLeave({ name: 'Vacation', type: 'paid' })],
        createIncome,
        updateIncome,
        deleteIncome,
        createLeave,
        updateLeave,
        deleteLeave,
      });
      render(<IncomePage />);
      expect(screen.getByText('Vacation')).toBeInTheDocument();
      expect(screen.getByText('Paid')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /Edit Vacation/i }));
      fireEvent.change(screen.getByLabelText('Leave Name'), { target: { value: 'PTO' } });
      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(updateLeave).not.toHaveBeenCalled();

      await user.click(screen.getByRole('button', { name: /Edit Vacation/i }));
      fireEvent.change(screen.getByLabelText('Leave Name'), { target: { value: 'PTO' } });
      fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'paid' } });
      await user.click(screen.getByRole('button', { name: 'Update Leave' }));
      expect(updateLeave).toHaveBeenCalledWith(
        'leave-1',
        expect.objectContaining({ name: 'PTO', type: 'paid' })
      );

      await user.click(screen.getByRole('button', { name: /Delete Vacation/i }));
      await user.click(screen.getByRole('button', { name: /Cancel/i }));
      expect(deleteLeave).not.toHaveBeenCalled();

      await user.click(screen.getByRole('button', { name: /Delete Vacation/i }));
      await user.click(screen.getByRole('button', { name: /^Delete$/i }));
      expect(deleteLeave).toHaveBeenCalledWith('leave-1');
    });

    it('shows unknown income label when leave references a missing source', () => {
      mockUseData.mockReturnValue({
        incomes: [createMockIncome({ id: 'income-1', sourceName: 'Primary Job' })],
        leaves: [createMockLeave({ incomeId: 'missing-income', name: 'Orphan Leave' })],
        createIncome,
        updateIncome,
        deleteIncome,
        createLeave,
        updateLeave,
        deleteLeave,
      });
      render(<IncomePage />);
      expect(screen.getByText(/Unknown income/i)).toBeInTheDocument();
    });
  });
});
