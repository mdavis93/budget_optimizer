/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { HighsSolver } from '../../electron/services/scheduler/solvers/highsSolver';
import { loadHighs } from '../../electron/services/scheduler/solvers/loadHighs';
import { scenarioById } from '../fixtures/scheduler/corpus';
import { modelFromScenario } from '../helpers/assignmentModelHarness';

const SOAK_SOLVES = 500;
const HEAP_GROWTH_LIMIT_BYTES = 64 * 1024 * 1024;
const RSS_GROWTH_LIMIT_BYTES = 128 * 1024 * 1024;

function snapshotMemory(): { heapUsed: number; rss: number } {
  if (global.gc) {
    global.gc();
  }
  const usage = process.memoryUsage();
  return { heapUsed: usage.heapUsed, rss: usage.rss };
}

describe('HiGHS soak', () => {
  it('solves 500 times with bounded heap and RSS growth', async () => {
    const solver = new HighsSolver(await loadHighs());
    const model = modelFromScenario(scenarioById('one-income-70'));
    const warmup = solver.solve(model);
    expect(warmup.optimal).toBe(true);
    const start = snapshotMemory();

    for (let index = 0; index < SOAK_SOLVES; index++) {
      const result = solver.solve(model);
      expect(result.optimal).toBe(true);
      if ((index + 1) % 50 === 0) {
        snapshotMemory();
      }
    }

    const end = snapshotMemory();
    expect(end.heapUsed - start.heapUsed).toBeLessThan(HEAP_GROWTH_LIMIT_BYTES);
    expect(end.rss - start.rss).toBeLessThan(RSS_GROWTH_LIMIT_BYTES);
  });
});
