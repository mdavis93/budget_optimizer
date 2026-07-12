import { Profiler, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DraftProvider, useDraftActions, useDraftData, useDraftStatus } from '../../src/context/DraftContext';
import { ToastProvider } from '../../src/components/Toast';
import CalendarView from '../../src/components/schedule/CalendarView';
import { createMockIncome, createMockPaycheck } from '../mocks/electron-api.mock';

const mockUseAuth = vi.fn();
const mockUseBudget = vi.fn();

vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('../../src/context/BudgetContext', () => ({
  useBudget: () => mockUseBudget(),
}));

function StatusRenderSpy({ onLayoutRender, onBannerRender }: {
  onLayoutRender: () => void;
  onBannerRender: () => void;
}) {
  const layoutStatus = useDraftStatus();
  onLayoutRender();

  const bannerStatus = useDraftStatus();
  onBannerRender();

  return (
    <div>
      <div data-testid="draft-mode">{String(layoutStatus.isDraftMode)}</div>
      <div data-testid="unsaved">{String(bannerStatus.hasUnsavedChanges)}</div>
    </div>
  );
}

function DraftControls() {
  const { incomes } = useDraftData();
  const { createIncome, reloadSnapshot } = useDraftActions();

  return (
    <>
      <div data-testid="income-name">{incomes[0]?.sourceName ?? ''}</div>
      <button onClick={() => void reloadSnapshot()}>reload</button>
      <button
        onClick={() => createIncome({
          sourceName: 'Freelance',
          amount: 1200,
          cadence: 'monthly',
          startDate: '2026-06-01',
          isActive: true,
        })}
      >
        create-income
      </button>
    </>
  );
}

describe('draft render isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({ isUnlocked: true });
    mockUseBudget.mockReturnValue({
      currentBudget: { id: 'budget-1' },
      isQuickBudget: true,
      hasBudgetSelected: true,
      refreshCurrentBudget: vi.fn().mockResolvedValue(undefined),
      loadBudgets: vi.fn().mockResolvedValue(undefined),
    });
    window.electronAPI = {
      budget: {
        getSnapshot: vi.fn().mockResolvedValue({
          success: true,
          data: {
            incomes: [createMockIncome({ sourceName: 'Salary' })],
            bills: [],
            debts: [],
            goals: [],
            skippedBills: [],
            billAssignments: [],
            incomeOverrides: [],
            budget: null,
          },
        }),
      },
    } as unknown as Window['electronAPI'];
  });

  it('keeps Layout and banner status subscribers isolated from entity churn', async () => {
    const layoutRenders = vi.fn();
    const bannerRenders = vi.fn();
    const { rerender } = render(
      <ToastProvider>
        <DraftProvider>
          <StatusRenderSpy onLayoutRender={layoutRenders} onBannerRender={bannerRenders} />
          <DraftControls />
        </DraftProvider>
      </ToastProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('income-name')).toHaveTextContent('Salary');
    });
    layoutRenders.mockClear();
    bannerRenders.mockClear();

    window.electronAPI.budget.getSnapshot.mockResolvedValueOnce({
      success: true,
      data: {
        incomes: [createMockIncome({ sourceName: 'Updated Salary' })],
        bills: [],
        debts: [],
        goals: [],
        skippedBills: [],
        billAssignments: [],
        incomeOverrides: [],
        budget: null,
      },
    });
    fireEvent.click(screen.getByText('reload'));

    await waitFor(() => {
      expect(screen.getByTestId('income-name')).toHaveTextContent('Updated Salary');
    });
    expect(layoutRenders).not.toHaveBeenCalled();
    expect(bannerRenders).not.toHaveBeenCalled();

    mockUseBudget.mockReturnValue({
      currentBudget: { id: 'budget-1' },
      isQuickBudget: false,
      hasBudgetSelected: true,
      refreshCurrentBudget: vi.fn().mockResolvedValue(undefined),
      loadBudgets: vi.fn().mockResolvedValue(undefined),
    });
    rerender(
      <ToastProvider>
        <DraftProvider>
          <StatusRenderSpy onLayoutRender={layoutRenders} onBannerRender={bannerRenders} />
          <DraftControls />
        </DraftProvider>
      </ToastProvider>
    );
    await waitFor(() => {
      expect(screen.getByTestId('draft-mode')).toHaveTextContent('true');
    });
    expect(layoutRenders).toHaveBeenCalled();
    expect(bannerRenders).toHaveBeenCalled();

    layoutRenders.mockClear();
    bannerRenders.mockClear();
    fireEvent.click(screen.getByText('create-income'));
    await waitFor(() => {
      expect(screen.getByTestId('unsaved')).toHaveTextContent('true');
    });
    expect(layoutRenders).toHaveBeenCalled();
    expect(bannerRenders).toHaveBeenCalled();
  });
});

describe('CalendarView memoization', () => {
  it('skips re-renders when unrelated parent state changes', () => {
    const paychecks = [createMockPaycheck({ date: '2026-01-15' })];
    const calendarRenderDurations: number[] = [];

    function Parent() {
      const [count, setCount] = useState(0);
      return (
        <>
          <button onClick={() => setCount((value) => value + 1)}>increment {count}</button>
          <Profiler
            id="calendar"
            onRender={(_id, _phase, actualDuration) => calendarRenderDurations.push(actualDuration)}
          >
            <CalendarView paychecks={paychecks} />
          </Profiler>
        </>
      );
    }

    render(<Parent />);
    calendarRenderDurations.length = 0;

    fireEvent.click(screen.getByRole('button', { name: /increment/i }));

    // The Profiler reports the parent commit, but a memo bailout has near-zero
    // child render time. A non-memoized CalendarView takes materially longer.
    expect(calendarRenderDurations).toHaveLength(1);
    expect(calendarRenderDurations[0]).toBeLessThan(0.1);
  });
});
