import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReconciliationPage from '../../src/components/ReconciliationPage';

const baseReport = {
  needsReconciliation: true,
  totalDeficit: 500,
  estimatedResolution: 500,
  canBeFullyResolved: true,
  shortfalls: [
    {
      paycheckDate: '2026-02-15',
      deficit: 500,
      bills: [
        {
          billId: 'bill-1',
          creditorName: 'Rent',
          amount: 500,
          dueDay: 1,
          billDate: '2026-02-01',
          priority: 'critical' as const,
          isIncomeAttached: false,
        },
      ],
      totalBills: 500,
      availableBalance: 0,
    },
  ],
  proposedFixes: [
    {
      id: 'fix-1',
      type: 'skip_bill' as const,
      billId: 'bill-1',
      billName: 'Rent',
      billAmount: 500,
      billDueDate: '2026-02-01',
      fromPaycheckDate: '2026-02-15',
      toPaycheckDate: undefined,
      reason: 'skip helps avoid shortfall',
      impact: 500,
    },
  ],
};

describe('ReconciliationPage', () => {
  describe('happy', () => {
    it('applies selected fixes', async () => {
      const onApplyFixes = vi.fn(async () => {});
      render(<ReconciliationPage report={baseReport} onApplyFixes={onApplyFixes} onSkip={vi.fn()} isApplying={false} />);

      fireEvent.click(screen.getByRole('button', { name: /Apply 1 Fix/i }));
      await waitFor(() => expect(onApplyFixes).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ id: 'fix-1' })])));
    });
  });

  describe('sad', () => {
    it('shows no-fixes message when reconciliation has no proposed fixes', () => {
      render(
        <ReconciliationPage
          report={{ ...baseReport, proposedFixes: [] }}
          onApplyFixes={vi.fn(async () => {})}
          onSkip={vi.fn()}
          isApplying={false}
        />
      );

      expect(screen.getByText('No Automatic Fixes Available')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Apply/i })).not.toBeInTheDocument();
    });
  });

  describe('hostile', () => {
    it('disables apply when all fixes are deselected', () => {
      render(<ReconciliationPage report={baseReport} onApplyFixes={vi.fn(async () => {})} onSkip={vi.fn()} isApplying={false} />);

      fireEvent.click(screen.getByRole('button', { name: 'Select None' }));
      expect(screen.getByRole('button', { name: /Apply 0 Fixes/i })).toBeDisabled();
    });

    it('handles mixed move/skip fix selection', async () => {
      const user = userEvent.setup();
      const onApplyFixes = vi.fn(async () => {});
      render(
        <ReconciliationPage
          report={{
            ...baseReport,
            proposedFixes: [
              ...baseReport.proposedFixes,
              {
                id: 'fix-2',
                type: 'move_bill',
                billId: 'bill-1',
                billName: 'Rent',
                billAmount: 500,
                billDueDate: '2026-02-01',
                fromPaycheckDate: '2026-02-15',
                toPaycheckDate: '2026-03-01',
                reason: 'move to next paycheck',
                impact: 300,
              },
            ],
          }}
          onApplyFixes={onApplyFixes}
          onSkip={vi.fn()}
          isApplying={false}
        />
      );

      const checkboxes = screen.getAllByRole('checkbox');
      await user.click(checkboxes[0]);
      await user.click(screen.getByRole('button', { name: /Apply 1 Fix/i }));
      await waitFor(() => {
        expect(onApplyFixes).toHaveBeenCalledWith([expect.objectContaining({ id: 'fix-2', type: 'move_bill' })]);
      });
    });
  });
});
