import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
    (globalThis as unknown as { startingBalance: number }).startingBalance = 700;
    (globalThis as unknown as { setStartingBalance: (v: number) => void }).setStartingBalance = vi.fn();

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
      expect((globalThis as unknown as { setStartingBalance: ReturnType<typeof vi.fn> }).setStartingBalance).toHaveBeenCalled();
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
  });
});
