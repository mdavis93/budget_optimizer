import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import DebtsPage from '../../src/pages/DebtsPage';
import { renderWithRouter } from '../helpers/renderWithProviders';
import { createMockElectronAPI } from '../mocks/electron-api.mock';
import { delayedResolve, unstableDraftMock } from '../helpers/unstableDraftMock';

const mockUseData = vi.fn();
const mockUseDraftData = vi.fn();
const mockUseDraftActions = vi.fn();
const mockUseBudget = vi.fn();

vi.mock('../../src/context/DraftContext', () => ({
  useDraft: () => ({ ...mockUseDraftData(), ...mockUseDraftActions() }),
  useDraftData: () => ({ ...mockUseDraftData(), bills: mockUseData().bills }),
  useDraftActions: () => mockUseDraftActions(),
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
  const deleteDebtAction = vi.fn(() => true);
  const reloadSnapshot = vi.fn();

  const debtFixture = {
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
  };

  const baseDraftData = { debts: [] as never[] };
  const baseDraftActions = {
    getDebtsWithAmortization,
    createDebt,
    updateDebt,
    deleteDebt: deleteDebtAction,
    reloadSnapshot,
  };

  function mockDraftContext(
    dataOverrides: Partial<typeof baseDraftData> = {},
    actionsOverrides: Partial<typeof baseDraftActions> = {},
  ) {
    mockUseDraftData.mockReturnValue({ ...baseDraftData, ...dataOverrides });
    mockUseDraftActions.mockReturnValue({ ...baseDraftActions, ...actionsOverrides });
  }

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
    getDebtsWithAmortization.mockResolvedValue([debtFixture]);
    mockDraftContext();
  });

  describe('loading regression', () => {
    it('clears loading when draft data hook returns new object references each render', async () => {
      mockUseDraftData.mockImplementation(unstableDraftMock(() => ({ ...baseDraftData })));
      mockUseDraftActions.mockReturnValue({
        ...baseDraftActions,
        getDebtsWithAmortization: vi.fn(() => delayedResolve([debtFixture], 100)),
      });

      renderWithRouter(<DebtsPage />, { mockAPI });
      expect(document.querySelector('.animate-spin')).toBeTruthy();

      await waitFor(() => {
        expect(document.querySelector('.animate-spin')).toBeNull();
      });
      expect(await screen.findByText('CardOne: Platinum')).toBeInTheDocument();
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

      await waitFor(() => {
        expect(document.querySelector('.animate-spin')).toBeNull();
      });
      fireEvent.click(await screen.findByRole('button', { name: /Edit debt/i }));
      fireEvent.change(screen.getByLabelText('Monthly Payment'), {
        target: { value: '130' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Update Debt' }));
      await waitFor(() => {
        expect(updateDebt).toHaveBeenCalled();
      });
      // updateDebt mutates draft debts → useEffect reloads amortization; wait out the spinner
      await waitFor(() => {
        expect(document.querySelector('.animate-spin')).toBeNull();
      });

      fireEvent.click(await screen.findByRole('button', { name: /Delete debt/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
      await waitFor(() => {
        expect(deleteDebtAction).toHaveBeenCalled();
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
    it('shows loading spinner while amortization loads', () => {
      getDebtsWithAmortization.mockImplementation(() => new Promise(() => undefined));
      renderWithRouter(<DebtsPage />, { mockAPI });
      expect(document.querySelector('.animate-spin')).toBeTruthy();
    });

    it('shows empty state when no debt bills exist', async () => {
      mockUseData.mockReturnValue({ bills: [] });
      mockDraftContext({}, {
        getDebtsWithAmortization: vi.fn().mockResolvedValue([]),
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

    it('updates and deletes debts through quick-budget IPC', async () => {
      mockUseBudget.mockReturnValue({ isQuickBudget: true });
      mockAPI.debts.update.mockResolvedValue({ success: true, data: { id: 'debt-1' } });
      mockAPI.debts.delete.mockResolvedValue({ success: true, data: true });
      renderWithRouter(<DebtsPage />, { mockAPI });

      expect(await screen.findByText('CardOne: Platinum')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /Edit debt/i }));
      fireEvent.change(screen.getByLabelText('Monthly Payment'), {
        target: { value: '140' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Update Debt' }));
      await waitFor(() => {
        expect(mockAPI.debts.update).toHaveBeenCalled();
        expect(reloadSnapshot).toHaveBeenCalled();
      });
      await waitFor(() => {
        expect(document.querySelector('.animate-spin')).toBeNull();
      });

      fireEvent.click(await screen.findByRole('button', { name: /Delete debt/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
      await waitFor(() => {
        expect(mockAPI.debts.delete).toHaveBeenCalled();
      });
    });

    it('opens setup modal for untracked debt bills', async () => {
      renderWithRouter(<DebtsPage />, { mockAPI });
      expect(await screen.findByText('Finish Setting Up Your Debts')).toBeInTheDocument();
      fireEvent.click(screen.getByText('CardOne: Backup'));
      expect(screen.getByRole('dialog', { name: /Set Up: CardOne: Backup/i })).toBeInTheDocument();
    });

    it('recovers from amortization load errors and still renders', async () => {
      getDebtsWithAmortization.mockRejectedValue(new Error('load failed'));
      renderWithRouter(<DebtsPage />, { mockAPI });
      expect(await screen.findByText('Debt Tracking')).toBeInTheDocument();
      expect(screen.getByText('Finish Setting Up Your Debts')).toBeInTheDocument();
    });

    it('keeps create modal open when draft createDebt returns false', async () => {
      createDebt.mockReturnValue(false);
      renderWithRouter(<DebtsPage />, { mockAPI });
      expect(await screen.findByText('CardOne: Platinum')).toBeInTheDocument();

      fireEvent.click(screen.getAllByRole('button', { name: 'Add Debt' })[0]);
      fireEvent.change(screen.getByLabelText('Linked Bill'), { target: { value: 'bill-2' } });
      fireEvent.change(screen.getByLabelText('Remaining Balance (Principal)'), { target: { value: '500' } });
      fireEvent.change(screen.getByLabelText('Annual Percentage Rate (APR)'), { target: { value: '12' } });
      fireEvent.change(screen.getByLabelText('Monthly Payment'), { target: { value: '80' } });
      fireEvent.click(screen.getAllByRole('button', { name: 'Add Debt' })[1]);

      await waitFor(() => {
        expect(createDebt).toHaveBeenCalled();
      });
      expect(screen.getByRole('dialog', { name: /Add Debt/i })).toBeInTheDocument();
    });

    it('does not close modal when quick-budget create IPC fails', async () => {
      mockUseBudget.mockReturnValue({ isQuickBudget: true });
      mockAPI.debts.create.mockResolvedValue({ success: false, error: 'failed' });
      renderWithRouter(<DebtsPage />, { mockAPI });
      expect(await screen.findByText('CardOne: Platinum')).toBeInTheDocument();

      fireEvent.click(screen.getAllByRole('button', { name: 'Add Debt' })[0]);
      fireEvent.change(screen.getByLabelText('Linked Bill'), { target: { value: 'bill-2' } });
      fireEvent.change(screen.getByLabelText('Remaining Balance (Principal)'), { target: { value: '500' } });
      fireEvent.change(screen.getByLabelText('Annual Percentage Rate (APR)'), { target: { value: '12' } });
      fireEvent.change(screen.getByLabelText('Monthly Payment'), { target: { value: '80' } });
      fireEvent.click(screen.getAllByRole('button', { name: 'Add Debt' })[1]);

      await waitFor(() => {
        expect(mockAPI.debts.create).toHaveBeenCalled();
      });
      expect(screen.getByRole('dialog', { name: /Add Debt/i })).toBeInTheDocument();
      expect(reloadSnapshot).not.toHaveBeenCalled();
    });

    it('cancels add-debt modal and clears preselected bill', async () => {
      renderWithRouter(<DebtsPage />, { mockAPI });
      expect(await screen.findByText('CardOne: Backup')).toBeInTheDocument();
      fireEvent.click(screen.getByText('CardOne: Backup'));
      expect(screen.getByRole('dialog', { name: /Set Up: CardOne: Backup/i })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('shows no-extra-payment label when bill budget equals minimum payment', async () => {
      getDebtsWithAmortization.mockResolvedValue([
        {
          debt: { id: 'debt-1', billId: 'bill-1', principalBalance: 1200, apr: 0.22, monthlyPayment: 120 },
          bill: { id: 'bill-1', creditorName: 'CardOne: Platinum', budgetedAmount: 120, dueDay: 10 },
          amortization: { monthsToPayoff: 12, payoffDate: '2026-12-01', totalInterest: 140, totalPayments: 1340, totalPrincipal: 1200, payments: [] },
        },
      ]);
      renderWithRouter(<DebtsPage />, { mockAPI });
      expect(await screen.findByText('CardOne: Platinum')).toBeInTheDocument();
      expect(screen.queryByText(/extra/)).not.toBeInTheDocument();
    });

    it('shows Never payoff date when debt cannot be paid off', async () => {
      getDebtsWithAmortization.mockResolvedValue([
        {
          debt: { id: 'debt-1', billId: 'bill-1', principalBalance: 1200, apr: 0.22, monthlyPayment: 100 },
          bill: { id: 'bill-1', creditorName: 'CardOne: Platinum', budgetedAmount: 120, dueDay: 10 },
          amortization: {
            monthsToPayoff: 0,
            payoffDate: '2026-12-01',
            totalInterest: 0,
            totalPayments: 0,
            totalPrincipal: 0,
            payments: [],
          },
        },
      ]);
      renderWithRouter(<DebtsPage />, { mockAPI });
      expect(await screen.findByText('Never')).toBeInTheDocument();
      expect(screen.getByText('—')).toBeInTheDocument();
    });

    it('renders chart data for 6-month view window', async () => {
      getDebtsWithAmortization.mockResolvedValue([
        {
          debt: { id: 'debt-1', billId: 'bill-1', principalBalance: 1200, apr: 0.22, monthlyPayment: 100 },
          bill: { id: 'bill-1', creditorName: 'CardOne: Platinum', budgetedAmount: 120, dueDay: 10 },
          amortization: {
            monthsToPayoff: 12,
            payoffDate: '2026-12-01',
            totalInterest: 140,
            totalPayments: 1340,
            totalPrincipal: 1200,
            payments: [
              { date: '2026-01-01', principal: 50, interest: 10, payment: 60 },
              { date: '2026-02-01', principal: 55, interest: 9, payment: 64 },
            ],
          },
        },
      ]);
      renderWithRouter(<DebtsPage />, { mockAPI });
      expect(await screen.findByText('CardOne: Platinum')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: '6 mo' }));
      expect(screen.getByTestId('mock-bar-chart')).toHaveTextContent('2');
    });

    it('shows extra payment None in form when budget matches minimum', async () => {
      renderWithRouter(<DebtsPage />, { mockAPI });
      expect(await screen.findByText('CardOne: Backup')).toBeInTheDocument();
      fireEvent.click(screen.getByText('CardOne: Backup'));
      fireEvent.change(screen.getByLabelText('Monthly Payment'), { target: { value: '80' } });
      expect(screen.getByText('None')).toBeInTheDocument();
    });

    it('disables add debt when no debt-category bills exist', async () => {
      mockUseData.mockReturnValue({
        bills: [
          { id: 'bill-x', creditorName: 'Rent', budgetedAmount: 1000, category: 'housing', dueDay: 1, priority: 'critical', isRecurring: true },
        ],
      });
      mockDraftContext({}, {
        getDebtsWithAmortization: vi.fn().mockResolvedValue([]),
      });
      renderWithRouter(<DebtsPage />, { mockAPI });
      expect(await screen.findByText('No debts to track')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Add Debt/i })).toBeDisabled();
    });
  });
});
