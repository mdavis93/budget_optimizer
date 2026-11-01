/**
 * @vitest-environment node
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { buildAssignmentModel } from '../../../electron/services/scheduler/model/assignmentModel';
import { UNPAID_PLACEMENT, compareTierVectors } from '../../../electron/services/scheduler/model/objective';
import {
  HighsSolver,
  buildLpText,
  createHighsSolver,
  greedyWarmStart,
  isHighsLimitStatus,
  isHighsOptimal,
  scoreModel,
} from '../../../electron/services/scheduler/solvers/highsSolver';
import { loadHighs } from '../../../electron/services/scheduler/solvers/loadHighs';
import { bruteForceOracle } from '../../helpers/bruteForceOracle';
import { modelFromScenario } from '../../helpers/assignmentModelHarness';
import { scenarioById } from '../../fixtures/scheduler/corpus';
import type { ProjectedBill, ProjectedIncome } from '../../../electron/services/scheduler/types';
import type { LegacyHighs } from 'highs';

function income(date: string, amount: number): ProjectedIncome {
  return {
    date: new Date(`${date}T00:00:00`),
    sourceId: 'job',
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

describe('highsSolver', () => {
  let solver: HighsSolver;

  beforeAll(async () => {
    solver = createHighsSolver(await loadHighs()) as HighsSolver;
  });

  it('pays the latest feasible paycheck and protects petty cash before days-early', () => {
    const model = buildAssignmentModel({
      paycheckDates: [new Date('2026-01-01T00:00:00'), new Date('2026-01-15T00:00:00')],
      incomes: [income('2026-01-01', 400), income('2026-01-15', 400)],
      bills: [
        bill({
          billId: 'rent',
          creditorName: 'Rent',
          amount: 150,
          date: new Date('2026-01-20T00:00:00'),
          dueDay: 20,
          priority: 'critical',
        }),
      ],
      startingBalance: 0,
      minCashOnHand: 100,
      targetCashOnHand: 250,
    });
    const result = solver.solve(model);
    expect(result.optimal).toBe(true);
    expect(result.placement[0]).toBe(1);
    expect(scoreModel(model, result.placement)[5]).toBe(0);
  });

  it('pays rent before gym when income cannot cover both', () => {
    const model = buildAssignmentModel({
      paycheckDates: [new Date('2026-01-15T00:00:00')],
      incomes: [income('2026-01-15', 500)],
      bills: [
        bill({
          billId: 'gym',
          amount: 200,
          date: new Date('2026-01-20T00:00:00'),
          priority: 'low',
        }),
        bill({
          billId: 'rent',
          amount: 400,
          date: new Date('2026-01-20T00:00:00'),
          priority: 'critical',
        }),
      ],
      startingBalance: 0,
      minCashOnHand: 0,
      targetCashOnHand: 0,
    });
    const result = solver.solve(model);
    const rent = model.billIds.indexOf('rent');
    const gym = model.billIds.indexOf('gym');
    expect(result.placement[rent]).toBe(0);
    expect(result.placement[gym]).toBe(UNPAID_PLACEMENT);
  });

  it('matches the brute-force oracle on a tiny instance', () => {
    const model = buildAssignmentModel({
      paycheckDates: [new Date('2026-01-01T00:00:00'), new Date('2026-01-15T00:00:00')],
      incomes: [income('2026-01-01', 300), income('2026-01-15', 300)],
      bills: [
        bill({
          billId: 'a',
          amount: 200,
          date: new Date('2026-01-18T00:00:00'),
          priority: 'critical',
        }),
        bill({
          billId: 'b',
          amount: 180,
          date: new Date('2026-01-20T00:00:00'),
          priority: 'high',
        }),
      ],
      startingBalance: 0,
      minCashOnHand: 50,
      targetCashOnHand: 100,
    });
    const highs = solver.solve(model);
    const oracle = bruteForceOracle({
      bills: Array.from({ length: model.billCount }, (_, index) => ({
        amountCents: model.amountCents[index],
        priority:
          model.priorityTier[index] === 1
            ? 'critical'
            : model.priorityTier[index] === 2
              ? 'high'
              : model.priorityTier[index] === 3
                ? 'normal'
                : 'low',
        dueDay: model.dueDay[index],
        eligiblePaycheckIndexes: Array.from(
          model.eligibilityIndices.subarray(
            model.eligibilityOffsets[index],
            model.eligibilityOffsets[index + 1]
          )
        ),
        isPinned: model.isPinned[index] === 1,
      })),
      paychecks: Array.from({ length: model.paycheckCount }, (_, index) => ({
        day: model.paycheckDay[index],
        capacityCents: model.incomeCents[index],
        minCashCents: model.minCashCents[index],
        targetCashCents: model.targetCashCents[index],
      })),
    });
    expect(compareTierVectors(scoreModel(model, highs.placement), oracle.vector)).toBe(0);
  });

  it('keeps user strings out of the LP text', () => {
    const model = buildAssignmentModel({
      paycheckDates: [new Date('2026-01-15T00:00:00')],
      incomes: [income('2026-01-15', 2000)],
      bills: [
        bill({
          billId: '__proto__',
          creditorName: 'Evil Credit Union',
          amount: 25,
          date: new Date('2026-01-20T00:00:00'),
        }),
      ],
      startingBalance: 0,
    });
    const lp = buildLpText(model, { minimizeTier: 3, holds: [] });
    expect(lp.variableNames).toEqual(['v0']);
    expect(lp.text).toContain('v0');
    expect(lp.text).not.toContain('Evil Credit Union');
    expect(lp.text).not.toContain('__proto__');
    expect(lp.text).not.toContain(model.billIds[0] === 'v0' ? 'never' : model.billIds[0]);
  });

  it('returns a non-optimal result when HiGHS is not optimal', () => {
    const highs = {
      solve: () => ({ Status: 'Time limit reached' }),
    } as unknown as LegacyHighs;
    const model = buildAssignmentModel({
      paycheckDates: [new Date('2026-01-15T00:00:00')],
      incomes: [income('2026-01-15', 100)],
      bills: [
        bill({
          billId: 'rent',
          amount: 80,
          date: new Date('2026-01-20T00:00:00'),
          priority: 'critical',
        }),
      ],
      startingBalance: 0,
      minCashOnHand: 0,
      targetCashOnHand: 250,
    });
    const result = new HighsSolver(highs).solve(model);
    expect(result.optimal).toBe(false);
    expect(result.fallbackReason).toBe('limit_hit');
    expect(isHighsLimitStatus('Time limit reached')).toBe(true);
    expect(isHighsOptimal('Infeasible')).toBe(false);
  });

  it('produces a feasible greedy warm start', () => {
    const model = modelFromScenario(scenarioById('monthly-pay'));
    const placement = greedyWarmStart(model);
    expect(placement.length).toBe(model.billCount);
    const remaining = Array.from({ length: model.paycheckCount }, (_, index) => model.incomeCents[index]);
    for (let billIndex = 0; billIndex < model.billCount; billIndex++) {
      const paycheckIndex = placement[billIndex];
      if (paycheckIndex === UNPAID_PLACEMENT) continue;
      remaining[paycheckIndex] -= model.amountCents[billIndex];
    }
    expect(remaining.every((value) => value >= 0)).toBe(true);
  });
});
