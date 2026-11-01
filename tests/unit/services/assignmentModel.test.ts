import { describe, expect, it } from 'vitest';
import { MAX_MONEY } from '../../../electron/services/validation.service';
import {
  AssignmentModelError,
  buildAssignmentModel,
  candidatesForBill,
  modelToObjectiveInput,
} from '../../../electron/services/scheduler/model/assignmentModel';
import { UNPAID_PLACEMENT } from '../../../electron/services/scheduler/model/objective';
import { schedulerCorpus, scenarioById } from '../../fixtures/scheduler/corpus';
import { modelFromScenario } from '../../helpers/assignmentModelHarness';
import { makeBill } from '../../helpers/scheduleFixtures';
import type { ProjectedBill, ProjectedIncome } from '../../../electron/services/scheduler/types';

function income(date: string, amount: number, sourceId = 'job'): ProjectedIncome {
  return {
    date: new Date(`${date}T00:00:00`),
    sourceId,
    sourceName: 'Pay',
    amount,
  };
}

function bill(overrides: Partial<ProjectedBill> & Pick<ProjectedBill, 'billId' | 'amount' | 'date'>): ProjectedBill {
  return {
    creditorName: overrides.creditorName ?? overrides.billId,
    dueDay: overrides.dueDay ?? 1,
    priority: overrides.priority ?? 'normal',
    ...overrides,
  };
}

describe('assignmentModel', () => {
  it('stores cents and CSR eligibility in Int32Arrays', () => {
    const model = buildAssignmentModel({
      paycheckDates: [new Date('2026-01-01T00:00:00'), new Date('2026-01-15T00:00:00')],
      incomes: [income('2026-01-01', 1000), income('2026-01-15', 1000)],
      bills: [
        bill({
          billId: 'rent',
          amount: 400,
          date: new Date('2026-01-20T00:00:00'),
          dueDay: 20,
          priority: 'critical',
        }),
      ],
      startingBalance: 50,
    });

    expect(model.amountCents).toBeInstanceOf(Int32Array);
    expect(model.eligibilityOffsets).toBeInstanceOf(Int32Array);
    expect(model.eligibilityIndices).toBeInstanceOf(Int32Array);
    expect(model.incomeCents[0]).toBe(105_000);
    expect(model.amountCents[0]).toBe(40_000);
    expect(candidatesForBill(model, 0).length).toBeGreaterThan(0);
    expect(model.variableCount).toBe(model.eligibilityIndices.length);
  });

  it('pins locks and income-attached bills and scores preferred in their real tier', () => {
    const model = modelFromScenario(scenarioById('locks-attached-preferred'));
    const rentIndex = model.billIds.findIndex(
      (id, index) => id === 'rent' && model.billDueIso[index] === '2026-01-20'
    );
    const phoneIndex = model.billIds.findIndex(
      (id, index) => id === 'phone' && model.billDueIso[index] === '2026-02-28'
    );
    const duesIndexes = model.billIds.flatMap((id, index) => (id === 'dues' ? [index] : []));

    expect(rentIndex).toBeGreaterThan(-1);
    expect(model.isPinned[rentIndex]).toBe(1);
    expect(model.paycheckIso[model.fixedPaycheck[rentIndex]]).toBe('2026-01-09');
    expect(phoneIndex).toBeGreaterThan(-1);
    expect(model.isPinned[phoneIndex]).toBe(0);
    expect(model.paycheckIso[model.fixedPaycheck[phoneIndex]]).toBe('2026-02-20');
    expect(duesIndexes.length).toBeGreaterThan(0);
    expect(duesIndexes.every((index) => model.isPinned[index] === 1)).toBe(true);
  });

  it('rejects non-finite and huge money values with a typed error', () => {
    const dates = [new Date('2026-01-01T00:00:00')];
    const incomes = [income('2026-01-01', 1000)];
    const bills = [bill({ billId: 'rent', amount: 10, date: dates[0] })];

    expect(() =>
      buildAssignmentModel({
        paycheckDates: dates,
        incomes,
        bills,
        startingBalance: Number.NaN,
      })
    ).toThrow(AssignmentModelError);
    try {
      buildAssignmentModel({
        paycheckDates: dates,
        incomes,
        bills,
        startingBalance: Number.POSITIVE_INFINITY,
      });
      expect.fail('expected non-finite startingBalance to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AssignmentModelError);
      expect((error as AssignmentModelError).code).toBe('non_finite');
    }
    expect(() =>
      buildAssignmentModel({
        paycheckDates: dates,
        incomes,
        bills: [bill({ billId: 'rent', amount: MAX_MONEY + 1, date: dates[0] })],
        startingBalance: 0,
      })
    ).toThrow(/MAX_MONEY/);
  });

  it('keeps hostile ids off object-key assignment state', () => {
    const model = buildAssignmentModel({
      paycheckDates: [new Date('2026-01-15T00:00:00')],
      incomes: [income('2026-01-15', 2000)],
      bills: [
        bill({
          billId: '__proto__',
          creditorName: 'constructor',
          amount: 25,
          date: new Date('2026-01-20T00:00:00'),
        }),
      ],
      startingBalance: 0,
    });
    expect(model.billIds).toEqual(['__proto__']);
    expect(model.creditorNames).toEqual(['constructor']);
    expect(Object.prototype).not.toHaveProperty('2026-01-20');
  });

  it('builds a model for every corpus scenario', () => {
    for (const scenario of schedulerCorpus) {
      const model = modelFromScenario(scenario);
      expect(model.paycheckCount).toBeGreaterThan(0);
      expect(model.eligibilityOffsets.length).toBe(model.billCount + 1);
      const objective = modelToObjectiveInput(
        model,
        Array.from({ length: model.billCount }, () => UNPAID_PLACEMENT)
      );
      expect(objective.bills).toHaveLength(model.billCount);
    }
  });
});

describe('assignmentModel factories', () => {
  it('accepts income-attached bills from the raw template', () => {
    const model = buildAssignmentModel({
      paycheckDates: [new Date('2026-01-02T00:00:00'), new Date('2026-01-16T00:00:00')],
      incomes: [income('2026-01-02', 2000, 'income-a'), income('2026-01-16', 2000, 'income-a')],
      bills: [],
      startingBalance: 0,
      incomeAttachedBillsRaw: [
        makeBill({
          id: 'dues',
          creditorName: 'Dues',
          budgetedAmount: 25,
          dueDay: 2,
          priority: 'high',
          preferredIncomeSourceId: 'income-a',
          isIncomeAttached: true,
        }),
      ],
    });
    expect(model.billCount).toBe(2);
    expect([...model.isPinned]).toEqual([1, 1]);
  });
});
