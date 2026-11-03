/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import {
  buildAssignmentModel,
  remainingCentsForPlacement,
} from '../../../electron/services/scheduler/model/assignmentModel';
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

  it('repairs every paycheck that can reach its minimum, not just one', () => {
    const model = buildAssignmentModel({
      paycheckDates: [
        new Date('2026-11-06T00:00:00'),
        new Date('2026-11-13T00:00:00'),
        new Date('2026-11-20T00:00:00'),
      ],
      incomes: [
        income('2026-11-06', 2000, 'early'),
        income('2026-11-13', 500, 'mid'),
        income('2026-11-20', 500, 'late'),
      ],
      bills: [
        bill({
          billId: 'mid-bill',
          amount: 450,
          date: new Date('2026-11-16T00:00:00'),
          dueDay: 16,
        }),
        bill({
          billId: 'late-bill',
          amount: 450,
          date: new Date('2026-11-21T00:00:00'),
          dueDay: 21,
        }),
      ],
      startingBalance: 0,
      minCashOnHand: 100,
      targetCashOnHand: 200,
    });
    const first = new GreedySolver().solve(model);
    const second = new GreedySolver().solve(model);
    expect([...first.placement]).toEqual([...second.placement]);
    const remaining = remainingCentsForPlacement(model, first.placement);
    expect(remaining[1]).toBeGreaterThanOrEqual(10_000);
    expect(remaining[2]).toBeGreaterThanOrEqual(10_000);
  });

  it('pays a bill that fits only after an earlier bill moves off the paycheck', () => {
    const early = '2026-11-06';
    const late = '2026-11-20';
    const model = buildAssignmentModel({
      paycheckDates: [new Date(`${early}T00:00:00`), new Date(`${late}T00:00:00`)],
      incomes: [income(early, 800, 'early'), income(late, 200, 'late')],
      bills: [
        bill({
          billId: 'anchor',
          amount: 150,
          date: new Date('2026-11-27T00:00:00'),
          dueDay: 27,
          priority: 'critical',
        }),
        bill({
          billId: 'slider-a',
          amount: 90,
          date: new Date('2026-11-23T00:00:00'),
          dueDay: 23,
        }),
        bill({
          billId: 'slider-b',
          amount: 90,
          date: new Date('2026-11-24T00:00:00'),
          dueDay: 24,
        }),
        bill({
          billId: 'fragile',
          amount: 40,
          date: new Date('2026-11-28T00:00:00'),
          dueDay: 28,
        }),
      ],
      startingBalance: 0,
      minCashOnHand: 50,
      targetCashOnHand: 200,
      manualAssignments: new Map([['anchor-2026-11-27', early]]),
    });
    const result = new GreedySolver().solve(model);
    const fragile = model.billIds.indexOf('fragile');
    expect(result.placement[fragile]).not.toBe(UNPAID_PLACEMENT);
    const remaining = remainingCentsForPlacement(model, result.placement);
    expect(remaining[1]).toBeGreaterThanOrEqual(5_000);
  });

  it('pays an unpaid bill by moving one other bill when the pair scores better', () => {
    const earlier = '2026-12-18';
    const later = '2027-01-01';
    const model = buildAssignmentModel({
      paycheckDates: [new Date(`${earlier}T00:00:00`), new Date(`${later}T00:00:00`)],
      incomes: [income(earlier, 120, 'earlier'), income(later, 475, 'later')],
      bills: [
        bill({
          billId: 'life',
          amount: 100,
          date: new Date('2027-01-02T00:00:00'),
          dueDay: 2,
        }),
        bill({
          billId: 'cell',
          amount: 475,
          date: new Date('2027-01-09T00:00:00'),
          dueDay: 9,
        }),
      ],
      startingBalance: 0,
      minCashOnHand: 50,
      targetCashOnHand: 200,
    });
    const result = new GreedySolver().solve(model);
    const life = model.billIds.indexOf('life');
    const cell = model.billIds.indexOf('cell');
    expect(result.placement[cell]).toBe(1);
    expect(result.placement[life]).toBe(0);
    const remaining = remainingCentsForPlacement(model, result.placement);
    expect(remaining[0]).toBe(2_000);
    expect(remaining[1]).toBe(0);
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
