/**
 * @vitest-environment node
 *
 * Opt-in: SCHEDULER_HIGHS_SPIKE=1 pnpm exec vitest run tests/perf/highs.spike.test.ts
 * Records compute-only p95 and a current-engine full-pipeline sample.
 */
import { describe, expect, it } from 'vitest';
import { HighsSolver } from '../../electron/services/scheduler/solvers/highsSolver';
import { loadHighs } from '../../electron/services/scheduler/solvers/loadHighs';
import { schedulerCorpus } from '../fixtures/scheduler/corpus';
import { modelFromScenario } from '../helpers/assignmentModelHarness';
import { runScenario } from '../helpers/scheduleFixtures';

const REPEAT_COUNT = 50;
const SLOW_REPEAT_COUNT = 3;
const SLOW_MS = 2000;

function percentile(values: number[], ratio: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(ratio * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

describe.skipIf(process.env.SCHEDULER_HIGHS_SPIKE !== '1')('HiGHS spike timings', () => {
  it('records compute-only p95 and current full-pipeline samples', async () => {
    const solver = new HighsSolver(await loadHighs());
    const rows: Array<{ id: string; p50: number; p95: number; identical: boolean }> = [];

    for (const scenario of schedulerCorpus) {
      const model = modelFromScenario(scenario);
      const times: number[] = [];
      let firstKey = '';
      let identical = true;
      let repeats = REPEAT_COUNT;
      for (let index = 0; index < repeats; index++) {
        const started = performance.now();
        const result = solver.solve(model);
        const elapsed = performance.now() - started;
        times.push(elapsed);
        if (index === 0 && elapsed > SLOW_MS) {
          repeats = SLOW_REPEAT_COUNT;
        }
        if (!result.optimal) {
          identical = false;
        }
        const key = `${result.optimal}:${Array.from(result.placement).join(',')}`;
        if (index === 0) firstKey = key;
        else if (key !== firstKey) identical = false;
      }
      rows.push({
        id: scenario.id,
        p50: percentile(times, 0.5),
        p95: percentile(times, 0.95),
        identical,
      });
    }

    const worst = rows.reduce((current, row) => (row.p95 > current.p95 ? row : current));
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ computeOnly: rows, worst }, null, 2));
    expect(rows.length).toBe(schedulerCorpus.length);

    const pipeline = schedulerCorpus.map((scenario) => {
      const started = performance.now();
      runScenario(scenario);
      return { id: scenario.id, ms: performance.now() - started };
    });
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ currentFullPipelineNode: pipeline }, null, 2));
  });
});
