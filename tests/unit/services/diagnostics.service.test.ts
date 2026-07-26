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
