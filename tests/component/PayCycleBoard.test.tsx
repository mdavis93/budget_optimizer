import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { TestMemoryRouter } from '../helpers/router';
import PayCycleBoard from '../../src/components/dashboard/PayCycleBoard';
import type { PayCycleBoardModel } from '../../src/utils/payCycleBoard';
import { formatCurrency } from '../../src/utils/formatCurrency';

const formatWholeCurrency = (amount: number) => formatCurrency(amount, { fractionDigits: 0 });

function boardFixture(overrides: Partial<PayCycleBoardModel> = {}): PayCycleBoardModel {
  return {
    paydayIso: '2026-11-06',
    periodEndIso: '2026-11-19',
    periodEndAvailable: true,
    visibleStartIso: '2026-11-01',
    visibleEndIso: '2026-11-19',
    totalIncome: 2400,
    totalBills: 1860,
    totalGoalDeposits: 0,
    savingsDeposit: 0,
    budgetRemaining: 540,
    isShortfall: false,
    days: [
      {
        isoDate: '2026-11-01',
        inPeriod: false,
        isPayday: false,
        depositAmount: null,
        bills: [],
      },
      {
        isoDate: '2026-11-03',
        inPeriod: false,
        isPayday: false,
        depositAmount: null,
        bills: [],
      },
      {
        isoDate: '2026-11-05',
        inPeriod: false,
        isPayday: false,
        depositAmount: null,
        bills: [],
      },
      {
        isoDate: '2026-11-06',
        inPeriod: true,
        isPayday: true,
        depositAmount: 2400,
        bills: [],
      },
      {
        isoDate: '2026-11-08',
        inPeriod: true,
        isPayday: false,
        depositAmount: null,
        bills: [
          {
            billId: 'car',
            creditorName: 'Car (Rav4)',
            amount: 400,
            billDate: '2026-11-08',
            paidByPaycheckDate: '2026-11-06',
            coverage: 'highlighted',
            isUnpayable: false,
          },
          {
            billId: 'affirm',
            creditorName: 'Affirm: Amazon',
            amount: 42,
            billDate: '2026-11-08',
            paidByPaycheckDate: '2026-11-06',
            coverage: 'highlighted',
            isUnpayable: false,
          },
        ],
      },
      {
        isoDate: '2026-11-18',
        inPeriod: true,
        isPayday: false,
        depositAmount: null,
        bills: [
          {
            billId: 'rent',
            creditorName: 'Rent',
            amount: 1200,
            billDate: '2026-11-18',
            paidByPaycheckDate: '2026-11-20',
            coverage: 'other',
            isUnpayable: false,
          },
        ],
      },
      {
        isoDate: '2026-11-19',
        inPeriod: true,
        isPayday: false,
        depositAmount: null,
        bills: [],
      },
    ],
    dueAfterPeriod: [
      {
        billId: 'late',
        creditorName: 'Late Bill',
        amount: 50,
        billDate: '2026-11-22',
        paidByPaycheckDate: '2026-11-06',
        coverage: 'highlighted',
        isUnpayable: false,
      },
    ],
    dueEarlierThisPeriod: [
      {
        billId: 'early',
        creditorName: 'Early Bill',
        amount: 30,
        billDate: '2026-11-07',
        paidByPaycheckDate: '2026-11-06',
        coverage: 'highlighted',
        isUnpayable: false,
      },
    ],
    ...overrides,
  };
}

function renderBoard(
  board: PayCycleBoardModel = boardFixture(),
  todayIso = '2026-11-03'
) {
  return render(
    <TestMemoryRouter>
      <PayCycleBoard board={board} todayIso={todayIso} formatCurrency={formatWholeCurrency} />
    </TestMemoryRouter>
  );
}

