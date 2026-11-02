import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SchedulePage from '../../src/pages/SchedulePage';
import { DraftProvider } from '../../src/context/DraftContext';
import { ToastProvider } from '../../src/components/Toast';
import { SCHEDULE_DEBOUNCE_MS } from '../../src/utils/scheduleCache';
import {
  createMockBill,
  createMockBudget,
  createMockElectronAPI,
  createMockIncome,
  createMockPaycheck,
  createMockSchedule,
} from '../mocks/electron-api.mock';

const mockUseAuth = vi.fn();
const mockUseBudget = vi.fn();

vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('../../src/context/BudgetContext', () => ({
  useBudget: () => mockUseBudget(),
}));

const breakGlassPlan = {
  id: 'break-glass-2026-01-15',
  targetPaycheckDate: '2026-01-15',
  headline: 'Clear Break-Glass on Jan 15, 2026',
  maxDaysEarly: 5,
  clearsBreakGlass: true as const,
  steps: [
    {
      billId: 'bill-1',
      billName: 'Electric Company',
      billAmount: 150,
      billDueDate: '2026-01-15',
      fromPaycheckDate: '2026-01-01',
      toPaycheckDate: '2026-01-10',
      daysEarly: 5,
      requiresConfirmation: false,
    },
  ],
};

function createAcceptSchedule() {
  const paycheck = createMockPaycheck({ date: '2026-01-15' });
  return createMockSchedule({
    startDate: '2026-01-01',
    calculationMonths: 12,
    viewportMonths: 3,
    paychecks: [paycheck],
    fullPaychecks: [paycheck],
    breakGlassAdvisor: { plans: [breakGlassPlan] },
  });
}

function budgetState(isQuickBudget: boolean) {
  return {
    currentBudget: isQuickBudget ? null : createMockBudget(),
    isQuickBudget,
    hasBudgetSelected: true,
    refreshCurrentBudget: vi.fn().mockResolvedValue(undefined),
    loadBudgets: vi.fn().mockResolvedValue(undefined),
  };
}

async function renderSchedule(isQuickBudget: boolean) {
  mockUseBudget.mockReturnValue(budgetState(isQuickBudget));
  const mockAPI = createMockElectronAPI();
  mockAPI.budget.getSnapshot.mockResolvedValue({
    success: true,
    data: {
      incomes: [createMockIncome()],
      bills: [createMockBill()],
      goals: [],
      skippedBills: [],
      billAssignments: [],
      incomeOverrides: [],
      debts: [],
      leaves: [],
      budget: createMockBudget(),
    },
  });
  mockAPI.schedule.build.mockResolvedValue({
    success: true,
    data: createAcceptSchedule(),
  });
  window.electronAPI = mockAPI as unknown as Window['electronAPI'];

  render(
    <ToastProvider>
      <DraftProvider>
        <SchedulePage />
      </DraftProvider>
    </ToastProvider>
  );

  await waitFor(() => {
    expect(screen.getByRole('button', { name: /Accept adjustments/i })).toBeInTheDocument();
  });

  await waitFor(() => {
    expect(mockAPI.schedule.build).toHaveBeenCalled();
  });

  return mockAPI;
}

async function acceptAndCountBuilds(
  mockAPI: ReturnType<typeof createMockElectronAPI>
): Promise<number> {
  const buildsBeforeAccept = mockAPI.schedule.build.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: /Accept adjustments/i }));
  await waitFor(
    () => {
      expect(mockAPI.schedule.build.mock.calls.length).toBeGreaterThan(buildsBeforeAccept);
    },
    { timeout: SCHEDULE_DEBOUNCE_MS + 1000 }
  );
  await new Promise((resolve) => setTimeout(resolve, SCHEDULE_DEBOUNCE_MS + 150));
  return mockAPI.schedule.build.mock.calls.length - buildsBeforeAccept;
}

describe('SchedulePage Accept build count', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({ isUnlocked: true });
  });

  it('named budget: Accept triggers one schedule.build with preferredAssignments', async () => {
    const mockAPI = await renderSchedule(false);
    const buildsAfterAccept = await acceptAndCountBuilds(mockAPI);

    expect(buildsAfterAccept).toBe(1);
    const lastOverlay = mockAPI.schedule.build.mock.calls.at(-1)?.[3] as
      | { preferredAssignments?: Array<[string, string]> }
      | undefined;
    expect(lastOverlay?.preferredAssignments).toEqual([['bill-1-2026-01-15', '2026-01-10']]);
  });

  it('quick budget: Accept builds once with preferredAssignments', async () => {
    const mockAPI = await renderSchedule(true);
    const buildsAfterAccept = await acceptAndCountBuilds(mockAPI);

    expect(buildsAfterAccept).toBe(1);
    const lastOverlay = mockAPI.schedule.build.mock.calls.at(-1)?.[3] as
      | { preferredAssignments?: Array<[string, string]> }
      | undefined;
    expect(lastOverlay?.preferredAssignments).toEqual([['bill-1-2026-01-15', '2026-01-10']]);
  });
});
