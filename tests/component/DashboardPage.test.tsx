import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TestMemoryRouter } from '../helpers/router';
import DashboardPage from '../../src/pages/DashboardPage';
import { copyDiagnosticReport } from '../../src/utils/reportError';

vi.mock('../../src/utils/reportError', () => ({
  copyDiagnosticReport: vi.fn(),
}));

vi.mock('../../src/components/Toast', () => ({
  useToast: () => ({ showToast: vi.fn(), dismissToast: vi.fn() }),
}));

const mockUseData = vi.fn();

vi.mock('../../src/context/DraftContext', () => ({
  useDraftData: () => {
    const data = mockUseData();
    return { incomes: data.incomes, bills: data.bills };
  },
  useSchedule: () => mockUseData(),
}));

function operatingPaycheck(overrides: Record<string, unknown> = {}) {
  return {
    date: '2026-11-06',
    purpose: 'operating',
    incomeSources: [{ id: 'inc-1', name: 'Salary', amount: 2000 }],
    totalIncome: 2000,
    bills: [
      {
        billId: 'rent',
        creditorName: 'Rent Payment',
        amount: 1000,
        dueDay: 8,
        priority: 'critical',
        billDate: '2026-11-08',
        isIncomeAttached: false,
        isUnpayable: false,
        isSkipped: false,
      },
    ],
    totalBills: 1000,
    goalDeposits: [],
    totalGoalDeposits: 0,
    budgetRemaining: 250,
    savingsDeposit: 0,
    totalSavings: 0,
    isShortfall: false,
    ...overrides,
  };
}

