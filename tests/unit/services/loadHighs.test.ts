/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it } from 'vitest';
import { loadHighs, resetHighsLoader } from '../../../electron/services/scheduler/solvers/loadHighs';

describe('loadHighs', () => {
  afterEach(() => {
    resetHighsLoader();
  });

  it('compiles HiGHS once and reuses the handle', async () => {
    const first = await loadHighs();
    const second = await loadHighs();
    expect(first).toBe(second);
    expect(typeof first.solve).toBe('function');
    const result = first.solve(
      `Minimize
 obj: v0
Subject To
 c0: v0 >= 0
Bounds
 0 <= v0 <= 1
Binary
 v0
End`,
      { output_flag: false, threads: 1, random_seed: 0 }
    );
    expect(result.Status).toBe('Optimal');
  });
});
