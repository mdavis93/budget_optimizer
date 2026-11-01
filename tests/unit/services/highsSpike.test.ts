/**
 * @vitest-environment node
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { UNPAID_PLACEMENT } from '../../../electron/services/scheduler/model/objective';
import { HighsSolver, greedyWarmStart } from '../../../electron/services/scheduler/solvers/highsSolver';
import { loadHighs } from '../../../electron/services/scheduler/solvers/loadHighs';
import { schedulerCorpus, scenarioById } from '../../fixtures/scheduler/corpus';
import { modelFromScenario } from '../../helpers/assignmentModelHarness';

function placementKey(placement: ArrayLike<number>): string {
  return Array.from(placement).join(',');
}

describe('HiGHS assignment spike', () => {
  let solver: HighsSolver;

  beforeAll(async () => {
    solver = new HighsSolver(await loadHighs());
  });

  it.each(
    schedulerCorpus
      .filter((scenario) =>
        [
          'monthly-pay',
          'horizon-60',
          'leave',
          'reserved-income',
          'locks-attached-preferred',
          'one-income-70',
        ].includes(scenario.id)
      )
      .map((scenario) => [scenario.id, scenario] as const)
  )(
    'solves %s optimally and deterministically',
    (_id, scenario) => {
      const model = modelFromScenario(scenario);
      const first = solver.solve(model);
      const second = solver.solve(model);
      expect(first.optimal).toBe(true);
      expect(placementKey(first.placement)).toBe(placementKey(second.placement));
      for (let billIndex = 0; billIndex < model.billCount; billIndex++) {
        const paycheckIndex = first.placement[billIndex];
        if (paycheckIndex === UNPAID_PLACEMENT) continue;
        expect(model.paycheckDay[paycheckIndex]).toBeLessThanOrEqual(model.dueDay[billIndex]);
      }
    },
    15_000
  );

  it('records that two-incomes-60 is a large MIP', () => {
    const model = modelFromScenario(scenarioById('two-incomes-60'));
    expect(model.variableCount).toBeGreaterThan(1000);
    expect(greedyWarmStart(model).length).toBe(model.billCount);
  });
});
