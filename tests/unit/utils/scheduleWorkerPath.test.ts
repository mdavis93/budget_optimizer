import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockIsPackaged = vi.fn(() => false);

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return mockIsPackaged();
    },
  },
}));

describe('scheduleWorkerPath', () => {
  let existsSyncSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockIsPackaged.mockReturnValue(false);
    process.resourcesPath = '/Resources';
    existsSyncSpy = vi.spyOn(fs, 'existsSync');
  });

  afterEach(() => {
    existsSyncSpy.mockRestore();
  });

  it('resolves the first existing dist-electron worker path in unpackaged builds', async () => {
    existsSyncSpy.mockImplementation((candidate) =>
      String(candidate).endsWith(path.join('dist-electron', 'schedule-worker.js'))
    );

    const { resolveScheduleWorkerPath } = await import(
      '../../../electron/utils/scheduleWorkerPath'
    );
    expect(resolveScheduleWorkerPath()).toBe(
      path.join(process.cwd(), 'dist-electron', 'schedule-worker.js')
    );
  });

  it('prefers the packaged asar worker path when the app is packaged', async () => {
    mockIsPackaged.mockReturnValue(true);
    const asarPath = path.join(
      '/Resources',
      'app.asar',
      'dist-electron',
      'schedule-worker.js'
    );
    existsSyncSpy.mockImplementation((candidate) => String(candidate) === asarPath);

    const { resolveScheduleWorkerPath } = await import(
      '../../../electron/utils/scheduleWorkerPath'
    );
    expect(resolveScheduleWorkerPath()).toBe(asarPath);
  });

  it('falls back beside the main bundle when no candidate exists', async () => {
    existsSyncSpy.mockReturnValue(false);

    const { resolveScheduleWorkerPath, scheduleWorkerExists } = await import(
      '../../../electron/utils/scheduleWorkerPath'
    );
    const resolved = resolveScheduleWorkerPath();
    expect(resolved.endsWith('schedule-worker.js')).toBe(true);
    expect(scheduleWorkerExists()).toBe(false);
  });
});
