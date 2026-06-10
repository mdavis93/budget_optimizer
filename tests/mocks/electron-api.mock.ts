import { vi } from 'vitest';

// Mock data factories
export const createMockBudget = (overrides = {}) => ({
  id: 'budget-1',
  name: 'Test Budget',
  startingBalance: 1000,
  targetCashOnHand: 500,
  minCashOnHand: 100,
  minSavingsPerPaycheck: 50,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

export const createMockIncome = (overrides = {}) => ({
  id: 'income-1',
  sourceName: 'Salary',
  amount: 2000,
  cadence: 'biweekly' as const,
  startDate: '2026-01-01',
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

export const createMockBill = (overrides = {}) => ({
  id: 'bill-1',
  creditorName: 'Electric Company',
  budgetedAmount: 150,
  dueDay: 15,
  category: 'utilities',
  isRecurring: true,
  priority: 'normal' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

export const createMockGoal = (overrides = {}) => ({
  id: 'goal-1',
  budgetId: 'budget-1',
  name: 'Vacation Fund',
  targetAmount: 5000,
  targetDate: '2026-12-31',
  alreadySaved: 0,
  priority: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

export const createMockPaycheck = (overrides = {}) => ({
  date: '2026-01-15',
  incomeSources: [{ id: 'income-1', name: 'Salary', amount: 2000 }],
  totalIncome: 2000,
  bills: [],
  totalBills: 0,
  goalDeposits: [],
  totalGoalDeposits: 0,
  budgetRemaining: 2000,
  savingsDeposit: 0,
  totalSavings: 0,
  isShortfall: false,
  ...overrides,
});

export const createMockSchedule = (overrides = {}) => ({
  startDate: '2026-01-01',
  endDate: '2026-12-31',
  paychecks: [createMockPaycheck()],
  entries: [],
  summary: {
    totalIncome: 2000,
    totalExpenses: 0,
    totalSavingsDeposits: 0,
    finalSavingsBalance: 0,
    netBalance: 2000,
    shortfallCount: 0,
    averageBalance: 2000,
    lowestBalance: 2000,
    highestBalance: 2000,
  },
  recommendations: [],
  maxBudgetRemaining: 500,
  goalProjections: [],
  ...overrides,
});

export const createMockGoalProjection = (overrides = {}) => ({
  goalId: 'goal-1',
  goalName: 'Vacation Fund',
  targetAmount: 5000,
  alreadySaved: 0,
  remainingAmount: 5000,
  targetDate: '2026-12-31',
  paycheckCount: 24,
  requiredPerPaycheck: 208.33,
  adjustedRequiredPerPaycheck: 208.33,
  availablePerPaycheck: 300,
  achievableAmount: 5000,
  achievabilityPercent: 100,
  status: 'achievable' as const,
  suggestions: [],
  ...overrides,
});

// Create the mock electron API
export const createMockElectronAPI = () => {
  const mockAPI = {
    platform: vi.fn().mockResolvedValue('darwin'),
    checkBiometricAvailable: vi.fn().mockResolvedValue(false),
    showSaveDialog: vi.fn().mockResolvedValue({ canceled: false, filePath: '/test/path' }),
    showOpenDialog: vi.fn().mockResolvedValue({ canceled: false, filePaths: ['/test/file'] }),
    quitApp: vi.fn().mockResolvedValue(undefined),

    budget: {
      getAll: vi.fn().mockResolvedValue({ success: true, data: [createMockBudget()] }),
      getAllWithStats: vi.fn().mockResolvedValue({
        success: true,
        data: [{ ...createMockBudget(), incomeCount: 1, billCount: 2 }],
      }),
      getCurrent: vi.fn().mockResolvedValue({
        success: true,
        data: { budget: createMockBudget(), isQuickBudget: false },
      }),
      getStats: vi.fn().mockResolvedValue({ success: true, data: { incomeCount: 1, billCount: 2 } }),
      create: vi.fn().mockResolvedValue({ success: true, data: createMockBudget() }),
      update: vi.fn().mockResolvedValue({ success: true, data: createMockBudget() }),
      delete: vi.fn().mockResolvedValue({ success: true }),
      switch: vi.fn().mockResolvedValue({ success: true, data: createMockBudget() }),
      startQuick: vi.fn().mockResolvedValue({ success: true }),
      endQuick: vi.fn().mockResolvedValue({ success: true }),
    },

    auth: {
      isFirstTimeSetup: vi.fn().mockResolvedValue(false),
      createMasterPassword: vi.fn().mockResolvedValue({ success: true, recoveryKey: 'test-key' }),
      unlock: vi.fn().mockResolvedValue({ success: true }),
      unlockWithBiometric: vi.fn().mockResolvedValue({ success: true }),
      lock: vi.fn().mockResolvedValue(undefined),
      isUnlocked: vi.fn().mockResolvedValue(true),
      enableBiometric: vi.fn().mockResolvedValue({ success: true }),
      isBiometricEnabled: vi.fn().mockResolvedValue(false),
      changePassword: vi.fn().mockResolvedValue({ success: true, newRecoveryKey: 'new-key' }),
      getPendingRecoveryKey: vi.fn().mockResolvedValue(null),
      clearPendingRecoveryKey: vi.fn().mockResolvedValue(undefined),
      verifyRecoveryKey: vi.fn().mockResolvedValue({ success: true }),
      resetPasswordWithRecovery: vi.fn().mockResolvedValue({ success: true, newRecoveryKey: 'new-key' }),
      setAutoLock: vi.fn().mockResolvedValue({ success: true }),
    },

    income: {
      getAll: vi.fn().mockResolvedValue({ success: true, data: [createMockIncome()] }),
      create: vi.fn().mockResolvedValue({ success: true, data: createMockIncome() }),
      update: vi.fn().mockResolvedValue({ success: true, data: createMockIncome() }),
      delete: vi.fn().mockResolvedValue({ success: true }),
    },

    bills: {
      getAll: vi.fn().mockResolvedValue({ success: true, data: [createMockBill()] }),
      create: vi.fn().mockResolvedValue({ success: true, data: createMockBill() }),
      update: vi.fn().mockResolvedValue({ success: true, data: createMockBill() }),
      delete: vi.fn().mockResolvedValue({ success: true }),
    },

    skippedBills: {
      getAll: vi.fn().mockResolvedValue({ success: true, data: [] }),
      skip: vi.fn().mockResolvedValue({ success: true, data: {} }),
      unskip: vi.fn().mockResolvedValue({ success: true }),
      isSkipped: vi.fn().mockResolvedValue({ success: true, data: false }),
    },

    billAssignments: {
      getAll: vi.fn().mockResolvedValue({ success: true, data: [] }),
      assign: vi.fn().mockResolvedValue({ success: true, data: {} }),
      remove: vi.fn().mockResolvedValue({ success: true }),
    },

    incomeOverrides: {
      getAll: vi.fn().mockResolvedValue({ success: true, data: [] }),
      set: vi.fn().mockResolvedValue({
        success: true,
        data: {
          id: 'ov-1',
          incomeId: 'income-1',
          paycheckDate: '2026-01-01',
          amount: 1000,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      }),
      remove: vi.fn().mockResolvedValue({ success: true, data: true }),
    },

    goals: {
      getAll: vi.fn().mockResolvedValue({ success: true, data: [createMockGoal()] }),
      create: vi.fn().mockResolvedValue({ success: true, data: createMockGoal() }),
      update: vi.fn().mockResolvedValue({ success: true, data: createMockGoal() }),
      delete: vi.fn().mockResolvedValue({ success: true }),
      getProjections: vi.fn().mockResolvedValue({ success: true, data: [createMockGoalProjection()] }),
    },

    schedule: {
      generate: vi.fn().mockResolvedValue({ success: true, data: createMockSchedule() }),
      optimize: vi.fn().mockResolvedValue({ success: true, data: createMockSchedule() }),
    },

    reconciliation: {
      applyFixes: vi.fn().mockResolvedValue({ success: true }),
    },

    export: {
      toPdf: vi.fn().mockResolvedValue({ success: true }),
      toHtml: vi.fn().mockResolvedValue({ success: true }),
      toSpreadsheet: vi.fn().mockResolvedValue({ success: true }),
    },

    settings: {
      get: vi.fn().mockResolvedValue({
        success: true,
        data: {
          theme: 'system',
          autoLockMinutes: 5,
          currency: 'USD',
          defaultScheduleMonths: 3,
          savingsAPY: 4.5,
        },
      }),
      update: vi.fn().mockResolvedValue({ success: true, data: {} }),
    },

    credentials: {
      save: vi.fn().mockResolvedValue({ success: true }),
      get: vi.fn().mockResolvedValue({ success: true, password: 'test-password' }),
      delete: vi.fn().mockResolvedValue({ success: true }),
      has: vi.fn().mockResolvedValue(false),
      offerSave: vi.fn().mockResolvedValue({ success: true, saved: false }),
    },
  };

  return mockAPI;
};

// Setup function to inject mock into window
export const setupElectronMock = () => {
  const mockAPI = createMockElectronAPI();
  (globalThis as unknown as { window: { electronAPI: typeof mockAPI } }).window = {
    electronAPI: mockAPI,
  };
  return mockAPI;
};

// Cleanup function
export const cleanupElectronMock = () => {
  delete (globalThis as unknown as { window?: unknown }).window;
};
