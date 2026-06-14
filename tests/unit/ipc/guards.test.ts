import { describe, it, expect, vi } from 'vitest';
import {
  requireUnlocked,
  requireBudgetReady,
  withUnlockGuard,
  withBudgetGuard,
  ipcData,
  ipcVoid,
} from '../../../electron/ipc/guards';

function createServices(overrides: {
  isUnlocked?: boolean;
  hasBudgetManager?: boolean;
  hasDatabase?: boolean;
} = {}) {
  const {
    isUnlocked = true,
    hasBudgetManager = true,
    hasDatabase = true,
  } = overrides;

  return {
    auth: {
      getIsUnlocked: vi.fn(() => isUnlocked),
    },
    budgetManager: hasBudgetManager ? {} : null,
    database: hasDatabase ? {} : null,
  };
}

describe('ipc guards', () => {
  describe('requireUnlocked', () => {
    it('returns null when app is unlocked', () => {
      expect(requireUnlocked(createServices())).toBeNull();
    });

    it('returns error when app is locked', () => {
      expect(requireUnlocked(createServices({ isUnlocked: false }))).toEqual({
        success: false,
        error: 'App is locked',
      });
    });
  });

  describe('requireBudgetReady', () => {
    it('returns null when unlocked and initialized', () => {
      expect(requireBudgetReady(createServices())).toBeNull();
    });

    it('returns lock error before initialization error', () => {
      expect(
        requireBudgetReady(createServices({ isUnlocked: false, hasBudgetManager: false }))
      ).toEqual({
        success: false,
        error: 'App is locked',
      });
    });

    it('returns not initialized when unlocked but services missing', () => {
      expect(
        requireBudgetReady(createServices({ hasBudgetManager: false, hasDatabase: false }))
      ).toEqual({
        success: false,
        error: 'Not initialized',
      });
    });
  });

  describe('withUnlockGuard', () => {
    it('runs handler when unlocked', async () => {
      const handler = withUnlockGuard(createServices(), () => 'ok');
      await expect(handler({} as never)).resolves.toBe('ok');
    });

    it('returns guard error when locked', async () => {
      const handler = withUnlockGuard(createServices({ isUnlocked: false }), () => 'ok');
      await expect(handler({} as never)).resolves.toEqual({
        success: false,
        error: 'App is locked',
      });
    });
  });

  describe('withBudgetGuard', () => {
    it('runs handler when budget is ready', async () => {
      const handler = withBudgetGuard(createServices(), () => ({ success: true, data: 1 }));
      await expect(handler({} as never)).resolves.toEqual({ success: true, data: 1 });
    });

    it('returns guard error when locked', async () => {
      const handler = withBudgetGuard(createServices({ isUnlocked: false }), () => 'ok');
      await expect(handler({} as never)).resolves.toEqual({
        success: false,
        error: 'App is locked',
      });
    });
  });

  describe('ipcData', () => {
    it('wraps successful results', async () => {
      await expect(ipcData('test-channel', () => 42)).resolves.toEqual({
        success: true,
        data: 42,
      });
    });

    it('wraps thrown errors', async () => {
      await expect(
        ipcData('test-channel', () => {
          throw new Error('boom');
        })
      ).resolves.toEqual({
        success: false,
        error: 'boom',
      });
    });
  });

  describe('ipcVoid', () => {
    it('returns success on completion', async () => {
      await expect(ipcVoid('test-channel', () => undefined)).resolves.toEqual({ success: true });
    });

    it('wraps thrown errors', async () => {
      await expect(
        ipcVoid('test-channel', () => {
          throw new Error('fail');
        })
      ).resolves.toEqual({
        success: false,
        error: 'fail',
      });
    });
  });
});
