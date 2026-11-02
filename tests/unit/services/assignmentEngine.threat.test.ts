/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { MAX_MONEY } from '../../../electron/services/validation.service';
import {
  AssignmentModelError,
  buildAssignmentModel,
} from '../../../electron/services/scheduler/model/assignmentModel';
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

describe('assignment engine threat', () => {
  it('rejects non-finite money', () => {
    expect(() =>
      buildAssignmentModel({
        paycheckDates: [new Date('2026-01-02T00:00:00')],
        incomes: [income('2026-01-02', Number.NaN)],
        bills: [],
        startingBalance: 0,
      })
    ).toThrow(AssignmentModelError);
  });

  it('rejects amounts above MAX_MONEY', () => {
    expect(() =>
      buildAssignmentModel({
        paycheckDates: [new Date('2026-01-02T00:00:00')],
        incomes: [income('2026-01-02', MAX_MONEY + 1)],
        bills: [],
        startingBalance: 0,
      })
    ).toThrow(AssignmentModelError);
  });

  it('treats __proto__ and constructor ids as ordinary strings', () => {
    const model = buildAssignmentModel({
      paycheckDates: [new Date('2026-01-02T00:00:00')],
      incomes: [income('2026-01-02', 2000, 'constructor')],
      bills: [
        bill({
          billId: '__proto__',
          creditorName: 'constructor',
          amount: 100,
          date: new Date('2026-01-10T00:00:00'),
          dueDay: 10,
        }),
      ],
      startingBalance: 0,
    });
    expect(model.billIds).toContain('__proto__');
    expect(model.creditorNames).toContain('constructor');
    const result = new GreedySolver().solve(model);
    expect(result.placement.length).toBe(1);
    expect(Object.prototype.hasOwnProperty.call(model, 'polluted')).toBe(false);
  });

  it('stays under the named work cap on a max-size input', () => {
    const paycheckDates = Array.from({ length: 26 }, (_, index) => new Date(Date.UTC(2026, 0, 2 + index * 14)));
    const incomes = paycheckDates.map((date, index) =>
      income(date.toISOString().slice(0, 10), 3000, `inc-${index}`)
    );
    const bills = Array.from({ length: 40 }, (_, index) =>
      bill({
        billId: `bill-${index}`,
        amount: 50,
        date: new Date(Date.UTC(2026, 0, 10 + (index % 20))),
        dueDay: 10 + (index % 20),
        priority: 'normal',
      })
    );
    const model = buildAssignmentModel({
      paycheckDates,
      incomes,
      bills,
      startingBalance: 0,
    });
    const result = new GreedySolver().solve(model);
    expect(result.workCount).toBeLessThan(GREEDY_MAX_WORK);
    expect(result.optimal).toBe(true);
  });
});
