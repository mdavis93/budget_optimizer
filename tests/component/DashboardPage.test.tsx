import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import DashboardPage from '../../src/pages/DashboardPage';

const mockUseData = vi.fn();

vi.mock('../../src/context/DataContext', () => ({
  useData: () => mockUseData(),
}));

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  LineChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Line: () => <div>Line</div>,
  XAxis: ({ tickFormatter }: { tickFormatter?: (value: string) => string }) => {
    tickFormatter?.('2026-01-15');
    return <div>XAxis</div>;
  },
  YAxis: ({ tickFormatter }: { tickFormatter?: (value: number) => string }) => {
    tickFormatter?.(1500);
    return <div>YAxis</div>;
  },
  Tooltip: ({ formatter }: { formatter?: (value: number) => string }) => {
    formatter?.(2000);
    return <div>Tooltip</div>;
  },
  ReferenceLine: () => <div>ReferenceLine</div>,
}));

describe('DashboardPage', () => {
  const generateSchedule = vi.fn(async () => null);

  beforeEach(() => {
    vi.clearAllMocks();
    const setScheduleStartingBalance = vi.fn();

    mockUseData.mockReturnValue({
      incomes: [{ id: 'i1', sourceName: 'Salary', amount: 2000, cadence: 'biweekly', startDate: '2026-01-01', isActive: true }],
      bills: [{ id: 'b1', creditorName: 'Rent', budgetedAmount: 1000, dueDay: 1, priority: 'critical', isRecurring: true }],
      generateSchedule,
      schedule: {
        entries: [{ date: '2026-01-12', description: 'Salary', type: 'income', amount: 2000, runningBalance: 2200, isShortfall: false }],
        summary: { shortfallCount: 0 },
        recommendations: ['Keep emergency buffer'],
      },
      scheduleStartDate: '2026-01-01',
      scheduleStartingBalance: 700,
      setScheduleStartingBalance,
    });
  });

  describe('happy', () => {
    it('renders dashboard stats and recommendations', () => {
      render(
        <MemoryRouter>
          <DashboardPage />
        </MemoryRouter>
      );

      expect(screen.getByText('Dashboard')).toBeInTheDocument();
      expect(screen.getByText('Monthly Income')).toBeInTheDocument();
      expect(screen.getByText('Monthly Bills')).toBeInTheDocument();
      expect(screen.getByText('Projected Shortfalls')).toBeInTheDocument();
      expect(screen.getByText('Recommendations')).toBeInTheDocument();
      expect(screen.getByText('Keep emergency buffer')).toBeInTheDocument();
      const scheduleLink = screen.getByRole('link', { name: /View full schedule/i });
      expect(scheduleLink).toBeInTheDocument();
      expect(scheduleLink).toHaveAttribute('href', '/schedule');
    });
  });

  describe('sad', () => {
    it('shows empty upcoming-payments state when none in range', () => {
      mockUseData.mockReturnValue({
        incomes: [{ id: 'i1', sourceName: 'Salary', amount: 2000, cadence: 'biweekly', startDate: '2026-01-01', isActive: true }],
        bills: [{ id: 'b1', creditorName: 'Rent', budgetedAmount: 1000, dueDay: 1, priority: 'critical', isRecurring: true }],
        generateSchedule,
        schedule: { entries: [], summary: { shortfallCount: 0 }, recommendations: [] },
        scheduleStartDate: '2026-01-01',
        scheduleStartingBalance: 700,
      });

      render(
        <MemoryRouter>
          <DashboardPage />
        </MemoryRouter>
      );

      expect(screen.getByText('No upcoming payments this week')).toBeInTheDocument();
    });
  });

  describe('hostile', () => {
    it('generates schedule on mount and reflects starting-balance edits', async () => {
      const user = userEvent.setup();
      const setScheduleStartingBalance = vi.fn();
      mockUseData.mockReturnValue({
        ...mockUseData(),
        setScheduleStartingBalance,
      });

      render(
        <MemoryRouter>
          <DashboardPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(generateSchedule).toHaveBeenCalledWith('2026-01-01', 3, 700);
      });

      const startingBalance = screen.getByPlaceholderText('$0');
      await user.clear(startingBalance);
      await user.type(startingBalance, '1200');
      expect(setScheduleStartingBalance).toHaveBeenCalled();
    });

    it('renders upcoming shortfall entries when schedule has near-term events', () => {
      const now = new Date();
      const inRange = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
      const inRangeIso = inRange.toISOString().slice(0, 10);
      mockUseData.mockReturnValue({
        incomes: [{ id: 'i1', sourceName: 'Salary', amount: 2000, cadence: 'biweekly', startDate: '2026-01-01', isActive: true }],
        bills: [{ id: 'b1', creditorName: 'Rent', budgetedAmount: 1000, dueDay: 1, priority: 'critical', isRecurring: true }],
        generateSchedule,
        schedule: {
          entries: [
            {
              date: inRangeIso,
              description: 'Rent Payment',
              type: 'bill',
              amount: 1000,
              runningBalance: -100,
              isShortfall: true,
            },
          ],
          summary: { shortfallCount: 1 },
          recommendations: [],
        },
        scheduleStartDate: '2026-01-01',
        scheduleStartingBalance: 700,
      });

      render(
        <MemoryRouter>
          <DashboardPage />
        </MemoryRouter>
      );

      expect(screen.getByText('Rent Payment')).toBeInTheDocument();
      expect(screen.getByText(/Projected Shortfalls/i)).toBeInTheDocument();
    });

    it('shows negative net monthly trend when bills exceed income', () => {
      mockUseData.mockReturnValue({
        incomes: [{ id: 'i1', sourceName: 'Salary', amount: 1000, cadence: 'monthly', startDate: '2026-01-01', isActive: true }],
        bills: [{ id: 'b1', creditorName: 'Rent', budgetedAmount: 2000, dueDay: 1, priority: 'critical', isRecurring: true }],
        generateSchedule,
        schedule: { entries: [], summary: { shortfallCount: 2 }, recommendations: [] },
        scheduleStartDate: '2026-01-01',
        scheduleStartingBalance: 0,
        setScheduleStartingBalance: vi.fn(),
      });

      render(
        <MemoryRouter>
          <DashboardPage />
        </MemoryRouter>
      );

      expect(screen.getByText('Negative balance trend')).toBeInTheDocument();
      expect(screen.getByText('2')).toBeInTheDocument();
    });

    it('shows neutral trend when income equals bills', () => {
      mockUseData.mockReturnValue({
        incomes: [{ id: 'i1', sourceName: 'Salary', amount: 1500, cadence: 'monthly', startDate: '2026-01-01', isActive: true }],
        bills: [{ id: 'b1', creditorName: 'Rent', budgetedAmount: 1500, dueDay: 1, priority: 'critical', isRecurring: true }],
        generateSchedule,
        schedule: { entries: [], summary: { shortfallCount: 0 }, recommendations: [] },
        scheduleStartDate: '2026-01-01',
        scheduleStartingBalance: 0,
        setScheduleStartingBalance: vi.fn(),
      });

      render(
        <MemoryRouter>
          <DashboardPage />
        </MemoryRouter>
      );

      expect(screen.getByText('Neutral balance trend')).toBeInTheDocument();
    });

    it('shows empty balance projection when schedule has no entries', () => {
      mockUseData.mockReturnValue({
        incomes: [],
        bills: [],
        generateSchedule,
        schedule: null,
        scheduleStartDate: '2026-01-01',
        scheduleStartingBalance: 0,
        setScheduleStartingBalance: vi.fn(),
      });

      render(
        <MemoryRouter>
          <DashboardPage />
        </MemoryRouter>
      );

      expect(screen.getByText('Add income and bills to see your balance projection')).toBeInTheDocument();
      expect(generateSchedule).not.toHaveBeenCalled();
    });

    it('renders income entries with positive amounts in upcoming payments', () => {
      const now = new Date();
      const inRange = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
      const inRangeIso = inRange.toISOString().slice(0, 10);
      mockUseData.mockReturnValue({
        incomes: [{ id: 'i1', sourceName: 'Salary', amount: 2000, cadence: 'biweekly', startDate: '2026-01-01', isActive: true }],
        bills: [],
        generateSchedule,
        schedule: {
          entries: [
            {
              date: inRangeIso,
              description: 'Paycheck',
              type: 'income',
              amount: 2000,
              runningBalance: 2000,
              isShortfall: false,
            },
          ],
          summary: { shortfallCount: 0 },
          recommendations: [],
        },
        scheduleStartDate: '2026-01-01',
        scheduleStartingBalance: 0,
        setScheduleStartingBalance: vi.fn(),
      });

      render(
        <MemoryRouter>
          <DashboardPage />
        </MemoryRouter>
      );

      expect(screen.getByText('Paycheck')).toBeInTheDocument();
      expect(screen.getByText('+$2,000')).toBeInTheDocument();
    });

    it('omits recommendations section when schedule has none', () => {
      mockUseData.mockReturnValue({
        incomes: [{ id: 'i1', sourceName: 'Salary', amount: 2000, cadence: 'biweekly', startDate: '2026-01-01', isActive: true }],
        bills: [{ id: 'b1', creditorName: 'Rent', budgetedAmount: 1000, dueDay: 1, priority: 'critical', isRecurring: true }],
        generateSchedule,
        schedule: {
          entries: [{ date: '2026-01-12', description: 'Salary', type: 'income', amount: 2000, runningBalance: 2200, isShortfall: false }],
          summary: { shortfallCount: 0 },
          recommendations: [],
        },
        scheduleStartDate: '2026-01-01',
        scheduleStartingBalance: 700,
        setScheduleStartingBalance: vi.fn(),
      });

      render(
        <MemoryRouter>
          <DashboardPage />
        </MemoryRouter>
      );

      expect(screen.queryByText('Recommendations')).not.toBeInTheDocument();
    });

    it('falls back to zero when starting balance input is cleared', async () => {
      const user = userEvent.setup();
      const setScheduleStartingBalance = vi.fn();
      mockUseData.mockReturnValue({
        incomes: [{ id: 'i1', sourceName: 'Salary', amount: 2000, cadence: 'biweekly', startDate: '2026-01-01', isActive: true }],
        bills: [{ id: 'b1', creditorName: 'Rent', budgetedAmount: 1000, dueDay: 1, priority: 'critical', isRecurring: true }],
        generateSchedule,
        schedule: { entries: [], summary: { shortfallCount: 0 }, recommendations: [] },
        scheduleStartDate: '2026-01-01',
        scheduleStartingBalance: 700,
        setScheduleStartingBalance,
      });

      render(
        <MemoryRouter>
          <DashboardPage />
        </MemoryRouter>
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
        schedule: { entries: [], summary: { shortfallCount: 0 }, recommendations: [] },
        scheduleStartDate: '2026-01-01',
        scheduleStartingBalance: 0,
        setScheduleStartingBalance: vi.fn(),
      });

      render(
        <MemoryRouter>
          <DashboardPage />
        </MemoryRouter>
      );

      const incomeCard = screen.getByText('Monthly Income').closest('.card') as HTMLElement;
      expect(within(incomeCard).getByText('$2,000')).toBeInTheDocument();
    });
  });
});
