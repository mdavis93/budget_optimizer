import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import PaycheckDetails from '../../src/components/schedule/PaycheckDetails';
import type { PaycheckEntry } from '../../src/types';

const basePaycheck: PaycheckEntry = {
  date: '2026-01-15',
  incomeSources: [{ id: 'inc', name: 'Job', amount: 2000 }],
  totalIncome: 2000,
  bills: [],
  totalBills: 0,
  goalDeposits: [],
  totalGoalDeposits: 0,
  budgetRemaining: 250,
  savingsDeposit: 0,
  totalSavings: 0,
  isShortfall: false,
};

function renderDetails(paycheck: PaycheckEntry) {
  render(
    <PaycheckDetails
      paycheck={paycheck}
      formatCurrency={(amount) => `$${amount.toFixed(2)}`}
      onSkipBill={vi.fn()}
      onUnskipBill={vi.fn()}
      skippingBill={null}
      unskippingBill={null}
      onRestoreBill={vi.fn()}
      restoringBill={null}
      onDragStart={vi.fn()}
      onDragEnd={vi.fn()}
      draggedBill={null}
      billAssignments={[]}
      isAssigning={false}
      incomeOverrides={[]}
      onSaveIncomeOverride={vi.fn()}
      onClearIncomeOverride={vi.fn()}
      savingIncomeKey={null}
    />
  );
}

describe('PaycheckDetails debt paydown', () => {
  it('renders Debt paydown only when payments exist', () => {
    const { unmount } = render(
      <PaycheckDetails
        paycheck={basePaycheck}
        formatCurrency={(amount) => `$${amount.toFixed(2)}`}
        onSkipBill={vi.fn()}
        onUnskipBill={vi.fn()}
        skippingBill={null}
        unskippingBill={null}
        onRestoreBill={vi.fn()}
        restoringBill={null}
        onDragStart={vi.fn()}
        onDragEnd={vi.fn()}
        draggedBill={null}
        billAssignments={[]}
        isAssigning={false}
        incomeOverrides={[]}
        onSaveIncomeOverride={vi.fn()}
        onClearIncomeOverride={vi.fn()}
        savingIncomeKey={null}
      />
    );
    expect(screen.queryByText(/Debt paydown/)).not.toBeInTheDocument();
    unmount();

    renderDetails({
      ...basePaycheck,
      debtPayments: [{ debtId: 'd1', billId: 'b1', creditorName: 'Card', amount: 40 }],
      totalDebtPayments: 40,
    });
    expect(screen.getByText('Debt paydown (1)')).toBeInTheDocument();
    expect(screen.getByText('Debt: Card')).toBeInTheDocument();
  });
});
