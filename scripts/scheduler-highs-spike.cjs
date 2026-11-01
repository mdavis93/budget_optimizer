/**
 * Phase 2a spike measurements. Not a CI gate.
 * Usage: node scripts/use-native.cjs node && node --import tsx / no —
 * This script shells vitest for compute-only repeats via a small inline runner.
 */
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');
const result = spawnSync(
  process.execPath,
  [path.join(root, 'scripts/use-native.cjs'), 'node', '&&', 'vitest', 'run', 'tests/perf/highs.spike.test.ts'],
  {
    cwd: root,
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      SCHEDULER_HIGHS_SPIKE: '1',
    },
  }
);

process.exit(result.status ?? 1);
