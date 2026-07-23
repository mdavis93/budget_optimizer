import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Worker-facing files must not pull persistence / secrets modules.
 * Scheduler algorithm modules may still type-import entities; we bound the
 * quarantine to the offload façade (worker entry + compute/serialize helpers).
 */
const WORKER_FACADES = [
  'electron/workers/scheduleCompute.worker.ts',
  'electron/services/schedule-compute-run.ts',
  'electron/services/schedule-compute-serialize.ts',
];

const FORBIDDEN_PATTERNS = [
  /from\s+['"]better-sqlite3['"]/,
  /require\(\s*['"]better-sqlite3['"]\s*\)/,
  /from\s+['"]keytar['"]/,
  /require\(\s*['"]keytar['"]\s*\)/,
  /from\s+['"].*database\.service['"]/,
  /from\s+['"].*budget-manager\.service['"]/,
  /new\s+DatabaseService\b/,
  /new\s+BudgetManager\b/,
  /from\s+['"]node:fs['"]/,
  /from\s+['"]fs['"]/,
  /\bfetch\s*\(/,
];

describe('schedule worker import quarantine', () => {
  it('keeps worker façades free of DB/secrets/fs/network imports', () => {
    const root = path.resolve(__dirname, '../../..');
    const hits: string[] = [];

    for (const relative of WORKER_FACADES) {
      const file = path.join(root, relative);
      const source = fs.readFileSync(file, 'utf8');
      for (const pattern of FORBIDDEN_PATTERNS) {
        if (pattern.test(source)) {
          hits.push(`${relative} matches ${pattern}`);
        }
      }
    }

    expect(hits).toEqual([]);
  });
});
