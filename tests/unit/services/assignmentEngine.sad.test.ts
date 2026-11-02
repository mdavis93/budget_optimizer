/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { assignBillsExact } from '../../../electron/services/scheduler/exactAssignment';
import { buildAssignmentModel } from '../../../electron/services/scheduler/model/assignmentModel';
import { GreedySolver } from '../../../electron/services/scheduler/solvers/greedySolver';
import type { ProjectedBill, ProjectedIncome } from '../../../electron/services/scheduler/types';

function income(date: string, amount: number, sourceId = 'job'): ProjectedIncome {
  return {
    date: new Date(`${date}T00:00:00`),
    sourceId,
    sourceName: 'Pay',
    amount,
  };
}

function bill(
  overrides: Partial<ProjectedBill> & Pick<ProjectedBill, 'billId' | 'amount' | 'date'>
): ProjectedBill {
  return {
    creditorName: overrides.creditorName ?? overrides.billId,
    dueDay: overrides.dueDay ?? 1,
    priority: overrides.priority ?? 'normal',
    ...overrides,
  };
}

describe('assignment engine sad paths', () => {
  it('leaves every bill unpaid when income is zero', () => {
    const assignments = assignBillsExact(
      [new Date('2026-01-02T00:00:00')],
      [income('2026-01-02', 0)],
      [bill({ billId: 'rent', amount: 800, date: new Date('2026-01-10T00:00:00'), dueDay: 10 })],
      0
    );
    expect(assignments[0].bills[0]?.isUnpayable).toBe(true);
    expect(assignments[0].bills[0]?.unfundableReason).toBe('insufficient_income_in_window');
  });

  it('keeps locked bills on their paycheck when they overflow income', () => {
    const assignments = assignBillsExact(
      [new Date('2026-01-02T00:00:00'), new Date('2026-01-16T00:00:00')],
      [income('2026-01-02', 100), income('2026-01-16', 2000)],
      [bill({ billId: 'rent', amount: 800, date: new Date('2026-01-20T00:00:00'), dueDay: 20 })],
      0,
      { manualAssignments: new Map([['rent-2026-01-20', '2026-01-02']]) }
    );
    expect(assignments[0].bills[0]?.billId).toBe('rent');
    expect(assignments[0].bills[0]?.isUnpayable).toBe(true);
  });

  it('uses all_movable_bills_locked when every other bill on the paycheck is pinned', () => {
    const assignments = assignBillsExact(
      [new Date('2026-01-02T00:00:00')],
      [income('2026-01-02', 500)],
      [
        bill({
          billId: 'rent',
          amount: 400,
          date: new Date('2026-01-10T00:00:00'),
          dueDay: 10,
          priority: 'critical',
        }),
        bill({
          billId: 'gym',
          amount: 400,
          date: new Date('2026-01-12T00:00:00'),
          dueDay: 12,
          priority: 'low',
        }),
      ],
      0,
      { manualAssignments: new Map([['rent-2026-01-10', '2026-01-02']]) }
    );
    const gym = assignments[0].bills.find((item) => item.billId === 'gym');
    expect(gym?.isUnpayable).toBe(true);
    expect(gym?.unfundableReason).toBe('all_movable_bills_locked');
  });

  it('records limit_hit when greedy exceeds the named work cap', () => {
    const model = buildAssignmentModel({
      paycheckDates: [new Date('2026-01-02T00:00:00'), new Date('2026-01-16T00:00:00')],
      incomes: [income('2026-01-02', 2000), income('2026-01-16', 2000)],
      bills: [bill({ billId: 'rent', amount: 100, date: new Date('2026-01-20T00:00:00'), dueDay: 20 })],
      startingBalance: 0,
    });
    const result = new GreedySolver(1).solve(model);
    expect(result.fallbackReason).toBe('limit_hit');
    expect(result.workCount).toBeGreaterThan(1);
  });
});
