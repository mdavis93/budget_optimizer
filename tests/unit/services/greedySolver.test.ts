/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { buildAssignmentModel } from '../../../electron/services/scheduler/model/assignmentModel';
import { UNPAID_PLACEMENT } from '../../../electron/services/scheduler/model/objective';
import { GREEDY_MAX_WORK, GreedySolver } from '../../../electron/services/scheduler/solvers/greedySolver';
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

describe('GreedySolver', () => {
  it('pays the latest paycheck that can cover the bill', () => {
    const model = buildAssignmentModel({
      paycheckDates: [new Date('2026-01-02T00:00:00'), new Date('2026-01-16T00:00:00')],
      incomes: [income('2026-01-02', 2000), income('2026-01-16', 2000)],
      bills: [
        bill({
          billId: 'rent',
          amount: 800,
          date: new Date('2026-01-20T00:00:00'),
          dueDay: 20,
          priority: 'critical',
        }),
      ],
      startingBalance: 0,
    });
    const result = new GreedySolver().solve(model);
    expect(result.solver).toBe('greedy');
    expect(result.withinWorkCap).toBe(true);
    expect(result.placement[0]).toBe(1);
    expect(result.workCount).toBeLessThan(GREEDY_MAX_WORK);
  });

  it('pays a higher-priority bill before a lower-priority one when income is tight', () => {
    const model = buildAssignmentModel({
      paycheckDates: [new Date('2026-01-02T00:00:00')],
      incomes: [income('2026-01-02', 1000)],
      bills: [
        bill({
          billId: 'gym',
          amount: 700,
          date: new Date('2026-01-05T00:00:00'),
          dueDay: 5,
          priority: 'low',
        }),
        bill({
          billId: 'rent',
          amount: 800,
          date: new Date('2026-01-10T00:00:00'),
          dueDay: 10,
          priority: 'critical',
        }),
      ],
      startingBalance: 0,
    });
    const result = new GreedySolver().solve(model);
    const rent = model.billIds.indexOf('rent');
    const gym = model.billIds.indexOf('gym');
    expect(result.placement[rent]).toBe(0);
    expect(result.placement[gym]).toBe(UNPAID_PLACEMENT);
  });

  it('records limit_hit when the named work cap is exceeded', () => {
    const model = buildAssignmentModel({
      paycheckDates: [new Date('2026-01-02T00:00:00'), new Date('2026-01-16T00:00:00')],
      incomes: [income('2026-01-02', 2000), income('2026-01-16', 2000)],
      bills: [
        bill({
          billId: 'rent',
          amount: 100,
          date: new Date('2026-01-20T00:00:00'),
          dueDay: 20,
        }),
      ],
      startingBalance: 0,
    });
    const result = new GreedySolver(1).solve(model);
    expect(result.withinWorkCap).toBe(false);
    expect(result.fallbackReason).toBe('limit_hit');
  });
});
