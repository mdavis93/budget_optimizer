import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef, useState, type MutableRefObject } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useScheduleEngine } from '../../../src/context/draft/useScheduleEngine';
import { createEmptyDraftState } from '../../../src/types/draft';
import type { DraftOverlay, DraftState } from '../../../src/types';
import { createMockBudget, createMockElectronAPI, createMockSchedule } from '../../mocks/electron-api.mock';
import { SCHEDULE_DEBOUNCE_MS } from '../../../src/utils/scheduleCache';

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

  function renderEngine(overrides: Partial<Parameters<typeof EngineHarness>[0]> = {}) {
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
    return render(
      <EngineHarness
        draft={draft}
        currentBudget={overrides.currentBudget === undefined ? createMockBudget() : overrides.currentBudget}
        isUnlocked={overrides.isUnlocked}
        hasBudgetSelected={overrides.hasBudgetSelected}
        overlay={overrides.overlay}
        pendingRef={pendingRef}
      />
    );
  }

  it('uses draft starting balance when present', () => {
    renderEngine();
    expect(screen.getByTestId('balance')).toHaveTextContent('400');
  });

  it('falls back to current budget starting balance', () => {
    renderEngine({
      draft: createEmptyDraftState(),
      currentBudget: createMockBudget({ startingBalance: 880 }),
    });
    expect(screen.getByTestId('balance')).toHaveTextContent('880');
  });

  it('force generate stores schedule, then cache hit skips rebuild', async () => {
    renderEngine({ overlay: { startingBalance: 1000 } });
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
    renderEngine();
    fireEvent.click(screen.getByText('force-preferred'));
    await waitFor(() => {
      expect(screen.getByTestId('last-result')).toHaveTextContent('ok');
    });
    expect(screen.getByTestId('preferred-at-build')).toHaveTextContent('bill-1:2026-01-15,2026-01-10');
    expect(pendingRef.current).toEqual([]);
  });

  it('sets and clears schedule errors', async () => {
    mockAPI.schedule.build.mockResolvedValueOnce({ success: false, error: 'compute failed' });
    renderEngine();
    fireEvent.click(screen.getByText('force-generate'));
    await waitFor(() => {
      expect(screen.getByTestId('error')).toHaveTextContent('compute failed');
    });
    fireEvent.click(screen.getByText('clear-error'));
    expect(screen.getByTestId('error')).toHaveTextContent('');
  });

  it('reports thrown generate failures', async () => {
    mockAPI.schedule.build.mockRejectedValueOnce(new Error('ipc exploded'));
    renderEngine();
    fireEvent.click(screen.getByText('force-generate'));
    await waitFor(() => {
      expect(screen.getByTestId('error')).toHaveTextContent('ipc exploded');
    });
    expect(screen.getByTestId('last-result')).toHaveTextContent('null');
  });

  it('stringifies non-Error generate throws', async () => {
    mockAPI.schedule.build.mockRejectedValueOnce('not-an-error');
    renderEngine();
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
    renderEngine();
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
    renderEngine();
    fireEvent.click(screen.getByText('force-generate'));
    await waitFor(() => {
      expect(screen.getByTestId('paychecks')).toHaveTextContent('1');
    });
    fireEvent.click(screen.getByText('set-viewport'));
    expect(screen.getByTestId('months')).toHaveTextContent('2');
    expect(mockAPI.schedule.build).toHaveBeenCalledTimes(1);
  });

  it('uses generic error when the failed result omits a message', async () => {
    mockAPI.schedule.build.mockResolvedValueOnce({ success: false });
    renderEngine();
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

    renderEngine();
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
