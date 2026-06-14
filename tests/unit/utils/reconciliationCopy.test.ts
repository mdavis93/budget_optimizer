import { describe, it, expect } from 'vitest';
import {
  formatProposedFixCopy,
  formatShortfallCopy,
  formatReconciliationSummary,
  formatUnfundableReasonCopy,
} from '../../../src/utils/reconciliationCopy';
import { ProposedFix, ShortfallDetail } from '../../../src/types';

const moveFix: ProposedFix = {
  id: 'fix-1',
  type: 'move_bill',
  billId: 'bill-1',
  billName: 'Electric',
  billAmount: 150,
  fromPaycheckDate: '2026-03-15',
  toPaycheckDate: '2026-03-01',
  billDueDate: '2026-03-20',
  reason: 'legacy reason',
  impact: 150,
};

const skipFix: ProposedFix = {
  id: 'fix-2',
  type: 'skip_bill',
  billId: 'bill-2',
  billName: 'Streaming',
  billAmount: 25,
  fromPaycheckDate: '2026-03-15',
  billDueDate: '2026-03-18',
  reason: 'legacy reason',
  impact: 25,
  reasonCode: 'insufficient_income_this_paycheck',
};

describe('reconciliationCopy', () => {
  it('renders move counterfactual with dates and amounts', () => {
    const copy = formatProposedFixCopy(moveFix, { deficitAmount: 200 });
    expect(copy.headline).toBe('Move "Electric"');
    expect(copy.counterfactual).toBe(
      'Move Electric ($150.00) to Mar 1 → clears Mar 15 shortfall'
    );
    expect(copy.ariaMessage).toContain('Mar 15');
    expect(copy.ariaMessage).toContain('$200.00');
  });

  it('uses reason-specific detail for skip proposals', () => {
    const copy = formatProposedFixCopy(skipFix);
    expect(copy.counterfactual).toBe(
      'Skip Streaming ($25.00) on Mar 15 → frees $25.00 toward Mar 15'
    );
    expect(copy.detail).toContain('Mar 15');
    expect(copy.detail).toContain('Streaming');
    expect(copy.detail).not.toBe('Defers this bill for one cycle when no eligible move exists within prepay rules.');
  });

  it('describes shortfall with dominant unfundable reason', () => {
    const shortfall: ShortfallDetail = {
      paycheckDate: '2026-03-15',
      deficit: 175,
      bills: [
        {
          billId: 'bill-2',
          creditorName: 'Streaming',
          amount: 25,
          dueDay: 18,
          priority: 'low',
          billDate: '2026-03-18',
          isUnpayable: true,
          unfundableReason: 'goal_reserve_conflict',
        },
      ],
    };

    const copy = formatShortfallCopy(shortfall);
    expect(copy.headline).toBe('Mar 15 shortfall: $175.00');
    expect(copy.explanation).toContain('Savings goal reserves');
    expect(copy.ariaMessage).toContain('Mar 15');
  });

  it('summarizes fully resolvable reconciliation reports', () => {
    const summary = formatReconciliationSummary({
      shortfalls: [{ paycheckDate: '2026-03-15', deficit: 100, bills: [] }],
      totalDeficit: 100,
      canBeFullyResolved: true,
    });
    expect(summary.headline).toBe('We found fixes for your shortfalls');
    expect(summary.body).toContain('paycheck silo');
  });

  it('labels unfundable reason codes for accessibility', () => {
    const copy = formatUnfundableReasonCopy('no_eligible_earlier_paycheck', {
      billName: 'Insurance',
      fromPaycheckDate: 'Mar 15',
    });
    expect(copy.label).toBe('No Earlier Paycheck');
    expect(copy.explanation).toContain('Insurance');
    expect(copy.poolHint).toContain('too early');
  });
});
