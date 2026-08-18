import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tempRoot = path.join(os.tmpdir(), `budget-optimizer-diag-${process.pid}-${Date.now()}`);

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'userData') return tempRoot;
      if (name === 'home') return tempRoot;
      return tempRoot;
    }),
    getVersion: vi.fn(() => '1.2.3-test'),
  },
}));

vi.mock('../../../electron/services/logger.service', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const approved = new Set<string>();

vi.mock('../../../electron/utils/exportPaths', () => ({
  validateExportPath: (filePath: string) => approved.has(path.resolve(filePath)),
}));

import { diagnostics } from '../../../electron/services/diagnostics.service';
import {
  DIAGNOSTICS_MAX_DEPTH,
  DIAGNOSTICS_RATE_LIMIT_PER_MINUTE,
} from '../../../shared/diagnostics';

describe('diagnostics.service', () => {
  beforeEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    fs.mkdirSync(tempRoot, { recursive: true });
    approved.clear();
    diagnostics.resetForTests();
  });

  afterEach(async () => {
    await diagnostics.flushForTests();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  describe('hostile', () => {
    it('redacts secret and financial keys in diagnostics bag', async () => {
      const result = diagnostics.report({
        source: 'test:hostile',
        message: 'failed',
        diagnostics: {
          password: 'secret',
          amount: 1234.56,
          channel: 'bills:create',
          nested: { token: 'abc', op: 'create' },
        },
      });
      expect(result.success).toBe(true);
      if (!result.success) return;

      await diagnostics.flushForTests();
      const bundle = diagnostics.getEventBundle(result.id);
      expect(bundle.success).toBe(true);
      const event = bundle.data!.errors[0];
      expect(event.diagnostics.password).toBe('[REDACTED]');
      expect(event.diagnostics.amount).toBe('[REDACTED]');
      expect(event.diagnostics.channel).toBe('bills:create');
      expect((event.diagnostics.nested as Record<string, unknown>).token).toBe('[REDACTED]');
      expect((event.diagnostics.nested as Record<string, unknown>).op).toBe('create');
    });

    it('scrubs home paths and money-like free text at write', async () => {
      const result = diagnostics.report({
        source: 'test:path',
        message: 'boom at /Users/davismi/Repos/budget_optimizer/file.ts balance 1,234.56',
        stack: 'Error\n    at /Users/davismi/Repos/x.ts:1:1',
      });
      expect(result.success).toBe(true);
      if (!result.success) return;
      const event = diagnostics.getEventBundle(result.id).data!.errors[0];
      expect(event.message).toContain('[USER_PATH]');
      expect(event.message).toContain('[AMOUNT]');
      expect(event.message).not.toContain('/Users/davismi');
      expect(event.stack).toContain('[USER_PATH]');
      expect(event.stack).not.toContain('/Users/davismi');
    });

    it('does not treat Vite module URLs as secrets', () => {
      const result = diagnostics.report({
        source: 'renderer:ErrorBoundary',
        message:
          'Failed to fetch dynamically imported module: http://localhost:5173/src/components/charts/BalanceProjectionChart.tsx',
        diagnostics: {
          importPath: '/src/components/charts/BalanceProjectionChart.tsx',
        },
      });
      expect(result.success).toBe(true);
      if (!result.success) return;
      const event = diagnostics.getEventBundle(result.id).data!.errors[0];
      expect(event.message).toContain('BalanceProjectionChart.tsx');
      expect(event.message).not.toContain('[REDACTED]');
      expect(event.diagnostics.importPath).toBe(
        '/src/components/charts/BalanceProjectionChart.tsx'
      );
    });

    it('rejects oversized diagnostics bag depth', () => {
      let bag: Record<string, unknown> = { leaf: true };
      for (let i = 0; i < DIAGNOSTICS_MAX_DEPTH + 2; i++) {
        bag = { nested: bag };
      }
      const result = diagnostics.report({
        source: 'test:depth',
        message: 'deep',
        diagnostics: bag,
      });
      expect(result).toEqual({
        success: false,
        error: 'Diagnostics bag exceeds max depth',
      });
    });

    it('rate limits flood of distinct reports', () => {
      let rejected = 0;
      for (let i = 0; i < DIAGNOSTICS_RATE_LIMIT_PER_MINUTE + 5; i++) {
        const result = diagnostics.report({
          source: `test:flood:${i}`,
          message: `msg-${i}`,
        });
        if (!result.success) rejected += 1;
      }
      expect(rejected).toBeGreaterThanOrEqual(5);
    });

    it('rejects export outside approved paths', () => {
      diagnostics.report({ source: 'test:export', message: 'x' });
      const result = diagnostics.exportBundle('/etc/passwd');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid export path');
    });

    it('rejects empty-string source and invalid diagnostics bag shapes', () => {
      expect(diagnostics.report({ source: '   ', message: 'x' })).toEqual({
        success: false,
        error: 'Invalid diagnostics report',
      });
      expect(
        diagnostics.report({
          source: 'test:bag',
          message: 'x',
          diagnostics: null as never,
        })
      ).toEqual({ success: false, error: 'Invalid diagnostics bag' });
      expect(
        diagnostics.report({
          source: 'test:bag-array',
          message: 'x',
          diagnostics: [] as never,
        })
      ).toEqual({ success: false, error: 'Invalid diagnostics bag' });
    });

    it('truncates oversized diagnostics bag instead of dropping the event', () => {
      const result = diagnostics.report({
        source: 'test:bag-size',
        message: 'kept',
        diagnostics: { payload: 'word '.repeat(3000), route: '/goals' },
      });
      expect(result.success).toBe(true);
      if (!result.success) return;
      const event = diagnostics.getEventBundle(result.id).data!.errors[0];
      expect(event.message).toBe('kept');
      expect(event.diagnostics.truncated).toBe(true);
      expect(event.diagnostics.route).toBe('/goals');
    });
  });

  describe('sad', () => {
    it('skips corrupt JSONL lines on hydrate', async () => {
      const logsDir = path.join(tempRoot, 'logs');
      fs.mkdirSync(logsDir, { recursive: true, mode: 0o700 });
      const file = path.join(logsDir, 'errors.jsonl');
      const good = {
        id: '11111111-1111-1111-1111-111111111111',
        ts: '2026-01-01T00:00:00.000Z',
        level: 'error',
        source: 'test:good',
        message: 'ok',
        stack: null,
        componentStack: null,
        errorCode: null,
        diagnostics: {},
      };
      fs.writeFileSync(file, `not-json\n${JSON.stringify(good)}\n`, { mode: 0o600 });

      diagnostics.resetForTests();
      const bundle = diagnostics.getBundle(10);
      expect(bundle.success).toBe(true);
      expect(bundle.data!.errors).toHaveLength(1);
      expect(bundle.data!.errors[0].source).toBe('test:good');
    });

    it('returns failure for missing event id', () => {
      expect(diagnostics.getEventBundle('missing')).toEqual({
        success: false,
        error: 'Event not found',
      });
      expect(diagnostics.getEventBundle('')).toEqual({
        success: false,
        error: 'Event not found',
      });
    });

    it('rejects export when getBundle fails', () => {
      const out = path.join(tempRoot, 'fail.json');
      approved.add(path.resolve(out));
      const spy = vi.spyOn(diagnostics, 'getBundle').mockReturnValueOnce({
        success: false,
        error: 'hydrate failed',
      });
      expect(diagnostics.exportBundle(out)).toEqual({
        success: false,
        error: 'hydrate failed',
      });
      spy.mockRestore();
    });

    it('rejects export when there are no diagnostics', () => {
      const out = path.join(tempRoot, 'empty.json');
      approved.add(path.resolve(out));
      expect(diagnostics.exportBundle(out)).toEqual({
        success: false,
        error: 'No diagnostics to export',
      });
    });

    it('reports warn-level events and error-derived messages', async () => {
      const fromError = diagnostics.report({
        source: 'test:err',
        error: new Error('from-error'),
        level: 'warn',
        errorCode: 'e1',
        componentStack: 'Comp\n  at Foo',
      });
      expect(fromError.success).toBe(true);
      if (!fromError.success) return;
      const event = diagnostics.getEventBundle(fromError.id).data!.errors[0];
      expect(event.level).toBe('warn');
      expect(event.message).toBe('from-error');
      expect(event.errorCode).toBe('e1');
      expect(event.componentStack).toContain('Comp');
    });

    it('sanitizes arrays, primitives, and null free text without throwing', async () => {
      const reported = diagnostics.report({
        source: 'test:sanitize',
        message: 'ok',
        diagnostics: {
          list: [1, 'plain', null, { nested: true }],
          flag: false,
          empty: '',
        },
      });
      expect(reported.success).toBe(true);
      if (!reported.success) return;
      const bag = diagnostics.getEventBundle(reported.id).data!.errors[0].diagnostics;
      expect(Array.isArray(bag.list)).toBe(true);
      expect(bag.flag).toBe(false);
    });

    it('bumps coalesce count when the same report arrives again', async () => {
      const a = diagnostics.report({ source: 'coalesce-count', message: 'same', errorCode: 'c1' });
      const b = diagnostics.report({ source: 'coalesce-count', message: 'same', errorCode: 'c1' });
      const c = diagnostics.report({ source: 'coalesce-count', message: 'same', errorCode: 'c1' });
      expect(a.success && b.success && c.success).toBe(true);
      if (!a.success) return;
      expect(diagnostics.getEventBundle(a.id).data!.errors[0].diagnostics.count).toBe(3);
    });

    it('rejects invalid report shape without throwing', () => {
      expect(diagnostics.report({} as never)).toEqual({
        success: false,
        error: 'Invalid diagnostics report',
      });
    });
  });

  describe('happy', () => {
    it('writes event, builds one-event bundle, and exports after approval', async () => {
      const reported = diagnostics.report({
        source: 'ipc:bills:create',
        error: new Error('Validation failed'),
        errorCode: 'validation',
        diagnostics: { channel: 'bills:create' },
      });
      expect(reported.success).toBe(true);
      if (!reported.success) return;

      await diagnostics.flushForTests();

      const one = diagnostics.getEventBundle(reported.id);
      expect(one.success).toBe(true);
      expect(one.data!.errors).toHaveLength(1);
      expect(one.data!.errors[0].id).toBe(reported.id);
      expect(one.data!.copiedEventId).toBe(reported.id);
      expect(one.data!.recent).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: reported.id })])
      );
      expect(one.data!.app.version).toBe('1.2.3-test');
      expect(one.data!.session).toMatchObject({
        budgetUnlocked: false,
      });

      const out = path.join(tempRoot, 'diag.json');
      approved.add(path.resolve(out));
      const exported = diagnostics.exportBundle(out, 10);
      expect(exported.success).toBe(true);
      const parsed = JSON.parse(fs.readFileSync(out, 'utf8'));
      expect(parsed.errors.length).toBeGreaterThanOrEqual(1);
    });

    it('coalesces identical reports within window and returns same id', () => {
      const a = diagnostics.report({ source: 'same', message: 'dup' });
      const b = diagnostics.report({ source: 'same', message: 'dup' });
      expect(a.success && b.success).toBe(true);
      if (!a.success || !b.success) return;
      expect(a.id).toBe(b.id);
      const event = diagnostics.getEventBundle(a.id).data!.errors[0];
      expect(event.diagnostics.count).toBe(2);
    });

    it('hydrates ring after reset from JSONL', async () => {
      const first = diagnostics.report({ source: 'persist', message: 'survives' });
      expect(first.success).toBe(true);
      if (!first.success) return;
      await diagnostics.flushForTests();

      diagnostics.resetForTests();
      const bundle = diagnostics.getEventBundle(first.id);
      expect(bundle.success).toBe(true);
      expect(bundle.data!.errors[0].message).toBe('survives');
    });
  });
});
