import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef, useState, type MutableRefObject } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useScheduleEngine } from '../../../src/context/draft/useScheduleEngine';
import { createEmptyDraftState } from '../../../src/types/draft';
import type { DraftOverlay, DraftState } from '../../../src/types';
import { createMockBudget, createMockElectronAPI, createMockSchedule } from '../../mocks/electron-api.mock';
import { SCHEDULE_DEBOUNCE_MS } from '../../../src/utils/scheduleCache';
import { reportError } from '../../../src/utils/reportError';

vi.mock('../../../src/utils/reportError', () => ({
  reportError: vi.fn().mockResolvedValue('diag-1'),
}));

function EngineHarness({
  draft,
  currentBudget,
  isUnlocked = true,
  hasBudgetSelected = true,
  overlay,
  pendingRef,
}: {
  draft: DraftState;
  currentBudget: ReturnType<typeof createMockBudget> | null;
  isUnlocked?: boolean;
  hasBudgetSelected?: boolean;
  overlay?: DraftOverlay;
  pendingRef: MutableRefObject<Array<[string, string]>>;
}) {
  const overlayAtBuild = useRef<Array<[string, string]>>([]);
  const [lastResult, setLastResult] = useState<string>('');
  const engine = useScheduleEngine({
    draft,
    currentBudget,
    isUnlocked,
    hasBudgetSelected,
    buildDraftOverlay: () => {
      overlayAtBuild.current = [...pendingRef.current];
      return overlay;
    },
    updateBudgetFields: () => true,
    pendingPreferredAssignmentsRef: pendingRef,
  });

  return (
    <div>
      <div data-testid="error">{engine.error ?? ''}</div>
      <div data-testid="balance">{engine.scheduleStartingBalance}</div>
      <div data-testid="months">{engine.scheduleMonths}</div>
      <div data-testid="persisted-months">{engine.persistedViewportMonths}</div>
      <div data-testid="paychecks">{engine.schedule?.paychecks.length ?? 0}</div>
      <div data-testid="loading">{String(engine.isLoading)}</div>
      <div data-testid="progress">{engine.progress?.stage ?? ''}</div>
      <div data-testid="preferred-at-build">{overlayAtBuild.current.join(',')}</div>
      <div data-testid="last-result">{lastResult}</div>
      <button
        onClick={() => {
          void engine
            .generateSchedule('2026-01-01', 3, 1000, { force: true })
            .then((data) => setLastResult(data ? 'ok' : 'null'));
        }}
      >
        force-generate
      </button>
      <button
        onClick={() => {
          void engine
            .generateSchedule('2026-01-01', 3, 1000, {
              force: true,
              preferredAssignments: [['bill-1:2026-01-15', '2026-01-10']],
            })
            .then((data) => setLastResult(data ? 'ok' : 'null'));
        }}
      >
        force-preferred
      </button>
      <button
        onClick={() => {
          void engine
            .generateSchedule('2026-01-01', 3, 1000)
            .then((data) => setLastResult(data ? 'ok' : 'null'));
        }}
      >
        debounce-generate
      </button>
      <button onClick={() => engine.clearError()}>clear-error</button>
      <button onClick={() => engine.setScheduleMonths(2)}>set-viewport</button>
      <button onClick={() => engine.setScheduleMonths(6)}>set-persisted-viewport</button>
      <button onClick={() => engine.setScheduleMonths(18)}>set-goal-viewport</button>
      <button onClick={() => engine.setScheduleStartDate('2026-02-01')}>set-start</button>
      <button onClick={() => engine.setScheduleStartingBalance(750)}>set-balance</button>
    </div>
  );
}

