import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  requireUnlocked,
  requireBudgetReady,
  withUnlockGuard,
  withBudgetGuard,
  ipcData,
  ipcVoid,
  setMainWindowGetter,
  assertAppSender,
} from '../../../electron/ipc/guards';
import { ValidationError } from '../../../electron/services/validation.service';

const report = vi.fn();

vi.mock('../../../electron/services/logger.service', () => ({
  ipcLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../../electron/services/diagnostics.service', () => ({
  diagnostics: {
    report: (...args: unknown[]) => report(...args),
  },
}));

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
  const sender = { id: 'app' };

  beforeEach(() => {
    report.mockReset();
    report.mockReturnValue({ success: true, id: 'diag-1' });
    setMainWindowGetter(() => ({
      webContents: sender,
      isDestroyed: () => false,
    }));
  });

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

  describe('assertAppSender', () => {
    it('returns Invalid sender when the window is missing or destroyed', () => {
      setMainWindowGetter(() => null);
      expect(assertAppSender({ sender } as never)).toEqual({
        success: false,
        error: 'Invalid sender',
      });

      setMainWindowGetter(() => ({
        webContents: sender,
        isDestroyed: () => true,
      }));
      expect(assertAppSender({ sender } as never)).toEqual({
        success: false,
        error: 'Invalid sender',
      });
    });

    it('rejects withUnlockGuard when sender is not the app window', async () => {
      const handler = withUnlockGuard(createServices(), () => 'ok');
      await expect(handler({ sender: { id: 'other' } } as never)).resolves.toEqual({
        success: false,
        error: 'Invalid sender',
      });
    });
  });

  describe('withUnlockGuard', () => {
    it('runs handler when unlocked', async () => {
      const handler = withUnlockGuard(createServices(), () => 'ok');
      await expect(handler({ sender } as never)).resolves.toBe('ok');
    });

    it('returns guard error when locked without reporting', async () => {
      const handler = withUnlockGuard(createServices({ isUnlocked: false }), () => 'ok');
      await expect(handler({ sender } as never)).resolves.toEqual({
        success: false,
        error: 'App is locked',
      });
      expect(report).not.toHaveBeenCalled();
    });
  });

  describe('withBudgetGuard', () => {
    it('runs handler when budget is ready', async () => {
      const handler = withBudgetGuard(createServices(), () => ({ success: true, data: 1 }));
      await expect(handler({ sender } as never)).resolves.toEqual({ success: true, data: 1 });
    });

    it('returns guard error when locked without reporting', async () => {
      const handler = withBudgetGuard(createServices({ isUnlocked: false }), () => 'ok');
      await expect(handler({ sender } as never)).resolves.toEqual({
        success: false,
        error: 'App is locked',
      });
      expect(report).not.toHaveBeenCalled();
    });
  });

  describe('ipcData', () => {
    describe('happy', () => {
      it('wraps successful results', async () => {
        await expect(ipcData('test-channel', () => 42)).resolves.toEqual({
          success: true,
          data: 42,
        });
        expect(report).not.toHaveBeenCalled();
      });
    });

    describe('sad', () => {
      it('wraps thrown errors with diagnosticId and stack report', async () => {
        await expect(
          ipcData('test-channel', () => {
            throw new Error('boom');
          })
        ).resolves.toEqual({
          success: false,
          error: 'boom',
          diagnosticId: 'diag-1',
        });
        expect(report).toHaveBeenCalledWith(
          expect.objectContaining({
            source: 'ipc:test-channel',
            message: 'boom',
            stack: expect.stringContaining('boom'),
            diagnostics: { channel: 'test-channel' },
          })
        );
      });

      it('reports ValidationError with safe message while ApiResult keeps original', async () => {
        await expect(
          ipcData('bills:create', () => {
            throw new ValidationError('amount must be >= 0 (got 99.5)', 'amount');
          })
        ).resolves.toEqual({
          success: false,
          error: 'amount must be >= 0 (got 99.5)',
          diagnosticId: 'diag-1',
        });
        expect(report).toHaveBeenCalledWith(
          expect.objectContaining({
            message: 'Invalid amount',
            errorCode: 'validation',
            diagnostics: { channel: 'bills:create', field: 'amount' },
          })
        );
      });

      it('wraps non-Error throws', async () => {
        await expect(
          ipcData('test-channel', () => {
            throw 'plain string';
          })
        ).resolves.toEqual({
          success: false,
          error: 'plain string',
          diagnosticId: 'diag-1',
        });
      });
    });

    describe('hostile', () => {
      it('omits diagnosticId when report fails', async () => {
        report.mockReturnValue({ success: false, error: 'rate limit' });
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
  });

  describe('ipcVoid', () => {
    it('returns success on completion', async () => {
      await expect(ipcVoid('test-channel', () => undefined)).resolves.toEqual({ success: true });
    });

    it('wraps thrown errors with diagnosticId', async () => {
      await expect(
        ipcVoid('test-channel', () => {
          throw new Error('fail');
        })
      ).resolves.toEqual({
        success: false,
        error: 'fail',
        diagnosticId: 'diag-1',
      });
    });
  });
});
