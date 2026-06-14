import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import DebtsPage from '../../src/pages/DebtsPage';
import { renderWithRouter } from '../helpers/renderWithProviders';
import { createMockElectronAPI } from '../mocks/electron-api.mock';

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

vi.mock('recharts', () => {
  const Mock = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    ResponsiveContainer: Mock,
    BarChart: ({ data, children }: { data?: Array<unknown>; children?: React.ReactNode }) => (
      <div data-testid="mock-bar-chart">{data?.length ?? 0}{children}</div>
    ),
    Bar: Mock,
    XAxis: Mock,
    YAxis: Mock,
    Tooltip: Mock,
    Legend: Mock,
  };
});

describe('DebtsPage', () => {
  const mockAPI = createMockElectronAPI();
  const getDebtsWithAmortization = vi.fn();
  const createDebt = vi.fn(() => true);
  const updateDebt = vi.fn(() => true);
  const deleteDebt = vi.fn(() => true);
  const reloadSnapshot = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseData.mockReturnValue({
      bills: [
        {
          id: 'bill-1',
          creditorName: 'CardOne: Platinum',
          budgetedAmount: 120,
          category: 'Debt',
          dueDay: 10,
          priority: 'high',
          isRecurring: true,
        },
        {
          id: 'bill-2',
          creditorName: 'CardOne: Backup',
          budgetedAmount: 80,
          category: 'Debt',
          dueDay: 20,
          priority: 'normal',
          isRecurring: true,
        },
      ],
    });
    mockUseBudget.mockReturnValue({ isQuickBudget: false });
    mockUseDraft.mockReturnValue({
      debts: [],
      getDebtsWithAmortization: getDebtsWithAmortization.mockResolvedValue([
        {
          debt: {
            id: 'debt-1',
            billId: 'bill-1',
            principalBalance: 1200,
            apr: 0.22,
            monthlyPayment: 100,
          },
          bill: {
            id: 'bill-1',
            creditorName: 'CardOne: Platinum',
            budgetedAmount: 120,
            dueDay: 10,
          },
          amortization: {
            monthsToPayoff: 12,
            payoffDate: '2026-12-01',
            totalInterest: 140,
            totalPayments: 1340,
            totalPrincipal: 1200,
            payments: [],
          },
        },
      ]),
      createDebt,
      updateDebt,
      deleteDebt,
      reloadSnapshot,
    });
  });

  describe('happy', () => {
    it('renders tracked debt list from draft amortization results', async () => {
      renderWithRouter(<DebtsPage />, { mockAPI });
      expect(await screen.findByText('CardOne: Platinum')).toBeInTheDocument();
      expect(screen.getByText('Total Debt Balance')).toBeInTheDocument();
      expect(screen.getByText(/\+ \$20\.00 extra/)).toBeInTheDocument();
    });

    it('groups tracked debts by creditor prefix and renders Other last', async () => {
      getDebtsWithAmortization.mockResolvedValue([
        {
          debt: { id: 'debt-1', billId: 'bill-1', principalBalance: 1200, apr: 0.22, monthlyPayment: 100 },
          bill: { id: 'bill-1', creditorName: 'CardOne: Platinum', budgetedAmount: 120, dueDay: 10 },
          amortization: { monthsToPayoff: 12, payoffDate: '2026-12-01', totalInterest: 140, totalPayments: 1340, totalPrincipal: 1200, payments: [] },
        },
        {
          debt: { id: 'debt-2', billId: 'bill-3', principalBalance: 500, apr: 0.15, monthlyPayment: 50 },
          bill: { id: 'bill-3', creditorName: 'Store Card', budgetedAmount: 50, dueDay: 5 },
          amortization: { monthsToPayoff: 10, payoffDate: '2026-10-01', totalInterest: 40, totalPayments: 540, totalPrincipal: 500, payments: [] },
        },
      ]);
      mockUseData.mockReturnValue({
        bills: [
          { id: 'bill-1', creditorName: 'CardOne: Platinum', budgetedAmount: 120, category: 'Debt', dueDay: 10, priority: 'high', isRecurring: true },
          { id: 'bill-3', creditorName: 'Store Card', budgetedAmount: 50, category: 'Debt', dueDay: 5, priority: 'normal', isRecurring: true },
        ],
      });

      renderWithRouter(<DebtsPage />, { mockAPI });
      expect(await screen.findByText('CardOne')).toBeInTheDocument();
      expect(screen.getByText('Other')).toBeInTheDocument();
    });

    it('adds, edits, deletes, and changes chart window for a debt', async () => {
      renderWithRouter(<DebtsPage />, { mockAPI });
      expect(await screen.findByText('CardOne: Platinum')).toBeInTheDocument();

      fireEvent.click(screen.getAllByRole('button', { name: 'Add Debt' })[0]);
      fireEvent.change(screen.getByLabelText('Linked Bill'), {
        target: { value: 'bill-2' },
      });
      fireEvent.change(screen.getByLabelText('Remaining Balance (Principal)'), {
        target: { value: '900' },
      });
      fireEvent.change(screen.getByLabelText('Annual Percentage Rate (APR)'), {
        target: { value: '19' },
      });
      fireEvent.change(screen.getByLabelText('Monthly Payment'), {
        target: { value: '120' },
      });
      fireEvent.click(screen.getAllByRole('button', { name: 'Add Debt' })[1]);

      await waitFor(() => {
        expect(createDebt).toHaveBeenCalledWith(
          expect.objectContaining({
            billId: 'bill-2',
            principalBalance: 900,
            apr: 0.19,
            monthlyPayment: 120,
          })
        );
      });

      fireEvent.click(screen.getByRole('button', { name: /Edit debt/i }));
      fireEvent.change(screen.getByLabelText('Monthly Payment'), {
        target: { value: '130' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Update Debt' }));
      await waitFor(() => {
        expect(updateDebt).toHaveBeenCalled();
      });

      fireEvent.click(screen.getByRole('button', { name: /Delete debt/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
      await waitFor(() => {
        expect(deleteDebt).toHaveBeenCalled();
      });

      fireEvent.click(screen.getByRole('button', { name: 'A–Z' }));
      fireEvent.click(screen.getByRole('button', { name: 'Due' }));
      fireEvent.click(screen.getByRole('button', { name: 'Min pay' }));
      fireEvent.click(screen.getByRole('button', { name: 'Balance' }));

      fireEvent.click(screen.getByRole('button', { name: '3 mo' }));
      fireEvent.click(screen.getByRole('button', { name: 'MAX' }));
      expect(screen.getByTestId('mock-bar-chart')).toBeInTheDocument();
    });
  });

  describe('sad', () => {
    it('shows empty state when no debt bills exist', async () => {
      mockUseData.mockReturnValue({ bills: [] });
      mockUseDraft.mockReturnValue({
        debts: [],
        getDebtsWithAmortization: vi.fn().mockResolvedValue([]),
        createDebt: vi.fn(() => true),
        updateDebt: vi.fn(() => true),
        deleteDebt: vi.fn(() => true),
        reloadSnapshot: vi.fn(),
      });
      renderWithRouter(<DebtsPage />, { mockAPI });
      expect(await screen.findByText('No debts to track')).toBeInTheDocument();
    });

    it('omits debt cards when bill or amortization data is missing', async () => {
      getDebtsWithAmortization.mockResolvedValue([
        {
          debt: { id: 'debt-1', billId: 'bill-1', principalBalance: 1200, apr: 0.22, monthlyPayment: 100 },
          bill: null,
          amortization: null,
        },
      ]);
      renderWithRouter(<DebtsPage />, { mockAPI });
      await waitFor(() => {
        expect(screen.queryByText('CardOne: Platinum')).not.toBeInTheDocument();
      });
    });
  });

  describe('hostile', () => {
    it('disables add debt button when all debt bills are already tracked', async () => {
      mockUseData.mockReturnValue({
        bills: [
          {
            id: 'bill-1',
            creditorName: 'CardOne: Platinum',
            budgetedAmount: 120,
            category: 'Debt',
            dueDay: 10,
            priority: 'high',
            isRecurring: true,
          },
        ],
      });
      renderWithRouter(<DebtsPage />, { mockAPI });
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Add Debt/i })).toBeDisabled();
      });
    });

    it('uses quick-budget IPC debt flows', async () => {
      mockUseBudget.mockReturnValue({ isQuickBudget: true });
      mockAPI.debts.create.mockResolvedValue({ success: true, data: { id: 'debt-2' } });
      mockAPI.debts.update.mockResolvedValue({ success: true, data: { id: 'debt-1' } });
      mockAPI.debts.delete.mockResolvedValue({ success: true, data: true });
      renderWithRouter(<DebtsPage />, { mockAPI });

      expect(await screen.findByText('CardOne: Platinum')).toBeInTheDocument();
      fireEvent.click(screen.getByText('CardOne: Backup'));
      fireEvent.click(screen.getAllByRole('button', { name: 'Add Debt' })[0]);
      fireEvent.change(screen.getByLabelText('Linked Bill'), {
        target: { value: 'bill-2' },
      });
      fireEvent.change(screen.getByLabelText('Remaining Balance (Principal)'), {
        target: { value: '800' },
      });
      fireEvent.change(screen.getByLabelText('Annual Percentage Rate (APR)'), {
        target: { value: '17' },
      });
      fireEvent.change(screen.getByLabelText('Monthly Payment'), {
        target: { value: '100' },
      });
      fireEvent.click(screen.getAllByRole('button', { name: 'Add Debt' })[1]);

      await waitFor(() => {
        expect(mockAPI.debts.create).toHaveBeenCalled();
        expect(reloadSnapshot).toHaveBeenCalled();
      });
    });
  });
});