describe('useScheduleEngine', () => {
  let mockAPI: ReturnType<typeof createMockElectronAPI>;
  let pendingRef: MutableRefObject<Array<[string, string]>>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAPI = createMockElectronAPI();
    window.electronAPI = mockAPI as unknown as Window['electronAPI'];
    pendingRef = { current: [] };
  });

  async function renderEngine(overrides: Partial<Parameters<typeof EngineHarness>[0]> = {}) {
    const draft = overrides.draft ?? {
      ...createEmptyDraftState(),
      budget: {
        name: 'Main',
        startingBalance: 400,
        targetCashOnHand: 250,
        minCashOnHand: 100,
        minSavingsPerPaycheck: 0,
        scheduleStartDate: '2026-01-01',
      },
    };
    const view = render(
      <EngineHarness
        draft={draft}
        currentBudget={overrides.currentBudget === undefined ? createMockBudget() : overrides.currentBudget}
        isUnlocked={overrides.isUnlocked}
        hasBudgetSelected={overrides.hasBudgetSelected}
        overlay={overrides.overlay}
        pendingRef={pendingRef}
      />
    );
    await waitFor(() => {
      expect(mockAPI.settings.get).toHaveBeenCalled();
    });
    return view;
  }

  it('uses draft starting balance when present', async () => {
    await renderEngine();
    expect(screen.getByTestId('balance')).toHaveTextContent('400');
  });

  it('falls back to current budget starting balance', async () => {
    await renderEngine({
      draft: createEmptyDraftState(),
      currentBudget: createMockBudget({ startingBalance: 880 }),
    });
    expect(screen.getByTestId('balance')).toHaveTextContent('880');
  });

  it('force generate stores schedule, then cache hit skips rebuild', async () => {
    await renderEngine({ overlay: { startingBalance: 1000 } });
    fireEvent.click(screen.getByText('force-generate'));
    await waitFor(() => {
      expect(screen.getByTestId('paychecks')).toHaveTextContent('1');
    });
    expect(mockAPI.schedule.build).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('debounce-generate'));
    await new Promise((resolve) => {
      setTimeout(resolve, SCHEDULE_DEBOUNCE_MS + 50);
    });
    expect(screen.getByTestId('last-result')).toHaveTextContent('ok');
    expect(mockAPI.schedule.build).toHaveBeenCalledTimes(1);
  });

  it('seeds preferred assignments before building overlay', async () => {
    await renderEngine();
    fireEvent.click(screen.getByText('force-preferred'));
    await waitFor(() => {
      expect(screen.getByTestId('last-result')).toHaveTextContent('ok');
    });
    expect(screen.getByTestId('preferred-at-build')).toHaveTextContent('bill-1:2026-01-15,2026-01-10');
    expect(pendingRef.current).toEqual([]);
  });

  it('sets and clears schedule errors', async () => {
    mockAPI.schedule.build.mockResolvedValueOnce({ success: false, error: 'compute failed' });
    await renderEngine();
    fireEvent.click(screen.getByText('force-generate'));
    await waitFor(() => {
      expect(screen.getByTestId('error')).toHaveTextContent('compute failed');
    });
    fireEvent.click(screen.getByText('clear-error'));
    expect(screen.getByTestId('error')).toHaveTextContent('');
  });

  it('reports thrown generate failures', async () => {
    mockAPI.schedule.build.mockRejectedValueOnce(new Error('ipc exploded'));
    await renderEngine();
    fireEvent.click(screen.getByText('force-generate'));
    await waitFor(() => {
      expect(screen.getByTestId('error')).toHaveTextContent('ipc exploded');
    });
    expect(screen.getByTestId('last-result')).toHaveTextContent('null');
  });

  it('stringifies non-Error generate throws', async () => {
    mockAPI.schedule.build.mockRejectedValueOnce('not-an-error');
    await renderEngine();
    fireEvent.click(screen.getByText('force-generate'));
    await waitFor(() => {
      expect(screen.getByTestId('error')).toHaveTextContent('not-an-error');
    });
  });

  it('ignores superseded compute without setting an error', async () => {
    mockAPI.schedule.build.mockResolvedValueOnce({
      success: false,
      error: 'superseded',
      errorCode: 'superseded',
    });
    await renderEngine();
    fireEvent.click(screen.getByText('force-generate'));
    await waitFor(() => {
      expect(screen.getByTestId('last-result')).toHaveTextContent('null');
    });
    expect(screen.getByTestId('error')).toHaveTextContent('');
  });

  it('applies viewport from cached full schedule without rebuilding', async () => {
    mockAPI.schedule.build.mockResolvedValue({
      success: true,
      data: createMockSchedule({ viewportMonths: 12, calculationMonths: 12 }),
    });
    await renderEngine();
    fireEvent.click(screen.getByText('force-generate'));
    await waitFor(() => {
      expect(screen.getByTestId('paychecks')).toHaveTextContent('1');
    });
    fireEvent.click(screen.getByText('set-viewport'));
    expect(screen.getByTestId('months')).toHaveTextContent('2');
    expect(mockAPI.schedule.build).toHaveBeenCalledTimes(1);
  });

  it('loads the persisted viewport from settings', async () => {
    mockAPI.settings.get.mockResolvedValue({
      success: true,
      data: {
        theme: 'system',
        autoLockMinutes: 5,
        currency: 'USD',
        defaultScheduleMonths: 12,
        savingsAPY: 0,
      },
    });
    await renderEngine();
    await waitFor(() => {
      expect(screen.getByTestId('months')).toHaveTextContent('12');
      expect(screen.getByTestId('persisted-months')).toHaveTextContent('12');
    });
  });

  it('keeps the 3-month default when settings fail to load', async () => {
    mockAPI.settings.get.mockRejectedValueOnce(new Error('settings unavailable'));
    await renderEngine();
    await waitFor(() => {
      expect(reportError).toHaveBeenCalled();
    });
    expect(screen.getByTestId('months')).toHaveTextContent('3');
  });

  it('keeps the 3-month default when settings return an unsuccessful payload', async () => {
    mockAPI.settings.get.mockResolvedValueOnce({ success: false, error: 'locked' });
    await renderEngine();
    await waitFor(() => {
      expect(reportError).toHaveBeenCalled();
    });
    expect(screen.getByTestId('months')).toHaveTextContent('3');
  });

  it('persists 3/6/12 viewport changes and ignores goal-length views', async () => {
    await renderEngine();
    fireEvent.click(screen.getByText('set-persisted-viewport'));
    await waitFor(() => {
      expect(mockAPI.settings.update).toHaveBeenCalledWith({ defaultScheduleMonths: 6 });
    });
    expect(screen.getByTestId('months')).toHaveTextContent('6');

    mockAPI.settings.update.mockClear();
    fireEvent.click(screen.getByText('set-goal-viewport'));
    expect(screen.getByTestId('months')).toHaveTextContent('18');
    expect(mockAPI.settings.update).not.toHaveBeenCalled();
  });

  it('reports a failed viewport persist without changing the local view', async () => {
    mockAPI.settings.update.mockResolvedValueOnce({ success: false, error: 'write denied' });
    await renderEngine();
    fireEvent.click(screen.getByText('set-persisted-viewport'));
    await waitFor(() => {
      expect(reportError).toHaveBeenCalled();
    });
    expect(screen.getByTestId('months')).toHaveTextContent('6');
  });

  it('reports a thrown viewport persist failure', async () => {
    mockAPI.settings.update.mockRejectedValueOnce(new Error('disk full'));
    await renderEngine();
    fireEvent.click(screen.getByText('set-persisted-viewport'));
    await waitFor(() => {
      expect(reportError).toHaveBeenCalled();
    });
    expect(screen.getByTestId('months')).toHaveTextContent('6');
  });

  it('uses generic error when the failed result omits a message', async () => {
    mockAPI.schedule.build.mockResolvedValueOnce({ success: false });
    await renderEngine();
    fireEvent.click(screen.getByText('force-generate'));
    await waitFor(() => {
      expect(screen.getByTestId('error')).toHaveTextContent('Failed to generate schedule');
    });
  });

  it('records compute progress while generate is in flight', async () => {
    let sendProgress: ((progress: {
      stage: string;
      current: number;
      total: number;
      op: string;
    }) => void) | undefined;
    mockAPI.schedule.onProgress.mockImplementation((cb) => {
      sendProgress = cb;
      return () => undefined;
    });
    let finishBuild: ((value: { success: boolean; data: ReturnType<typeof createMockSchedule> }) => void) | undefined;
    mockAPI.schedule.build.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishBuild = resolve;
        })
    );

    await renderEngine();
    fireEvent.click(screen.getByText('force-generate'));
    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('true');
    });
    act(() => {
      sendProgress?.({ stage: 'assign', current: 1, total: 4, op: 'schedule' });
    });
    expect(screen.getByTestId('progress')).toHaveTextContent('assign');
    act(() => {
      finishBuild?.({ success: true, data: createMockSchedule() });
    });
    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });
  });
});
