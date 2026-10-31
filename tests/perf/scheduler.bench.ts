import { bench, describe } from 'vitest';
import { schedulerCorpus } from '../fixtures/scheduler/corpus';
import { runScenario } from '../helpers/scheduleFixtures';

const TYPICAL_SAMPLES = {
  time: 0,
  iterations: 5,
  warmupTime: 0,
  warmupIterations: 1,
};

const STRESS_SAMPLES = {
  time: 0,
  iterations: 1,
  warmupTime: 0,
  warmupIterations: 0,
};

/**
 * Stress fixtures can run for many minutes on the current engine and a
 * synchronous run cannot be interrupted, so they are opt-in. Time one at a
 * time with an external cap: SCHEDULER_BENCH_STRESS=1 pnpm bench:scheduler -t <id>
 */
const includeStress = process.env.SCHEDULER_BENCH_STRESS === '1';

describe('scheduler corpus', () => {
  for (const scenario of schedulerCorpus) {
    bench.skipIf(scenario.isStress && !includeStress)(scenario.id, () => {
      runScenario(scenario);
    }, scenario.isStress ? STRESS_SAMPLES : TYPICAL_SAMPLES);
  }
});
