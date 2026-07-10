import { describe, it, expect } from 'vitest';
import { parseISO } from 'date-fns';
import {
  buildEligibleBills,
  getEligiblePaycheckIndices,
  latestEligibleIndex,
} from '../../../electron/services/scheduler/eligibility';
import { PaycheckAssignment, ProjectedBill } from '../../../electron/services/scheduler/types';

function paycheck(dateStr: string, income = 1000): PaycheckAssignment {
  return {
    date: parseISO(dateStr),
    incomes: [{ date: parseISO(dateStr), sourceId: 'inc-1', sourceName: 'Job', amount: income }],
    bills: [],
  };
}

function bill(dueStr: string, amount = 100): ProjectedBill {
  const date = parseISO(dueStr);
  return {
    date,
    billId: `bill-${dueStr}`,
    creditorName: 'Test',
    amount,
    dueDay: date.getDate(),
    priority: 'normal',
  };
}

describe('eligibility', () => {
  const assignments: PaycheckAssignment[] = [
    paycheck('2026-08-07'),
    paycheck('2026-08-14'),
    paycheck('2026-08-21'),
  ];

  it('includes paychecks within 14 days on or before due date', () => {
    const b = bill('2026-08-25');
    const indices = getEligiblePaycheckIndices(b, assignments);
    expect(indices).toEqual([1, 2]);
  });

  it('excludes paychecks after due date', () => {
    const b = bill('2026-08-10');
    const indices = getEligiblePaycheckIndices(b, assignments);
    expect(indices).toEqual([0]);
  });

  it('respects skipped bill on a paycheck', () => {
    const b = bill('2026-08-25');
    const skipped = new Set(['bill-2026-08-25-2026-08-14']);
    const indices = getEligiblePaycheckIndices(b, assignments, skipped);
    expect(indices).not.toContain(1);
  });

  it('latestEligibleIndex returns the due-adjacent paycheck', () => {
    expect(latestEligibleIndex([0, 1, 2])).toBe(2);
  });

  it('buildEligibleBills returns stable sorted keys', () => {
    const bills = [bill('2026-08-25', 50), bill('2026-08-20', 75)];
    const eligible = buildEligibleBills(bills, assignments);
    expect(eligible).toHaveLength(2);
    expect(eligible[0].billKey <= eligible[1].billKey).toBe(true);
  });
});