describe('PayCycleBoard', () => {
  describe('happy', () => {
    it('renders figure row, deposit, chips, shade markers, legend, and both off-grid lists', () => {
      renderBoard();

      expect(screen.getByText('Income')).toBeInTheDocument();
      expect(screen.getByText('$2,400')).toBeInTheDocument();
      expect(screen.getByText('Bills')).toBeInTheDocument();
      expect(screen.getByText('$1,860')).toBeInTheDocument();
      expect(screen.getByText('Left')).toBeInTheDocument();
      expect(screen.getByTestId('pay-cycle-remainder')).toHaveTextContent('$540');
      expect(screen.getByText('Fri, Nov 6')).toBeInTheDocument();

      expect(screen.getByText('Paid by this paycheck')).toBeInTheDocument();
      expect(screen.getByText('Paid by another paycheck')).toBeInTheDocument();
      expect(screen.queryByText(/Lorem ipsum/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/through Thu, Nov 19/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Due before/i)).not.toBeInTheDocument();
      expect(screen.queryByText('Goals')).not.toBeInTheDocument();
      expect(screen.queryByText('Savings')).not.toBeInTheDocument();

      const todayCell = screen.getByTestId('pay-cycle-day-2026-11-03');
      expect(todayCell).toHaveAttribute('data-today', 'true');

      const paydayCell = screen.getByTestId('pay-cycle-day-2026-11-06');
      expect(paydayCell).toHaveAttribute('data-in-period', 'true');
      expect(paydayCell).toHaveAttribute('data-today', 'false');
      expect(within(paydayCell).getByText('+$2,400')).toBeInTheDocument();

      const outsideCell = screen.getByTestId('pay-cycle-day-2026-11-05');
      expect(outsideCell).toHaveAttribute('data-in-period', 'false');

      const nov8 = screen.getByTestId('pay-cycle-day-2026-11-08');
      expect(within(nov8).getByText('Car (Rav4)')).toBeInTheDocument();
      expect(within(nov8).getByText('Affirm: Amazon')).toBeInTheDocument();
      expect(within(nov8).getByText('$400')).toBeInTheDocument();
      expect(within(nov8).getByText('Car (Rav4)').closest('[data-coverage]')).toHaveAttribute(
        'data-coverage',
        'highlighted'
      );

      const nov18 = screen.getByTestId('pay-cycle-day-2026-11-18');
      const outlineChip = within(nov18).getByText('Rent').closest('[data-coverage]');
      expect(outlineChip).toHaveAttribute('data-coverage', 'other');
      expect(within(nov18).getByText(/Nov 20/i)).toBeInTheDocument();

      expect(screen.getByText(/Also paid by Nov 6, due after Nov 19/i)).toBeInTheDocument();
      expect(screen.getByText(/Late Bill/)).toBeInTheDocument();
      expect(screen.getByText(/due Nov 22/i)).toBeInTheDocument();

      expect(screen.getByText('Due earlier this pay period')).toBeInTheDocument();
      expect(screen.getByText(/Early Bill/)).toBeInTheDocument();

      const scheduleLink = screen.getByRole('link', { name: /View month/i });
      expect(scheduleLink).toHaveAttribute('href', '/schedule');
    });

    it('colors the remainder when the model marks a shortfall', () => {
      renderBoard(boardFixture({ isShortfall: true, budgetRemaining: 40 }));

      const remainder = screen.getByTestId('pay-cycle-remainder');
      expect(remainder).toHaveTextContent('$40');
      expect(remainder).toHaveAttribute('data-shortfall', 'true');
    });

    it('shows Goals and Savings figures only when amounts are positive', () => {
      const { rerender } = render(
        <TestMemoryRouter>
          <PayCycleBoard
            board={boardFixture({ totalGoalDeposits: 100, savingsDeposit: 50 })}
            todayIso="2026-11-03"
            formatCurrency={formatWholeCurrency}
          />
        </TestMemoryRouter>
      );

      const goalsLabel = screen.getByText('Goals');
      expect(goalsLabel.parentElement).toHaveTextContent('$100');
      const savingsLabel = screen.getByText('Savings');
      expect(savingsLabel.parentElement).toHaveTextContent('$50');

      rerender(
        <TestMemoryRouter>
          <PayCycleBoard
            board={boardFixture({ totalGoalDeposits: 0, savingsDeposit: 0 })}
            todayIso="2026-11-03"
            formatCurrency={formatWholeCurrency}
          />
        </TestMemoryRouter>
      );

      expect(screen.queryByText('Goals')).not.toBeInTheDocument();
      expect(screen.queryByText('Savings')).not.toBeInTheDocument();
    });
  });
});
