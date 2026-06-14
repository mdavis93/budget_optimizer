import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SummaryPage from '../../src/pages/SummaryPage';
import { renderWithRouter } from '../helpers/renderWithProviders';
import { createMockElectronAPI } from '../mocks/electron-api.mock';

const mockUseData = vi.fn();

vi.mock('../../src/context/DataContext', () => ({
  useData: () => mockUseData(),
}));

vi.mock('recharts', () => {
  const Mock = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    ResponsiveContainer: Mock,
    AreaChart: Mock,
    Area: Mock,
    BarChart: Mock,
    Bar: Mock,
    PieChart: Mock,
    Pie: Mock,
    Cell: Mock,
    XAxis: ({ tickFormatter }: { tickFormatter?: (value: number) => string }) => {
      tickFormatter?.(1500);
      return null;
    },
    YAxis: ({ tickFormatter }: { tickFormatter?: (value: number) => string }) => {
      tickFormatter?.(2500);
      return null;
    },
    Tooltip: ({
      content,
      formatter,
    }: {
      content?: React.ReactElement;
      formatter?: (value: number, name: string) => [string, string];
    }) => {
      formatter?.(1200, 'income');
      formatter?.(900, 'expenses');
      formatter?.(500, 'total');
      if (content && React.isValidElement(content)) {
        return React.cloneElement(content, {
          active: true,
          payload: [{ payload: { total: 500, principal: 400, interest: 100 } }],
          label: 'Jan',
        });
      }
      return null;
    },
    Legend: Mock,
  };
});

describe('SummaryPage', () => {
  const mockAPI = createMockElectronAPI();
  const generateSchedule = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    generateSchedule.mockResolvedValue({
      paychecks: [
        {
          date: '2026-01-15',
          totalIncome: 2000,
          totalBills: 1200,
          budgetRemaining: 800,
          savingsDeposit: 150,
          totalSavings: 150,
          bills: [{ category: 'Housing', amount: 900 }],
        },
      ],
      summary: {
        totalIncome: 2000,
        totalExpenses: 1200,
        totalSavingsDeposits: 150,
        finalSavingsBalance: 150,
      },
    });

    mockUseData.mockReturnValue({
      incomes: [{ id: 'inc-1' }],
      bills: [{ id: 'bill-1' }],
      generateSchedule,
      scheduleStartDate: '2026-01-01',
      scheduleStartingBalance: 1000,
    });
  });

  describe('happy', () => {
    it('renders chart section headings when schedule data exists', async () => {
      renderWithRouter(<SummaryPage />, { mockAPI });

      expect(await screen.findByText('Income vs Expenses')).toBeInTheDocument();
      expect(screen.getByText('Expense Categories')).toBeInTheDocument();
      expect(screen.getByText('Savings Projection')).toBeInTheDocument();
    });
  });

  describe('sad', () => {
    it('shows empty state with no income or bills', () => {
      mockUseData.mockReturnValue({
        incomes: [],
        bills: [],
        generateSchedule,
        scheduleStartDate: '2026-01-01',
        scheduleStartingBalance: 1000,
      });

      renderWithRouter(<SummaryPage />, { mockAPI });
      expect(screen.getByText('Add income and bills to see your budget trends')).toBeInTheDocument();
    });
  });

  describe('hostile', () => {
    it('switches period and updates APY', async () => {
      const user = userEvent.setup();
      renderWithRouter(<SummaryPage />, { mockAPI });

      await waitFor(() => {
        expect(generateSchedule).toHaveBeenCalledWith('2026-01-01', 3, 1000);
      });

      await user.click(screen.getByRole('button', { name: '6 Months' }));

      await waitFor(() => {
        expect(generateSchedule).toHaveBeenCalledWith('2026-01-01', 6, 1000);
      });

      await user.click(screen.getByRole('button', { name: '12 Months' }));
      await waitFor(() => {
        expect(generateSchedule).toHaveBeenCalledWith('2026-01-01', 12, 1000);
      });

      await user.click(screen.getByRole('button', { name: '3 Months' }));
      await waitFor(() => {
        expect(generateSchedule).toHaveBeenCalledWith('2026-01-01', 3, 1000);
      });

      const apyInput = screen.getByLabelText('APY:');
      await user.clear(apyInput);
      await user.type(apyInput, '4.8');
      await waitFor(() => {
        expect(mockAPI.settings.update).toHaveBeenCalledWith({ savingsAPY: 4.8 });
      });
    });

    it('shows chart empty states when schedule generation returns null', async () => {
      generateSchedule.mockResolvedValueOnce(null);
      renderWithRouter(<SummaryPage />, { mockAPI });

      expect(await screen.findByText('Income vs Expenses')).toBeInTheDocument();
      expect(screen.getByText('No data available')).toBeInTheDocument();
      expect(screen.getByText('No expense data available')).toBeInTheDocument();
      expect(screen.getByText('No savings data available')).toBeInTheDocument();
    });

    it('renders category breakdown and savings projection with APY interest', async () => {
      generateSchedule.mockResolvedValue({
        paychecks: [
          {
            date: '2026-01-15',
            totalIncome: 2000,
            totalBills: 1200,
            budgetRemaining: 800,
            savingsDeposit: 150,
            totalSavings: 150,
            bills: [
              { category: 'Housing', amount: 900 },
              { category: 'Food', amount: 300 },
              { amount: 50 },
            ],
          },
          {
            date: '2026-02-15',
            totalIncome: 2000,
            totalBills: 1000,
            budgetRemaining: 1000,
            savingsDeposit: 200,
            totalSavings: 350,
            bills: [{ category: 'Housing', amount: 700 }],
          },
        ],
        summary: {
          totalIncome: 4000,
          totalExpenses: 2200,
          totalSavingsDeposits: 350,
          finalSavingsBalance: 350,
        },
      });

      renderWithRouter(<SummaryPage />, { mockAPI });
      expect(await screen.findByText('Income vs Expenses')).toBeInTheDocument();
      expect(screen.getByText('Housing')).toBeInTheDocument();
      expect(screen.getByText('Food')).toBeInTheDocument();
      expect(screen.getByText('Savings Projection')).toBeInTheDocument();
    });
  });
});
