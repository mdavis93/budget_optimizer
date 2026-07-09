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
          unfundableReason: 'insufficient_income_in_window',
        },
      ],
    };

    const copy = formatShortfallCopy(shortfall);
    expect(copy.headline).toBe('Mar 15 shortfall: $175.00');
    expect(copy.explanation).toContain('eligibility window');
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
    expect(summary.body).not.toContain('skip');
  });

  it('summarizes partially resolvable reconciliation reports', () => {
    const summary = formatReconciliationSummary({
      shortfalls: [
        { paycheckDate: '2026-03-15', deficit: 100, bills: [] },
        { paycheckDate: '2026-04-15', deficit: 50, bills: [] },
      ],
      totalDeficit: 150,
      canBeFullyResolved: false,
    });
    expect(summary.headline).toBe('Some shortfalls need manual changes');
    expect(summary.body).toContain('Applied fixes may not cover everything');
  });

  it('labels unfundable reason codes for accessibility', () => {
    const copy = formatUnfundableReasonCopy('no_eligible_paycheck_in_window', {
      billName: 'Insurance',
      fromPaycheckDate: 'Mar 15',
    });
    expect(copy.label).toBe('No Eligible Paycheck');
    expect(copy.explanation).toContain('Insurance');
    expect(copy.poolHint).toContain('due date');
  });
});
