import { beforeEach, describe, expect, it, vi } from 'vitest';

const send = vi.fn();
const close = vi.fn();
const clearApprovedExportPaths = vi.fn();

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [
      { isDestroyed: () => false, webContents: { send } },
      { isDestroyed: () => true, webContents: { send } },
    ],
  },
}));

vi.mock('../../../electron/utils/exportPaths', () => ({
  clearApprovedExportPaths: (...args: unknown[]) => clearApprovedExportPaths(...args),
}));

import { applyLockSideEffects, notifyRendererLocked } from '../../../electron/ipc/appLock';

describe('appLock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('happy', () => {
    it('notifies live windows and clears export/db/budget state', () => {
      const services = {
        budgetManager: {} as never,
        database: { close } as never,
      };

      applyLockSideEffects(services);

      expect(clearApprovedExportPaths).toHaveBeenCalled();
      expect(close).toHaveBeenCalled();
      expect(services.budgetManager).toBeNull();
      expect(services.database).toBeNull();
      expect(send).toHaveBeenCalledWith('auth:locked');
      expect(send).toHaveBeenCalledTimes(1);
    });

    it('notifyRendererLocked skips destroyed windows', () => {
      notifyRendererLocked();
      expect(send).toHaveBeenCalledTimes(1);
    });
  });

  describe('sad', () => {
    it('handles already-null services without throwing', () => {
      expect(() =>
        applyLockSideEffects({ budgetManager: null, database: null })
      ).not.toThrow();
      expect(clearApprovedExportPaths).toHaveBeenCalled();
      expect(close).not.toHaveBeenCalled();
    });
  });
});