describe('DashboardPage', () => {
  const generateSchedule = vi.fn(async () => null);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 10, 3, 12, 0, 0));
    const setScheduleStartingBalance = vi.fn();

    mockUseData.mockReturnValue({
      incomes: [{ id: 'i1', sourceName: 'Salary', amount: 2000, cadence: 'biweekly', startDate: '2026-01-01', isActive: true }],
      bills: [{ id: 'b1', creditorName: 'Rent', budgetedAmount: 1000, dueDay: 1, priority: 'critical', isRecurring: true }],
      generateSchedule,
      schedule: {
        paychecks: [
          operatingPaycheck(),
          operatingPaycheck({
            date: '2026-11-20',
            bills: [],
            totalBills: 0,
            budgetRemaining: 250,
          }),
        ],
        entries: [],
        summary: { shortfallCount: 0 },
        recommendations: ['Keep emergency buffer'],
      },
      scheduleStartDate: '2026-01-01',
      scheduleMonths: 3,
      isViewportReady: true,
      scheduleStartingBalance: 700,
      scheduleInputHash: 'hash-v1',
      setScheduleStartingBalance,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('happy', () => {
    it('renders dashboard stats and the pay-cycle board link', () => {
      render(
        <TestMemoryRouter>
          <DashboardPage />
        </TestMemoryRouter>
      );

      expect(screen.getByText('Dashboard')).toBeInTheDocument();
      expect(screen.getByText('Overview of your budget for the next 3 months')).toBeInTheDocument();
      expect(screen.getByText('Monthly Income')).toBeInTheDocument();
      expect(screen.getByText('Monthly Bills')).toBeInTheDocument();
      expect(screen.getByText('Projected Shortfalls')).toBeInTheDocument();
      expect(screen.queryByText('Recommendations')).not.toBeInTheDocument();
      const scheduleLink = screen.getByRole('link', { name: /View month/i });
      expect(scheduleLink).toBeInTheDocument();
      expect(scheduleLink).toHaveAttribute('href', '/schedule');
    });
  });

  describe('sad', () => {
    it('shows empty pay-cycle state when schedule has no operating paychecks', () => {
      mockUseData.mockReturnValue({
        incomes: [{ id: 'i1', sourceName: 'Salary', amount: 2000, cadence: 'biweekly', startDate: '2026-01-01', isActive: true }],
        bills: [{ id: 'b1', creditorName: 'Rent', budgetedAmount: 1000, dueDay: 1, priority: 'critical', isRecurring: true }],
        generateSchedule,
        schedule: { paychecks: [], entries: [], summary: { shortfallCount: 0 }, recommendations: [] },
        scheduleStartDate: '2026-01-01',
        scheduleMonths: 3,
        isViewportReady: true,
        scheduleStartingBalance: 700,
      });

      render(
        <TestMemoryRouter>
          <DashboardPage />
        </TestMemoryRouter>
      );

      expect(screen.getByText('Add income and bills to see your upcoming pay cycle')).toBeInTheDocument();
    });

    it('shows a progress bar while the pay cycle board is building', () => {
      mockUseData.mockReturnValue({
        incomes: [{ id: 'i1', sourceName: 'Salary', amount: 2000, cadence: 'biweekly', startDate: '2026-01-01', isActive: true }],
        bills: [{ id: 'b1', creditorName: 'Rent', budgetedAmount: 1000, dueDay: 1, priority: 'critical', isRecurring: true }],
        generateSchedule,
        isLoading: true,
        progress: { stage: 'assigning' },
        buildStartedAt: Date.now(),
        schedule: { paychecks: [], entries: [], summary: { shortfallCount: 0 }, recommendations: [] },
        scheduleStartDate: '2026-01-01',
        scheduleMonths: 3,
        isViewportReady: true,
        scheduleStartingBalance: 700,
      });

      render(
        <TestMemoryRouter>
          <DashboardPage />
        </TestMemoryRouter>
      );

      expect(screen.getByRole('progressbar')).toBeInTheDocument();
      expect(screen.getByText('Assigning bills to paychecks…')).toBeInTheDocument();
    });

    it('shows a failed pay-cycle state instead of the empty board copy', () => {
      mockUseData.mockReturnValue({
        incomes: [{ id: 'i1', sourceName: 'Salary', amount: 2000, cadence: 'biweekly', startDate: '2026-01-01', isActive: true }],
        bills: [{ id: 'b1', creditorName: 'Rent', budgetedAmount: 1000, dueDay: 1, priority: 'critical', isRecurring: true }],
        generateSchedule,
        isLoading: false,
        error: 'Schedule worker exited',
        diagnosticId: null,
        clearError: vi.fn(),
        schedule: null,
        scheduleStartDate: '2026-01-01',
        scheduleMonths: 3,
        isViewportReady: true,
        scheduleStartingBalance: 700,
      });

      render(
        <TestMemoryRouter>
          <DashboardPage />
        </TestMemoryRouter>
      );

      expect(screen.getByRole('alert')).toHaveTextContent('Could not build the upcoming pay cycle.');
      expect(screen.queryByText('Add income and bills to see your upcoming pay cycle')).not.toBeInTheDocument();
    });

    it('retries a failed projection and copies the diagnostic report', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const clearError = vi.fn();
      mockUseData.mockReturnValue({
        incomes: [{ id: 'i1', sourceName: 'Salary', amount: 2000, cadence: 'biweekly', startDate: '2026-01-01', isActive: true }],
        bills: [{ id: 'b1', creditorName: 'Rent', budgetedAmount: 1000, dueDay: 1, priority: 'critical', isRecurring: true }],
        generateSchedule,
        isLoading: false,
        error: 'Schedule worker exited',
        diagnosticId: 'diag-dash',
        clearError,
        schedule: null,
        scheduleStartDate: '2026-01-01',
        scheduleMonths: 3,
        isViewportReady: true,
        scheduleStartingBalance: 700,
      });

      render(
        <TestMemoryRouter>
          <DashboardPage />
        </TestMemoryRouter>
      );

      await user.click(screen.getByRole('button', { name: 'Try again' }));
      expect(clearError).toHaveBeenCalledTimes(1);
      expect(generateSchedule).toHaveBeenCalledWith('2026-01-01', 3, 700, { force: true });

      await user.click(screen.getByRole('button', { name: 'Copy report' }));
      expect(copyDiagnosticReport).toHaveBeenCalledWith('diag-dash');
    });
  });

  describe('hostile', () => {
    it('regenerates schedule when scheduleInputHash changes without entity edits', async () => {
      const baseData = {
        incomes: [{ id: 'i1', sourceName: 'Salary', amount: 2000, cadence: 'biweekly', startDate: '2026-01-01', isActive: true }],
        bills: [{ id: 'b1', creditorName: 'Rent', budgetedAmount: 1000, dueDay: 1, priority: 'critical', isRecurring: true }],
        generateSchedule,
        schedule: {
          paychecks: [
            operatingPaycheck(),
            operatingPaycheck({ date: '2026-11-20', bills: [], totalBills: 0 }),
          ],
          entries: [],
          summary: { shortfallCount: 0 },
          recommendations: [],
        },
        scheduleStartDate: '2026-01-01',
        scheduleMonths: 3,
        isViewportReady: true,
        scheduleStartingBalance: 700,
        scheduleInputHash: 'hash-v1',
        setScheduleStartingBalance: vi.fn(),
      };
      mockUseData.mockReturnValue(baseData);

      const { rerender } = render(
        <TestMemoryRouter>
          <DashboardPage />
        </TestMemoryRouter>
      );

      await waitFor(() => {
        expect(generateSchedule).toHaveBeenCalledTimes(1);
      });

      mockUseData.mockReturnValue({ ...baseData, scheduleInputHash: 'hash-v2' });

      rerender(
        <TestMemoryRouter>
          <DashboardPage />
        </TestMemoryRouter>
      );

      await waitFor(() => {
        expect(generateSchedule).toHaveBeenCalledTimes(2);
      });
    });

    it('generates schedule on mount and reflects starting-balance edits', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const setScheduleStartingBalance = vi.fn();
      mockUseData.mockReturnValue({
        ...mockUseData(),
        setScheduleStartingBalance,
      });

      render(
        <TestMemoryRouter>
          <DashboardPage />
        </TestMemoryRouter>
      );

      await waitFor(() => {
        expect(generateSchedule).toHaveBeenCalledWith('2026-01-01', 3, 700);
      });

      const startingBalance = screen.getByPlaceholderText('$0');
      await user.clear(startingBalance);
      await user.type(startingBalance, '1200');
      expect(setScheduleStartingBalance).toHaveBeenCalled();
    });

    it('renders pay-cycle bill chips on due dates and marks shortfall remainder', () => {
      mockUseData.mockReturnValue({
        incomes: [{ id: 'i1', sourceName: 'Salary', amount: 2000, cadence: 'biweekly', startDate: '2026-01-01', isActive: true }],
        bills: [{ id: 'b1', creditorName: 'Rent', budgetedAmount: 1000, dueDay: 1, priority: 'critical', isRecurring: true }],
        generateSchedule,
        schedule: {
          paychecks: [
            operatingPaycheck({
              isShortfall: true,
              budgetRemaining: 40,
              bills: [
                {
                  billId: 'rent',
                  creditorName: 'Rent Payment',
                  amount: 1000,
                  dueDay: 8,
                  priority: 'critical',
                  billDate: '2026-11-08',
                  isIncomeAttached: false,
                  isUnpayable: false,
                  isSkipped: false,
                },
                {
                  billId: 'skip',
                  creditorName: 'Utilities',
                  amount: 80,
                  dueDay: 8,
                  priority: 'normal',
                  billDate: '2026-11-08',
                  isIncomeAttached: false,
                  isUnpayable: false,
                  isSkipped: true,
                },
              ],
            }),
            operatingPaycheck({ date: '2026-11-20', bills: [], totalBills: 0 }),
          ],
          entries: [],
          summary: { shortfallCount: 1 },
          recommendations: [],
        },
        scheduleStartDate: '2026-01-01',
        scheduleMonths: 3,
        isViewportReady: true,
        scheduleStartingBalance: 700,
      });

      render(
        <TestMemoryRouter>
          <DashboardPage />
        </TestMemoryRouter>
      );

      expect(screen.getByText('Rent Payment')).toBeInTheDocument();
      expect(screen.queryByText('Utilities')).not.toBeInTheDocument();
      expect(screen.getByTestId('pay-cycle-remainder')).toHaveAttribute('data-shortfall', 'true');
      expect(screen.getByText(/Projected Shortfalls/i)).toBeInTheDocument();
    });

    it('shows negative net monthly trend when bills exceed income', () => {
      mockUseData.mockReturnValue({
        incomes: [{ id: 'i1', sourceName: 'Salary', amount: 1000, cadence: 'monthly', startDate: '2026-01-01', isActive: true }],
        bills: [{ id: 'b1', creditorName: 'Rent', budgetedAmount: 2000, dueDay: 1, priority: 'critical', isRecurring: true }],
        generateSchedule,
        schedule: { paychecks: [], entries: [], summary: { shortfallCount: 2 }, recommendations: [] },
        scheduleStartDate: '2026-01-01',
        scheduleMonths: 3,
        isViewportReady: true,
        scheduleStartingBalance: 0,
        setScheduleStartingBalance: vi.fn(),
      });

      render(
        <TestMemoryRouter>
          <DashboardPage />
        </TestMemoryRouter>
      );

      expect(screen.getByText('Negative balance trend')).toBeInTheDocument();
      expect(screen.getByText('2')).toBeInTheDocument();
    });

    it('shows neutral trend when income equals bills', () => {
      mockUseData.mockReturnValue({
        incomes: [{ id: 'i1', sourceName: 'Salary', amount: 1500, cadence: 'monthly', startDate: '2026-01-01', isActive: true }],
        bills: [{ id: 'b1', creditorName: 'Rent', budgetedAmount: 1500, dueDay: 1, priority: 'critical', isRecurring: true }],
        generateSchedule,
        schedule: { paychecks: [], entries: [], summary: { shortfallCount: 0 }, recommendations: [] },
        scheduleStartDate: '2026-01-01',
        scheduleMonths: 3,
        isViewportReady: true,
        scheduleStartingBalance: 0,
        setScheduleStartingBalance: vi.fn(),
      });

      render(
        <TestMemoryRouter>
          <DashboardPage />
        </TestMemoryRouter>
      );

      expect(screen.getByText('Neutral balance trend')).toBeInTheDocument();
    });

    it('shows empty pay cycle when schedule is null and there is no income or bills', () => {
      mockUseData.mockReturnValue({
        incomes: [],
        bills: [],
        generateSchedule,
        schedule: null,
        scheduleStartDate: '2026-01-01',
        scheduleMonths: 3,
        isViewportReady: true,
        scheduleStartingBalance: 0,
        setScheduleStartingBalance: vi.fn(),
      });

      render(
        <TestMemoryRouter>
          <DashboardPage />
        </TestMemoryRouter>
      );

      expect(screen.getByText('Add income and bills to see your upcoming pay cycle')).toBeInTheDocument();
      expect(generateSchedule).not.toHaveBeenCalled();
    });

    it('renders the payday deposit from the pay-cycle board', () => {
      mockUseData.mockReturnValue({
        incomes: [{ id: 'i1', sourceName: 'Salary', amount: 2000, cadence: 'biweekly', startDate: '2026-01-01', isActive: true }],
        bills: [],
        generateSchedule,
        schedule: {
          paychecks: [
            operatingPaycheck({ bills: [], totalBills: 0 }),
            operatingPaycheck({ date: '2026-11-20', bills: [], totalBills: 0 }),
          ],
          entries: [],
          summary: { shortfallCount: 0 },
          recommendations: [],
        },
        scheduleStartDate: '2026-01-01',
        scheduleMonths: 3,
        isViewportReady: true,
        scheduleStartingBalance: 0,
        setScheduleStartingBalance: vi.fn(),
      });

      render(
        <TestMemoryRouter>
          <DashboardPage />
        </TestMemoryRouter>
      );

      expect(screen.getByText('+$2,000')).toBeInTheDocument();
      expect(screen.getByTestId('pay-cycle-day-2026-11-06')).toBeInTheDocument();
    });

    it('falls back to zero when starting balance input is cleared', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const setScheduleStartingBalance = vi.fn();
      mockUseData.mockReturnValue({
        incomes: [{ id: 'i1', sourceName: 'Salary', amount: 2000, cadence: 'biweekly', startDate: '2026-01-01', isActive: true }],
        bills: [{ id: 'b1', creditorName: 'Rent', budgetedAmount: 1000, dueDay: 1, priority: 'critical', isRecurring: true }],
        generateSchedule,
        schedule: { paychecks: [], entries: [], summary: { shortfallCount: 0 }, recommendations: [] },
        scheduleStartDate: '2026-01-01',
        scheduleMonths: 3,
        isViewportReady: true,
        scheduleStartingBalance: 700,
        setScheduleStartingBalance,
      });

      render(
        <TestMemoryRouter>
          <DashboardPage />
        </TestMemoryRouter>
      );

      const startingBalance = screen.getByPlaceholderText('$0');
      await user.clear(startingBalance);
      expect(setScheduleStartingBalance).toHaveBeenCalledWith(0);
    });

    it('excludes inactive income from monthly income total', () => {
      mockUseData.mockReturnValue({
        incomes: [
          { id: 'i1', sourceName: 'Salary', amount: 2000, cadence: 'monthly', startDate: '2026-01-01', isActive: true },
          { id: 'i2', sourceName: 'Side Gig', amount: 500, cadence: 'monthly', startDate: '2026-01-01', isActive: false },
        ],
        bills: [],
        generateSchedule,
        schedule: { paychecks: [], entries: [], summary: { shortfallCount: 0 }, recommendations: [] },
        scheduleStartDate: '2026-01-01',
        scheduleMonths: 3,
        isViewportReady: true,
        scheduleStartingBalance: 0,
        setScheduleStartingBalance: vi.fn(),
      });

      render(
        <TestMemoryRouter>
          <DashboardPage />
        </TestMemoryRouter>
      );

      const incomeCard = screen.getByText('Monthly Income').closest('.card') as HTMLElement;
      expect(within(incomeCard).getByText('$2,000')).toBeInTheDocument();
    });
  });
});
