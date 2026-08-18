import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerIpcHandlers } from '../../../electron/ipc/handlers';
import { approveExportPath } from '../../../electron/utils/exportPaths';
import { DatabaseService } from '../../../electron/services/database.service';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => (name === 'home' ? '/Users/tester' : '/tmp')),
  },
  BrowserWindow: {
    fromWebContents: vi.fn(() => null),
    getAllWindows: vi.fn(() => []),
  },
}));

vi.mock('../../../electron/services/logger.service', () => ({
  ipcLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  databaseLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../../electron/services/diagnostics.service', () => ({
  diagnostics: {
    report: vi.fn(() => ({ success: true, id: 'diag-test' })),
    getEventBundle: vi.fn(() => ({
      success: true,
      id: 'diag-test',
      data: {
        exportedAt: '2026-01-01T00:00:00.000Z',
        app: { version: '1.0.0', electron: '0', platform: 'darwin', arch: 'arm64' },
        session: { uptimeMs: 1, budgetUnlocked: false },
        errors: [
          {
            id: 'diag-test',
            ts: '2026-01-01T00:00:00.000Z',
            level: 'error',
            source: 'test',
            message: 'boom',
            stack: null,
            componentStack: null,
            errorCode: null,
            diagnostics: {},
          },
        ],
      },
    })),
    getBundle: vi.fn(() => ({
      success: true,
      id: 'diag-test',
      data: {
        exportedAt: '2026-01-01T00:00:00.000Z',
        app: { version: '1.0.0', electron: '0', platform: 'darwin', arch: 'arm64' },
        session: { uptimeMs: 1, budgetUnlocked: true },
        errors: [
          {
            id: 'diag-test',
            ts: '2026-01-01T00:00:00.000Z',
            level: 'error',
            source: 'test',
            message: 'boom',
            stack: null,
            componentStack: null,
            errorCode: null,
            diagnostics: {},
          },
        ],
      },
    })),
    exportBundle: vi.fn(() => ({ success: true, id: 'diag-test' })),
    setSessionHooks: vi.fn(),
  },
}));

import { diagnostics } from '../../../electron/services/diagnostics.service';

type HandlerFn = (event: unknown, ...args: unknown[]) => Promise<unknown> | unknown;

class MockIpcMain {
  private handlers = new Map<string, HandlerFn>();
  readonly sender = {
    send: vi.fn(),
    isDestroyed: vi.fn(() => false),
  };

  handle(channel: string, fn: HandlerFn): void {
    this.handlers.set(channel, fn);
  }

  invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    const fn = this.handlers.get(channel);
    if (!fn) {
      throw new Error(`No handler registered for ${channel}`);
    }
    return Promise.resolve(fn({ sender: this.sender }, ...args));
  }
}

function registerHandlers(ipcMain: MockIpcMain, services: ReturnType<typeof createServices>): void {
  registerIpcHandlers(ipcMain as never, services as never, {
    getMainWindow: () => ({
      webContents: ipcMain.sender,
      isDestroyed: () => false,
    }),
  });
}

function createServices(overrides: Partial<Record<string, unknown>> = {}) {
  let onLockListener: (() => void) | null = null;
  const baseAuth = {
      getIsUnlocked: vi.fn(() => true),
      isFirstTimeSetup: vi.fn(() => false),
      createMasterPassword: vi.fn(async () => ({ success: true })),
      unlock: vi.fn(async () => ({ success: true })),
      unlockWithBiometric: vi.fn(async () => ({ success: true })),
      lock: vi.fn(() => {
        onLockListener?.();
      }),
      setOnLock: vi.fn((listener: (() => void) | null) => {
        onLockListener = listener;
      }),
      enableBiometric: vi.fn(async () => ({ success: true })),
      isBiometricEnabled: vi.fn(() => false),
      changePassword: vi.fn(async () => ({ success: true })),
      getPendingRecoveryKey: vi.fn(() => null),
      clearPendingRecoveryKey: vi.fn(),
      verifyRecoveryKey: vi.fn(async () => ({ success: true })),
      resetPasswordWithRecoveryKey: vi.fn(async () => ({ success: true })),
      setAutoLock: vi.fn(),
      recordActivity: vi.fn(),
      getCryptoService: vi.fn(() => ({})),
      revertFirstTimeSetup: vi.fn(),
  };

  return {
    auth: {
      ...baseAuth,
      ...(overrides.auth as object | undefined),
    },
    crypto: {},
    database: {
      getDebts: vi.fn(() => []),
      getLeaves: vi.fn(() => []),
      getSettings: vi.fn(() => ({ autoLockMinutes: 5 })),
      close: vi.fn(),
    },
    budgetManager: {
      getCurrentState: vi.fn(() => ({ budgetId: 'budget-1', isQuickBudget: false })),
      getAllIncomes: vi.fn(() => []),
      getAllBills: vi.fn(() => []),
      getAllGoals: vi.fn(() => []),
      getSkippedBills: vi.fn(() => []),
      getBillAssignments: vi.fn(() => []),
      getIncomeOverrides: vi.fn(() => []),
      getStartingBalance: vi.fn(() => 1234),
      getTargetCashOnHand: vi.fn(() => 250),
      getMinCashOnHand: vi.fn(() => 100),
      getMinSavingsPerPaycheck: vi.fn(() => 50),
      getScheduleStartDate: vi.fn(() => '2026-01-01'),
      getAllBudgets: vi.fn(() => []),
      getAllBudgetsWithStats: vi.fn(() => []),
      getBudgetById: vi.fn(() => null),
      getBudgetStats: vi.fn(() => ({ incomeCount: 0, billCount: 0 })),
      createBudget: vi.fn(),
      updateBudget: vi.fn(),
      deleteBudget: vi.fn(() => true),
      setCurrentBudget: vi.fn(() => null),
      startQuickBudget: vi.fn(),
      endQuickBudget: vi.fn(),
      createIncome: vi.fn(),
      updateIncome: vi.fn(() => null),
      deleteIncome: vi.fn(() => false),
      createBill: vi.fn(),
      updateBill: vi.fn(() => null),
      deleteBill: vi.fn(() => false),
      skipBill: vi.fn(),
      unskipBill: vi.fn(() => false),
      isSkipped: vi.fn(() => false),
      assignBillToPaycheck: vi.fn(),
      removeBillAssignment: vi.fn(() => false),
      setIncomeOverride: vi.fn(),
      removeIncomeOverride: vi.fn(() => false),
      createGoal: vi.fn(),
      updateGoal: vi.fn(() => null),
      deleteGoal: vi.fn(() => false),
      getDebts: vi.fn(() => []),
      getDebtById: vi.fn(() => null),
      getDebtByBillId: vi.fn(() => null),
      createDebt: vi.fn(),
      updateDebt: vi.fn(() => null),
      deleteDebt: vi.fn(() => false),
      getLeaves: vi.fn(() => []),
      createLeave: vi.fn(),
      updateLeave: vi.fn(() => null),
      deleteLeave: vi.fn(() => false),
      getBudgetSnapshot: vi.fn(() => ({
        incomes: [{ id: 'income-1' }],
        bills: [{ id: 'bill-1' }],
        goals: [{ id: 'goal-1' }],
        skippedBills: [],
        billAssignments: [],
        incomeOverrides: [],
        debts: [],
        leaves: [],
        budget: { id: 'budget-1', name: 'Test' },
      })),
    },
    scheduler: {
      generateSchedule: vi.fn(() => ({
        startDate: '2026-01-01',
        endDate: '2026-01-31',
        paychecks: [],
        fullPaychecks: [],
        viewportMonths: 1,
        entries: [],
        summary: {
          totalIncome: 0,
          totalExpenses: 0,
          netBalance: 0,
          finalSavingsBalance: 0,
          shortfallCount: 0,
        },
        recommendations: [],
        maxBudgetRemaining: 0,
        minCashOnHand: 100,
      })),
      generateGoalProjections: vi.fn(() => []),
      analyzeAndProposeFixes: vi.fn(() => ({
        needsReconciliation: false,
        shortfalls: [],
        proposedFixes: [],
        canBeFullyResolved: true,
        totalDeficit: 0,
        estimatedResolution: 0,
      })),
      proposeBreakGlassPlans: vi.fn(() => ({ plans: [] })),
      applyViewportFilter: vi.fn((data) => data),
    },
    scheduleCompute: {
      isDisposed: false,
      runJob: vi.fn(async (request: { op: string; inputHash: string; input: { startingBalance: number; startDate: string; months: number } }) => {
        if (request.op === 'goals') {
          return {
            type: 'result',
            protocolVersion: 1,
            jobId: 'test-job',
            inputHash: request.inputHash,
            op: 'goals',
            goalProjections: [],
          };
        }
        return {
          type: 'result',
          protocolVersion: 1,
          jobId: 'test-job',
          inputHash: request.inputHash,
          op: 'schedule',
          schedule: {
            startDate: request.input.startDate,
            endDate: '2026-01-31',
            paychecks: [],
            fullPaychecks: [],
            viewportMonths: request.input.months,
            entries: [],
            summary: {
              totalIncome: 0,
              totalExpenses: 0,
              netBalance: 0,
              finalSavingsBalance: 0,
              shortfallCount: 0,
            },
            recommendations: [],
            maxBudgetRemaining: 0,
            minCashOnHand: 100,
          },
        };
      }),
      dispose: vi.fn(),
      notifyChildProcessGone: vi.fn(),
    },
    pdf: {
      generatePdf: vi.fn(async () => ({ success: true })),
      generateHtmlFile: vi.fn(async () => ({ success: true })),
    },
    spreadsheet: {
      generateXlsx: vi.fn(async () => ({ success: true })),
    },
    debt: {
      calculateAmortization: vi.fn(() => ({ monthsToPayoff: 0, payments: [], payoffDate: '2026-01-01' })),
    },
    credentials: {
      savePassword: vi.fn(async () => ({ success: true })),
      getPassword: vi.fn(async () => ({ success: true, password: null })),
      deletePassword: vi.fn(async () => ({ success: true })),
      hasPassword: vi.fn(async () => false),
      offerSave: vi.fn(async () => ({ success: true, saved: false })),
    },
    ...overrides,
  };
}

describe('ipc handlers', () => {
  let ipcMain: MockIpcMain;

  beforeEach(() => {
    ipcMain = new MockIpcMain();
  });

  describe('happy', () => {
    it('returns auth unlock errors without attempting database initialization', async () => {
      const services = createServices({
        auth: {
          ...createServices().auth,
          unlock: vi.fn(async () => ({ success: false, error: 'bad password' })),
          unlockWithBiometric: vi.fn(async () => ({ success: false, error: 'no biometric' })),
        },
      });
      registerHandlers(ipcMain, services);

      await expect(ipcMain.invoke('auth:unlock', 'bad')).resolves.toEqual({
        success: false,
        error: 'bad password',
      });
      await expect(ipcMain.invoke('auth:unlock-with-biometric')).resolves.toEqual({
        success: false,
        error: 'no biometric',
      });
    });

    it('unlocks from saved credentials without returning a password', async () => {
      const services = createServices({
        credentials: {
          ...createServices().credentials,
          getPassword: vi.fn(async () => ({ success: true, password: 'saved-secret' })),
        },
      });
      const initSpy = vi.spyOn(DatabaseService.prototype, 'initialize').mockImplementation(() => undefined);
      const settingsSpy = vi.spyOn(DatabaseService.prototype, 'getSettings').mockReturnValue({
        autoLockMinutes: 5,
      } as never);
      registerHandlers(ipcMain, services);

      const result = await ipcMain.invoke('auth:unlock-with-saved-credentials');
      expect(result).toEqual({ success: true });
      expect(result).not.toHaveProperty('password');
      expect(services.auth.unlock).toHaveBeenCalledWith('saved-secret');
      initSpy.mockRestore();
      settingsSpy.mockRestore();
    });

    it('rejects unlock-with-saved-credentials when no password is stored', async () => {
      const services = createServices({
        credentials: {
          ...createServices().credentials,
          getPassword: vi.fn(async () => ({ success: false, error: 'No saved password found' })),
        },
      });
      registerHandlers(ipcMain, services);

      await expect(ipcMain.invoke('auth:unlock-with-saved-credentials')).resolves.toEqual({
        success: false,
        error: 'No saved password found',
      });
      expect(services.auth.unlock).not.toHaveBeenCalled();
    });

    it('rejects mutating handlers when the sender is not the app window', async () => {
      const services = createServices();
      registerIpcHandlers(ipcMain as never, services as never, {
        getMainWindow: () => ({
          webContents: { id: 'other-window' },
          isDestroyed: () => false,
        }),
      });

      await expect(ipcMain.invoke('auth:unlock', 'pw')).resolves.toEqual({
        success: false,
        error: 'Invalid sender',
      });
      await expect(ipcMain.invoke('budget:get-all')).resolves.toEqual({
        success: false,
        error: 'Invalid sender',
      });
      expect(services.auth.unlock).not.toHaveBeenCalled();
    });

    it('reverts first-time setup when database initialization fails', async () => {
      const services = createServices({
        auth: {
          ...createServices().auth,
          createMasterPassword: vi.fn(async () => ({ success: true })),
        },
      });
      const initSpy = vi.spyOn(DatabaseService.prototype, 'initialize').mockImplementation(() => {
        throw new Error('disk full');
      });
      registerHandlers(ipcMain, services);

      await expect(ipcMain.invoke('auth:create-master-password', 'pw')).resolves.toEqual({
        success: false,
        error: 'Failed to initialize database: disk full',
      });
      expect(services.auth.revertFirstTimeSetup).toHaveBeenCalled();
      initSpy.mockRestore();
    });

    it('returns database init error when unlock succeeds but services fail to initialize', async () => {
      const services = createServices();
      const initSpy = vi.spyOn(DatabaseService.prototype, 'initialize').mockImplementation(() => {
        throw new Error('locked db');
      });
      registerHandlers(ipcMain, services);

      await expect(ipcMain.invoke('auth:unlock', 'pw')).resolves.toEqual({
        success: false,
        error: expect.stringContaining('locked db'),
      });
      initSpy.mockRestore();
    });

    it('uses extra payment amortization when linked bill budgets above minimum', async () => {
      const services = createServices({
        budgetManager: {
          ...createServices().budgetManager,
          getAllBills: vi.fn(() => [{ id: 'bill-1', budgetedAmount: 150 }]),
          getDebtById: vi.fn(() => ({
            id: 'debt-1',
            billId: 'bill-1',
            principalBalance: 1000,
            apr: 12,
            monthlyPayment: 100,
          })),
        },
        debt: {
          calculateAmortization: vi.fn(() => ({
            monthsToPayoff: 10,
            payments: [{ payment: 120 }],
            payoffDate: '2026-10-01',
          })),
        },
      });
      registerHandlers(ipcMain, services);

      await ipcMain.invoke('debts:get-amortization', 'debt-1');
      expect(services.debt.calculateAmortization).toHaveBeenCalledWith(1000, 12, 100, 50, 'monthly');
    });

    it('invokes schedule:build via scheduleCompute host and returns schedule payload', async () => {
      const services = createServices();
      registerHandlers(ipcMain, services);

      const result = await ipcMain.invoke('schedule:build', '2026-01-01', 2, 500);

      expect(result).toMatchObject({ success: true });
      expect(services.scheduleCompute.runJob).toHaveBeenCalledWith(
        expect.objectContaining({
          op: 'schedule',
          input: expect.objectContaining({
            startDate: '2026-01-01',
            months: 2,
            startingBalance: 1234,
          }),
        }),
        expect.objectContaining({ onProgress: expect.any(Function) })
      );
      expect(services.scheduler.generateSchedule).not.toHaveBeenCalled();
    });

    it('forwards schedule compute progress to the invoking renderer', async () => {
      const services = createServices({
        scheduleCompute: {
          ...createServices().scheduleCompute,
          runJob: vi.fn(async (_request, options?: { onProgress?: (progress: unknown) => void }) => {
            options?.onProgress?.({
              type: 'progress',
              protocolVersion: 1,
              jobId: 'job-1',
              inputHash: 'hash-1',
              op: 'schedule',
              stage: 'assigning',
            });
            return {
              type: 'result',
              protocolVersion: 1,
              jobId: 'test-job',
              inputHash: 'hash-1',
              op: 'schedule',
              schedule: {
                startDate: '2026-01-01',
                endDate: '2026-01-31',
                paychecks: [],
                fullPaychecks: [],
                viewportMonths: 1,
                entries: [],
                summary: {
                  totalIncome: 0,
                  totalExpenses: 0,
                  netBalance: 0,
                  finalSavingsBalance: 0,
                  shortfallCount: 0,
                },
                recommendations: [],
                maxBudgetRemaining: 0,
                minCashOnHand: 100,
              },
            };
          }),
        },
      });
      registerHandlers(ipcMain, services);

      await ipcMain.invoke('schedule:build', '2026-01-01', 1, 1000);
      expect(ipcMain.sender.send).toHaveBeenCalledWith(
        'schedule:progress',
        expect.objectContaining({ type: 'progress', stage: 'assigning' })
      );
    });

    it('does not send schedule progress after lock or renderer teardown', async () => {
      const progressPayload = {
        type: 'progress',
        protocolVersion: 1,
        jobId: 'job-1',
        inputHash: 'hash-1',
        op: 'schedule',
        stage: 'assigning',
      };
      const resultPayload = {
        type: 'result',
        protocolVersion: 1,
        jobId: 'test-job',
        inputHash: 'hash-1',
        op: 'schedule',
        schedule: {
          startDate: '2026-01-01',
          endDate: '2026-01-31',
          paychecks: [],
          fullPaychecks: [],
          viewportMonths: 1,
          entries: [],
          summary: {
            totalIncome: 0,
            totalExpenses: 0,
            netBalance: 0,
            finalSavingsBalance: 0,
            shortfallCount: 0,
          },
          recommendations: [],
          maxBudgetRemaining: 0,
          minCashOnHand: 100,
        },
      };
      const services = createServices({
        scheduleCompute: {
          ...createServices().scheduleCompute,
          runJob: vi.fn(async (_request, options?: { onProgress?: (progress: unknown) => void }) => {
            options?.onProgress?.(progressPayload);
            return resultPayload;
          }),
        },
      });
      registerHandlers(ipcMain, services);

      ipcMain.sender.isDestroyed.mockReturnValue(true);
      await ipcMain.invoke('schedule:build', '2026-01-01', 1, 1000);
      expect(ipcMain.sender.send).not.toHaveBeenCalled();

      ipcMain.sender.isDestroyed.mockReturnValue(false);
      vi.mocked(services.auth.getIsUnlocked).mockReturnValueOnce(true).mockReturnValue(false);
      await ipcMain.invoke('schedule:build', '2026-01-01', 1, 1000);
      expect(ipcMain.sender.send).not.toHaveBeenCalled();

      vi.mocked(services.auth.getIsUnlocked).mockReturnValue(true);
      const send = ipcMain.sender.send;
      (ipcMain.sender as { send: unknown }).send = undefined;
      await ipcMain.invoke('schedule:build', '2026-01-01', 1, 1000);
      ipcMain.sender.send = send;
      expect(send).not.toHaveBeenCalled();
    });

    it('routes income CRUD handlers through budget manager', async () => {
      const services = createServices({
        budgetManager: {
          ...createServices().budgetManager,
          createIncome: vi.fn(() => ({ id: 'inc-1' })),
          updateIncome: vi.fn(() => ({ id: 'inc-1', sourceName: 'Updated' })),
          deleteIncome: vi.fn(() => true),
        },
      });
      registerHandlers(ipcMain, services);

      const created = await ipcMain.invoke('income:create', { sourceName: 'Salary' });
      const updated = await ipcMain.invoke('income:update', 'inc-1', { sourceName: 'Updated' });
      const deleted = await ipcMain.invoke('income:delete', 'inc-1');

      expect(created).toEqual({ success: true, data: { id: 'inc-1' } });
      expect(updated).toEqual({ success: true, data: { id: 'inc-1', sourceName: 'Updated' } });
      expect(deleted).toEqual({ success: true });
      expect(services.budgetManager.createIncome).toHaveBeenCalledWith({ sourceName: 'Salary' });
      expect(services.budgetManager.updateIncome).toHaveBeenCalledWith('inc-1', { sourceName: 'Updated' });
      expect(services.budgetManager.deleteIncome).toHaveBeenCalledWith('inc-1');
    });

    it('routes bills and goals CRUD handlers through budget manager', async () => {
      const services = createServices({
        budgetManager: {
          ...createServices().budgetManager,
          createBill: vi.fn(() => ({ id: 'bill-1' })),
          updateBill: vi.fn(() => ({ id: 'bill-1', creditorName: 'Updated Bill' })),
          deleteBill: vi.fn(() => true),
          createGoal: vi.fn(() => ({ id: 'goal-1' })),
          updateGoal: vi.fn(() => ({ id: 'goal-1', name: 'Updated Goal' })),
          deleteGoal: vi.fn(() => true),
        },
      });
      registerHandlers(ipcMain, services);

      const billCreated = await ipcMain.invoke('bills:create', { creditorName: 'Rent' });
      const billUpdated = await ipcMain.invoke('bills:update', 'bill-1', { creditorName: 'Updated Bill' });
      const billDeleted = await ipcMain.invoke('bills:delete', 'bill-1');
      const goalCreated = await ipcMain.invoke('goals:create', { name: 'Emergency Fund' });
      const goalUpdated = await ipcMain.invoke('goals:update', 'goal-1', { name: 'Updated Goal' });
      const goalDeleted = await ipcMain.invoke('goals:delete', 'goal-1');

      expect(billCreated).toEqual({ success: true, data: { id: 'bill-1' } });
      expect(billUpdated).toEqual({ success: true, data: { id: 'bill-1', creditorName: 'Updated Bill' } });
      expect(billDeleted).toEqual({ success: true });
      expect(goalCreated).toEqual({ success: true, data: { id: 'goal-1' } });
      expect(goalUpdated).toEqual({ success: true, data: { id: 'goal-1', name: 'Updated Goal' } });
      expect(goalDeleted).toEqual({ success: true });
    });

    it('returns settings data and updates settings', async () => {
      const services = createServices({
        database: {
          ...createServices().database,
          getSettings: vi.fn(() => ({ autoLockMinutes: 10, currency: 'USD' })),
          updateSettings: vi.fn((input) => ({ autoLockMinutes: 10, ...input })),
        },
      });
      registerHandlers(ipcMain, services);

      const settings = await ipcMain.invoke('settings:get');
      const updated = await ipcMain.invoke('settings:update', { currency: 'CAD' });

      expect(settings).toEqual({ success: true, data: { autoLockMinutes: 10, currency: 'USD' } });
      expect(updated).toEqual({ success: true, data: { autoLockMinutes: 10, currency: 'CAD' } });
      expect(services.database.updateSettings).toHaveBeenCalledWith({ currency: 'CAD' });
    });

    it('switches budgets without persisting bill assignment locks', async () => {
      const services = createServices({
        budgetManager: {
          ...createServices().budgetManager,
          setCurrentBudget: vi.fn(() => ({ id: 'budget-2' })),
          assignBillToPaycheck: vi.fn(),
          skipBill: vi.fn(),
        },
      });
      registerHandlers(ipcMain, services);

      const switched = await ipcMain.invoke('budget:switch', 'budget-2');

      expect(switched).toEqual({ success: true, data: { id: 'budget-2' } });
      expect(services.budgetManager.assignBillToPaycheck).not.toHaveBeenCalled();
      expect(services.budgetManager.skipBill).not.toHaveBeenCalled();
    });

    it('locks auth and clears active budget/database services', async () => {
      const close = vi.fn();
      const services = createServices({
        database: {
          ...createServices().database,
          close,
        },
      });
      registerHandlers(ipcMain, services);

      const result = await ipcMain.invoke('auth:lock');
      expect(result).toEqual({ success: true });
      expect(services.auth.lock).toHaveBeenCalled();
      expect(close).toHaveBeenCalled();
      expect(services.database).toBeNull();
      expect(services.budgetManager).toBeNull();
    });

    it('covers additional auth, budget, schedule, export, and debt handlers', async () => {
      const services = createServices({
        database: {
          ...createServices().database,
          updateSettings: vi.fn((input) => ({ autoLockMinutes: 5, ...input })),
        },
        budgetManager: {
          ...createServices().budgetManager,
          getCurrentState: vi.fn(() => ({ budgetId: 'budget-1', isQuickBudget: false })),
          getAllBudgets: vi.fn(() => [{ id: 'budget-1' }]),
          getAllBudgetsWithStats: vi.fn(() => [{ id: 'budget-1', incomeCount: 1, billCount: 1 }]),
          getBudgetById: vi.fn(() => ({ id: 'budget-1' })),
          getBudgetStats: vi.fn(() => ({ incomeCount: 1, billCount: 2 })),
          createBudget: vi.fn(() => ({ id: 'budget-2' })),
          updateBudget: vi.fn(() => ({ id: 'budget-1' })),
          deleteBudget: vi.fn(() => true),
          setCurrentBudget: vi.fn(() => ({ id: 'budget-1' })),
          startQuickBudget: vi.fn(),
          endQuickBudget: vi.fn(),
          getSkippedBills: vi.fn(() => [{ id: 'skip-1' }]),
          skipBill: vi.fn(() => ({ id: 'skip-1' })),
          unskipBill: vi.fn(() => true),
          isSkipped: vi.fn(() => true),
          getBillAssignments: vi.fn(() => [{ id: 'assign-1' }]),
          assignBillToPaycheck: vi.fn(() => ({ id: 'assign-1' })),
          removeBillAssignment: vi.fn(() => true),
          getIncomeOverrides: vi.fn(() => [{ id: 'override-1' }]),
          setIncomeOverride: vi.fn(() => ({ id: 'override-1' })),
          removeIncomeOverride: vi.fn(() => true),
          getAllGoals: vi.fn(() => [{ id: 'goal-1' }]),
          getAllBills: vi.fn(() => [{ id: 'bill-0001', budgetedAmount: 120, creditorName: 'Bill' }]),
          getDebtByBillId: vi.fn(() => ({ id: 'debt-1' })),
          createDebt: vi.fn(() => ({ id: 'debt-1' })),
          updateDebt: vi.fn(() => ({ id: 'debt-1', apr: 10 })),
          deleteDebt: vi.fn(() => true),
          getLeaves: vi.fn(() => [{ id: 'leave-1' }]),
          createLeave: vi.fn(() => ({ id: 'leave-1' })),
          updateLeave: vi.fn(() => ({ id: 'leave-1', type: 'unpaid' })),
          deleteLeave: vi.fn(() => true),
          getDebtById: vi.fn(() => ({
            id: 'debt-1',
            billId: 'bill-0001',
            principalBalance: 1000,
            apr: 10,
            monthlyPayment: 100,
          })),
        },
        auth: {
          ...createServices().auth,
          isFirstTimeSetup: vi.fn(() => false),
          createMasterPassword: vi.fn(async () => ({ success: true })),
          unlock: vi.fn(async () => ({ success: true })),
          unlockWithBiometric: vi.fn(async () => ({ success: true })),
          enableBiometric: vi.fn(async () => ({ success: true })),
          isBiometricEnabled: vi.fn(() => true),
          changePassword: vi.fn(async () => ({ success: true })),
          verifyRecoveryKey: vi.fn(async () => ({ success: true })),
          resetPasswordWithRecoveryKey: vi.fn(async () => ({ success: true })),
        },
        credentials: {
          ...createServices().credentials,
          hasPassword: vi.fn(async () => true),
        },
        scheduler: {
          ...createServices().scheduler,
        },
        scheduleCompute: {
          ...createServices().scheduleCompute,
          runJob: vi.fn(async (request: { op: string; inputHash: string; input: { startDate: string; months: number } }) => {
            if (request.op === 'goals') {
              return {
                type: 'result',
                protocolVersion: 1,
                jobId: 'test-job',
                inputHash: request.inputHash,
                op: 'goals',
                goalProjections: [{ id: 'gp-1' }],
              };
            }
            return {
              type: 'result',
              protocolVersion: 1,
              jobId: 'test-job',
              inputHash: request.inputHash,
              op: 'schedule',
              schedule: {
                startDate: request.input.startDate,
                endDate: '2026-01-31',
                paychecks: [],
                fullPaychecks: [],
                viewportMonths: request.input.months,
                entries: [],
                summary: {
                  totalIncome: 0,
                  totalExpenses: 0,
                  netBalance: 0,
                  finalSavingsBalance: 0,
                  shortfallCount: 0,
                },
                recommendations: [],
                maxBudgetRemaining: 0,
                minCashOnHand: 100,
                goalProjections: [{ id: 'gp-1' }],
              },
            };
          }),
        },
      });
      registerHandlers(ipcMain, services);

      approveExportPath('/Users/tester/exports/report.pdf');
      approveExportPath('/Users/tester/exports/report.html');
      approveExportPath('/Users/tester/exports/report.xlsx');

      await expect(ipcMain.invoke('auth:is-first-time-setup')).resolves.toBe(false);
      await expect(ipcMain.invoke('auth:is-unlocked')).resolves.toBe(true);
      await expect(ipcMain.invoke('auth:enable-biometric')).resolves.toEqual({ success: true });
      await expect(ipcMain.invoke('auth:is-biometric-enabled')).resolves.toBe(true);
      await expect(ipcMain.invoke('auth:change-password', 'old-pass', 'new-pass-123')).resolves.toEqual({
        success: true,
      });
      await expect(ipcMain.invoke('auth:get-pending-recovery-key')).resolves.toBeNull();
      await expect(ipcMain.invoke('auth:clear-pending-recovery-key')).resolves.toEqual({ success: true });
      await expect(ipcMain.invoke('auth:verify-recovery-key', 'key')).resolves.toEqual({ success: true });
      await expect(ipcMain.invoke('auth:activity-ping')).resolves.toEqual({ success: true });

      await expect(ipcMain.invoke('credentials:delete')).resolves.toEqual({ success: true });
      await expect(ipcMain.invoke('credentials:has')).resolves.toBe(true);
      expect(() => ipcMain.invoke('credentials:get')).toThrow('No handler registered for credentials:get');
      expect(() => ipcMain.invoke('credentials:save', 'pass')).toThrow(
        'No handler registered for credentials:save'
      );
      expect(() => ipcMain.invoke('credentials:offer-save', 'new-pass-123')).toThrow(
        'No handler registered for credentials:offer-save'
      );
      expect(() => ipcMain.invoke('auth:set-auto-lock', 10)).toThrow(
        'No handler registered for auth:set-auto-lock'
      );

      await expect(ipcMain.invoke('budget:get-all')).resolves.toEqual({ success: true, data: [{ id: 'budget-1' }] });
      await expect(ipcMain.invoke('budget:get-all-with-stats')).resolves.toEqual({
        success: true,
        data: [{ id: 'budget-1', incomeCount: 1, billCount: 1 }],
      });
      await expect(ipcMain.invoke('budget:get-current')).resolves.toEqual({
        success: true,
        data: { budget: { id: 'budget-1' }, isQuickBudget: false },
      });
      await expect(ipcMain.invoke('budget:get-snapshot')).resolves.toEqual({
        success: true,
        data: {
          incomes: [{ id: 'income-1' }],
          bills: [{ id: 'bill-1' }],
          goals: [{ id: 'goal-1' }],
          skippedBills: [],
          billAssignments: [],
          incomeOverrides: [],
          debts: [],
          leaves: [],
          budget: { id: 'budget-1', name: 'Test' },
        },
      });
      await expect(ipcMain.invoke('budget:get-stats', 'budget-1')).resolves.toEqual({
        success: true,
        data: { incomeCount: 1, billCount: 2 },
      });
      await expect(ipcMain.invoke('budget:create', { name: 'B' })).resolves.toEqual({ success: true, data: { id: 'budget-2' } });
      await expect(ipcMain.invoke('budget:update', 'budget-1', { name: 'B2' })).resolves.toEqual({
        success: true,
        data: { id: 'budget-1' },
      });
      await expect(ipcMain.invoke('budget:delete', 'budget-3')).resolves.toEqual({ success: true });
      await expect(ipcMain.invoke('budget:start-quick')).resolves.toEqual({ success: true });
      await expect(ipcMain.invoke('budget:end-quick')).resolves.toEqual({ success: true });

      await expect(ipcMain.invoke('skipped-bills:get-all')).resolves.toEqual({ success: true, data: [{ id: 'skip-1' }] });
      await expect(ipcMain.invoke('skipped-bills:skip', 'bill-0001', '2026-02-01')).resolves.toEqual({
        success: true,
        data: { id: 'skip-1' },
      });
      await expect(ipcMain.invoke('skipped-bills:unskip', 'bill-0001', '2026-02-01')).resolves.toEqual({ success: true });
      await expect(ipcMain.invoke('skipped-bills:is-skipped', 'bill-0001', '2026-02-01')).resolves.toEqual({
        success: true,
        data: true,
      });

      await expect(ipcMain.invoke('bill-assignments:get-all')).resolves.toEqual({
        success: true,
        data: [{ id: 'assign-1' }],
      });
      await expect(
        ipcMain.invoke('bill-assignments:assign', 'bill-0001', '2026-02-01', '2026-01-31')
      ).resolves.toEqual({ success: true, data: { id: 'assign-1' } });
      await expect(ipcMain.invoke('bill-assignments:remove', 'bill-0001', '2026-02-01')).resolves.toEqual({
        success: true,
      });

      await expect(ipcMain.invoke('income-overrides:get-all')).resolves.toEqual({
        success: true,
        data: [{ id: 'override-1' }],
      });
      await expect(ipcMain.invoke('income-overrides:set', 'income-1', '2026-01-31', 1200)).resolves.toEqual({
        success: true,
        data: { id: 'override-1' },
      });
      await expect(ipcMain.invoke('income-overrides:remove', 'income-1', '2026-01-31')).resolves.toEqual({
        success: true,
        data: true,
      });

      await expect(ipcMain.invoke('goals:get-all')).resolves.toEqual({ success: true, data: [{ id: 'goal-1' }] });
      await expect(ipcMain.invoke('goals:get-projections')).resolves.toEqual({
        success: true,
        data: [{ id: 'gp-1' }],
      });
      await expect(ipcMain.invoke('schedule:build', '2026-01-01', 1, 1000)).resolves.toEqual({
        success: true,
        data: expect.objectContaining({ startDate: '2026-01-01' }),
      });

      await expect(
        ipcMain.invoke('export:to-pdf', { paychecks: [] }, '/Users/tester/exports/report.pdf')
      ).resolves.toEqual({ success: true });
      await expect(
        ipcMain.invoke('export:to-spreadsheet', { paychecks: [] }, '/Users/tester/exports/report.xlsx')
      ).resolves.toEqual({ success: true });

      await expect(ipcMain.invoke('settings:get')).resolves.toEqual({
        success: true,
        data: { autoLockMinutes: 5 },
      });
      await expect(ipcMain.invoke('settings:update', { theme: 'dark', autoLockMinutes: 15 })).resolves.toEqual({
        success: true,
        data: { autoLockMinutes: 15, theme: 'dark' },
      });
      expect(services.auth.setAutoLock).toHaveBeenCalledWith(15);

      await expect(ipcMain.invoke('debts:get-all')).resolves.toEqual({ success: true, data: [] });
      await expect(ipcMain.invoke('debts:get-by-bill', 'bill-0001')).resolves.toEqual({
        success: true,
        data: { id: 'debt-1' },
      });
      await expect(
        ipcMain.invoke('debts:create', {
          billId: 'bill-0001',
          principalBalance: 1000,
          apr: 10,
          monthlyPayment: 100,
        })
      ).resolves.toEqual({
        success: true,
        data: { id: 'debt-1' },
      });
      await expect(ipcMain.invoke('debts:update', 'debt-1', { apr: 10 })).resolves.toEqual({
        success: true,
        data: { id: 'debt-1', apr: 10 },
      });
      await expect(ipcMain.invoke('debts:delete', 'debt-1')).resolves.toEqual({ success: true });
      await expect(ipcMain.invoke('debts:get-amortization', 'debt-1')).resolves.toEqual({
        success: true,
        data: expect.objectContaining({ monthsToPayoff: 0 }),
      });
      await expect(ipcMain.invoke('debts:get-all-with-amortization')).resolves.toEqual({ success: true, data: [] });

      await expect(ipcMain.invoke('leaves:get-all')).resolves.toEqual({
        success: true,
        data: [{ id: 'leave-1' }],
      });
      await expect(
        ipcMain.invoke('leaves:create', {
          incomeId: 'income-0001',
          name: 'Medical',
          type: 'unpaid',
          startDate: '2026-02-01',
          endDate: '2026-02-14',
        })
      ).resolves.toEqual({ success: true, data: { id: 'leave-1' } });
      await expect(
        ipcMain.invoke('leaves:update', 'leave-1', {
          incomeId: 'income-0001',
          name: 'Medical',
          type: 'unpaid',
          startDate: '2026-02-01',
          endDate: '2026-02-14',
        })
      ).resolves.toEqual({ success: true, data: { id: 'leave-1', type: 'unpaid' } });
      await expect(ipcMain.invoke('leaves:delete', 'leave-1')).resolves.toEqual({ success: true });
    });

    it('returns database init error when biometric unlock succeeds but initialization fails', async () => {
      const services = createServices();
      const initSpy = vi.spyOn(DatabaseService.prototype, 'initialize').mockImplementation(() => {
        throw new Error('biometric db locked');
      });
      registerHandlers(ipcMain, services);

      await expect(ipcMain.invoke('auth:unlock-with-biometric')).resolves.toEqual({
        success: false,
        error: expect.stringContaining('biometric db locked'),
      });
      initSpy.mockRestore();
    });

    it('reinitializes database after successful password reset with recovery', async () => {
      const services = createServices();
      const initSpy = vi.spyOn(DatabaseService.prototype, 'initialize').mockImplementation(() => undefined);
      registerHandlers(ipcMain, services);

      await expect(
        ipcMain.invoke('auth:reset-password-with-recovery', 'recovery-key', 'new-password-123')
      ).resolves.toEqual({ success: true });
      expect(initSpy).toHaveBeenCalled();
      initSpy.mockRestore();
    });

    it('returns null current budget when no budget id is selected', async () => {
      const services = createServices({
        budgetManager: {
          ...createServices().budgetManager,
          getCurrentState: vi.fn(() => ({ budgetId: null, isQuickBudget: false })),
        },
      });
      registerHandlers(ipcMain, services);

      await expect(ipcMain.invoke('budget:get-current')).resolves.toEqual({
        success: true,
        data: { budget: null, isQuickBudget: false },
      });
    });

    it('uses overlay starting balance when schedule:build receives draft overlay', async () => {
      const services = createServices();
      registerHandlers(ipcMain, services);

      await ipcMain.invoke('schedule:build', '2026-02-01', 3, 750, { startingBalance: 750 });

      expect(services.scheduleCompute.runJob).toHaveBeenCalledWith(
        expect.objectContaining({
          op: 'schedule',
          input: expect.objectContaining({
            startDate: '2026-02-01',
            months: 3,
            startingBalance: 750,
          }),
        }),
        expect.objectContaining({ onProgress: expect.any(Function) })
      );
      expect(services.scheduler.generateSchedule).not.toHaveBeenCalled();
    });

    it('builds debt payoffs for schedule generation when debts link to bills', async () => {
      const services = createServices({
        budgetManager: {
          ...createServices().budgetManager,
          getAllGoals: vi.fn(() => [{ id: 'goal-1', name: 'Fund', targetAmount: 1000, targetDate: '2026-12-01' }]),
          getAllBills: vi.fn(() => [{ id: 'bill-1', budgetedAmount: 100, creditorName: 'Card' }]),
          getDebts: vi.fn(() => [
            {
              id: 'debt-1',
              budgetId: 'budget-1',
              billId: 'bill-1',
              principalBalance: 500,
              apr: 8,
              monthlyPayment: 100,
            },
          ]),
        },
        debt: {
          calculateAmortization: vi.fn(() => ({
            monthsToPayoff: 5,
            payments: [],
            payoffDate: '2026-05-01',
          })),
        },
      });
      registerHandlers(ipcMain, services);

      await ipcMain.invoke('goals:get-projections');
      expect(services.debt.calculateAmortization).toHaveBeenCalledWith(500, 8, 100, 0, 'none');
      expect(services.scheduleCompute.runJob).toHaveBeenCalledWith(
        expect.objectContaining({ op: 'goals' })
      );
      expect(services.scheduler.generateGoalProjections).not.toHaveBeenCalled();
    });

    it('returns empty goal projections when no goals are configured', async () => {
      const services = createServices({
        budgetManager: {
          ...createServices().budgetManager,
          getAllGoals: vi.fn(() => []),
        },
      });
      registerHandlers(ipcMain, services);

      await expect(ipcMain.invoke('goals:get-projections')).resolves.toEqual({
        success: true,
        data: [],
      });
    });

    it('allows debts:get-all-with-amortization with overlay debts even without budget id', async () => {
      const services = createServices({
        budgetManager: {
          ...createServices().budgetManager,
          getCurrentState: vi.fn(() => ({ budgetId: null, isQuickBudget: false })),
          getAllBills: vi.fn(() => [{ id: 'bill-1', budgetedAmount: 200 }]),
        },
        debt: {
          calculateAmortization: vi.fn(() => ({ monthsToPayoff: 3, payments: [{ payment: 100 }], payoffDate: '2026-03-01' })),
        },
      });
      registerHandlers(ipcMain, services);

      const result = await ipcMain.invoke('debts:get-all-with-amortization', {
        debts: [
          {
            id: 'debt-1',
            budgetId: 'budget-1',
            billId: 'draft-12345678-abcd',
            principalBalance: 1000,
            apr: 10,
            monthlyPayment: 100,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        bills: [
          {
            id: 'draft-12345678-abcd',
            creditorName: 'Card',
            budgetedAmount: 200,
            dueDay: 1,
            isRecurring: true,
            priority: 'normal',
          },
        ],
      });
      expect(result).toEqual({ success: true, data: expect.any(Array) });
    });

    it('creates debts in quick budget mode when the ephemeral budget id is set', async () => {
      const services = createServices({
        budgetManager: {
          ...createServices().budgetManager,
          getCurrentState: vi.fn(() => ({ budgetId: 'quick-1', isQuickBudget: true })),
          createDebt: vi.fn(() => ({ id: 'debt-q' })),
        },
      });
      registerHandlers(ipcMain, services);

      await expect(
        ipcMain.invoke('debts:create', {
          billId: 'bill-1',
          principalBalance: 100,
          apr: 10,
          monthlyPayment: 25,
        })
      ).resolves.toEqual({ success: true, data: { id: 'debt-q' } });
      expect(services.budgetManager.createDebt).toHaveBeenCalled();
    });
  });

  describe('sad', () => {
    it('returns budget and debt not-found errors for update/delete handlers', async () => {
      const services = createServices({
        budgetManager: {
          ...createServices().budgetManager,
          updateBudget: vi.fn(() => null),
          updateDebt: vi.fn(() => null),
          deleteDebt: vi.fn(() => false),
          getDebtById: vi.fn(() => null),
          updateLeave: vi.fn(() => null),
          deleteLeave: vi.fn(() => false),
        },
      });
      registerHandlers(ipcMain, services);

      await expect(ipcMain.invoke('budget:update', 'missing', { name: 'x' })).resolves.toMatchObject({
        success: false,
        error: 'Budget not found',
      });
      await expect(ipcMain.invoke('debts:update', 'missing', { apr: 12 })).resolves.toMatchObject({
        success: false,
        error: 'Debt not found',
      });
      await expect(ipcMain.invoke('debts:delete', 'missing')).resolves.toMatchObject({
        success: false,
        error: 'Debt not found',
      });
      await expect(ipcMain.invoke('debts:get-amortization', 'missing')).resolves.toMatchObject({
        success: false,
        error: 'Debt not found',
      });
      await expect(
        ipcMain.invoke('leaves:update', 'missing', {
          incomeId: 'income-0001',
          name: 'x',
          type: 'paid',
          startDate: '2026-01-01',
          endDate: '2026-01-02',
        })
      ).resolves.toMatchObject({
        success: false,
        error: 'Leave not found',
      });
      await expect(ipcMain.invoke('leaves:delete', 'missing')).resolves.toMatchObject({
        success: false,
        error: 'Leave not found',
      });
    });

    it('rejects export:to-html with invalid path', async () => {
      const services = createServices();
      registerHandlers(ipcMain, services);

      const result = await ipcMain.invoke('export:to-html', { paychecks: [] }, '/etc/passwd');
      expect(result).toEqual({ success: false, error: 'Invalid export path' });
      expect(services.pdf.generateHtmlFile).not.toHaveBeenCalled();
    });

    it('rejects export:to-pdf and export:to-spreadsheet with invalid paths', async () => {
      const services = createServices();
      registerHandlers(ipcMain, services);

      await expect(ipcMain.invoke('export:to-pdf', { paychecks: [] }, '/etc/passwd')).resolves.toEqual({
        success: false,
        error: 'Invalid export path',
      });
      await expect(ipcMain.invoke('export:to-spreadsheet', { paychecks: [] }, '/etc/passwd')).resolves.toEqual({
        success: false,
        error: 'Invalid export path',
      });
    });

    it('returns not-found errors for missing income/bill/goal records', async () => {
      const services = createServices({
        budgetManager: {
          ...createServices().budgetManager,
          updateIncome: vi.fn(() => null),
          deleteIncome: vi.fn(() => false),
          getAllBills: vi.fn(() => [{ id: 'bill-1' }]),
          updateBill: vi.fn(() => null),
          deleteBill: vi.fn(() => false),
          updateGoal: vi.fn(() => null),
        },
      });
      registerHandlers(ipcMain, services);

      await expect(ipcMain.invoke('income:update', 'missing', { sourceName: 'x' })).resolves.toMatchObject({
        success: false,
        error: 'Income not found',
      });
      await expect(ipcMain.invoke('bills:delete', 'missing')).resolves.toMatchObject({
        success: false,
        error: 'Bill not found',
      });
      await expect(ipcMain.invoke('income:delete', 'missing')).resolves.toMatchObject({
        success: false,
        error: 'Income not found',
      });
      await expect(ipcMain.invoke('bills:get-all')).resolves.toEqual({
        success: true,
        data: [{ id: 'bill-1' }],
      });
      await expect(ipcMain.invoke('bills:update', 'missing', { creditorName: 'x' })).resolves.toMatchObject({
        success: false,
        error: 'Bill not found',
      });
      await expect(ipcMain.invoke('goals:update', 'missing', { name: 'x' })).resolves.toMatchObject({
        success: false,
        error: 'Goal not found',
      });
    });

    it('returns budget switch error when budget does not exist', async () => {
      const services = createServices({
        budgetManager: {
          ...createServices().budgetManager,
          setCurrentBudget: vi.fn(() => null),
        },
      });
      registerHandlers(ipcMain, services);

      const result = await ipcMain.invoke('budget:switch', 'missing-budget');
      expect(result).toEqual({ success: false, error: 'Budget not found' });
    });

    it('returns auth:lock error when lock throws', async () => {
      const services = createServices({
        auth: {
          ...createServices().auth,
          lock: vi.fn(() => {
            throw new Error('lock failed');
          }),
        },
      });
      registerHandlers(ipcMain, services);

      const result = await ipcMain.invoke('auth:lock');
      expect(result).toEqual({ success: false, error: 'lock failed' });
    });

    it('returns no-budget-selected errors on debt handlers without active budget', async () => {
      const services = createServices({
        budgetManager: {
          ...createServices().budgetManager,
          getCurrentState: vi.fn(() => ({ budgetId: null, isQuickBudget: false })),
        },
      });
      registerHandlers(ipcMain, services);

      await expect(ipcMain.invoke('debts:get-all')).resolves.toEqual({
        success: false,
        error: 'No budget selected',
      });
      await expect(ipcMain.invoke('debts:get-by-bill', 'bill-1')).resolves.toEqual({
        success: false,
        error: 'No budget selected',
      });
      await expect(ipcMain.invoke('debts:create', { billId: 'bill-1' })).resolves.toEqual({
        success: false,
        error: 'No budget selected',
      });
      await expect(ipcMain.invoke('debts:update', 'debt-1', { apr: 10 })).resolves.toEqual({
        success: false,
        error: 'No budget selected',
      });
      await expect(ipcMain.invoke('debts:delete', 'debt-1')).resolves.toEqual({
        success: false,
        error: 'No budget selected',
      });
      await expect(ipcMain.invoke('debts:get-amortization', 'debt-1')).resolves.toEqual({
        success: false,
        error: 'No budget selected',
      });
      await expect(ipcMain.invoke('debts:get-all-with-amortization')).resolves.toEqual({
        success: false,
        error: 'No budget selected',
      });
      await expect(ipcMain.invoke('leaves:get-all')).resolves.toEqual({
        success: false,
        error: 'No budget selected',
      });
      await expect(
        ipcMain.invoke('leaves:create', {
          incomeId: 'income-1',
          name: 'x',
          type: 'unpaid',
          startDate: '2026-01-01',
          endDate: '2026-01-02',
        })
      ).resolves.toEqual({
        success: false,
        error: 'No budget selected',
      });
      await expect(
        ipcMain.invoke('leaves:update', 'leave-1', {
          incomeId: 'income-1',
          name: 'x',
          type: 'paid',
          startDate: '2026-01-01',
          endDate: '2026-01-02',
        })
      ).resolves.toEqual({
        success: false,
        error: 'No budget selected',
      });
      await expect(ipcMain.invoke('leaves:delete', 'leave-1')).resolves.toEqual({
        success: false,
        error: 'No budget selected',
      });
    });

    it('propagates ipcData/ipcVoid failures for unskip, assignment remove, and goal delete', async () => {
      const services = createServices({
        budgetManager: {
          ...createServices().budgetManager,
          unskipBill: vi.fn(() => {
            throw new Error('unskip exploded');
          }),
          removeBillAssignment: vi.fn(() => {
            throw new Error('remove exploded');
          }),
          deleteGoal: vi.fn(() => false),
        },
      });
      registerHandlers(ipcMain, services);

      await expect(ipcMain.invoke('skipped-bills:unskip', 'bill-1', '2026-01-01')).resolves.toMatchObject({
        success: false,
        error: 'unskip exploded',
      });
      await expect(ipcMain.invoke('bill-assignments:remove', 'bill-1', '2026-01-01')).resolves.toMatchObject({
        success: false,
        error: 'remove exploded',
      });
      await expect(ipcMain.invoke('goals:delete', 'goal-1')).resolves.toMatchObject({
        success: false,
        error: 'Goal not found',
      });
    });

    it('returns budget not found when budget:update succeeds without data', async () => {
      const services = createServices({
        budgetManager: {
          ...createServices().budgetManager,
          updateBudget: vi.fn(() => null),
        },
      });
      registerHandlers(ipcMain, services);

      await expect(ipcMain.invoke('budget:update', 'missing-budget', { name: 'X' })).resolves.toMatchObject({
        success: false,
        error: 'Budget not found',
      });
    });

    it('returns delete error when budget cannot be deleted', async () => {
      const services = createServices({
        budgetManager: {
          ...createServices().budgetManager,
          deleteBudget: vi.fn(() => false),
        },
      });
      registerHandlers(ipcMain, services);

      await expect(ipcMain.invoke('budget:delete', 'budget-1')).resolves.toMatchObject({
        success: false,
        error: 'Cannot delete budget (may be current budget)',
      });
    });

    it('returns false success when unskip or assignment remove yields no data', async () => {
      const services = createServices({
        budgetManager: {
          ...createServices().budgetManager,
          unskipBill: vi.fn(() => false),
          removeBillAssignment: vi.fn(() => false),
        },
      });
      registerHandlers(ipcMain, services);

      await expect(ipcMain.invoke('skipped-bills:unskip', 'bill-1', '2026-01-01')).resolves.toEqual({
        success: false,
      });
      await expect(ipcMain.invoke('bill-assignments:remove', 'bill-1', '2026-01-01')).resolves.toEqual({
        success: false,
      });
    });

    it('returns create-master-password errors from unexpected failures', async () => {
      const services = createServices({
        auth: {
          ...createServices().auth,
          createMasterPassword: vi.fn(async () => {
            throw new Error('unexpected setup failure');
          }),
        },
      });
      registerHandlers(ipcMain, services);

      await expect(ipcMain.invoke('auth:create-master-password', 'pw')).resolves.toEqual({
        success: false,
        error: 'unexpected setup failure',
      });
    });

    it('returns export errors when exporter throws', async () => {
      const services = createServices({
        pdf: {
          generatePdf: vi.fn(async () => {
            throw new Error('pdf failed');
          }),
          generateHtmlFile: vi.fn(async () => {
            throw new Error('html failed');
          }),
        },
        spreadsheet: {
          generateXlsx: vi.fn(async () => {
            throw new Error('xlsx failed');
          }),
        },
      });
      registerHandlers(ipcMain, services);

      approveExportPath('/Users/tester/exports/ok.pdf');
      approveExportPath('/Users/tester/exports/ok.html');
      approveExportPath('/Users/tester/exports/ok.xlsx');

      await expect(ipcMain.invoke('export:to-pdf', { paychecks: [] }, '/Users/tester/exports/ok.pdf')).resolves.toEqual({
        success: false,
        error: 'pdf failed',
      });
      await expect(ipcMain.invoke('export:to-html', { paychecks: [] }, '/Users/tester/exports/ok.html')).resolves.toEqual({
        success: false,
        error: 'html failed',
      });
      await expect(
        ipcMain.invoke('export:to-spreadsheet', { paychecks: [] }, '/Users/tester/exports/ok.xlsx')
      ).resolves.toEqual({
        success: false,
        error: 'xlsx failed',
      });
    });
  });

  describe('hostile', () => {
    it('returns lock error for guarded handlers when app is locked', async () => {
      const services = createServices({
        auth: {
          ...createServices().auth,
          getIsUnlocked: vi.fn(() => false),
        },
      });
      registerHandlers(ipcMain, services);

      const result = await ipcMain.invoke('budget:get-all');
      expect(result).toEqual({ success: false, error: 'App is locked' });
    });
  });

  describe('diagnostics', () => {
    describe('happy', () => {
      it('reports while locked but requires unlock to get or export diagnostics', async () => {
        const services = createServices({
          auth: {
            ...createServices().auth,
            getIsUnlocked: vi.fn(() => false),
          },
        });
        registerHandlers(ipcMain, services);

        await expect(
          ipcMain.invoke('diagnostics:report', {
            source: 'renderer:test',
            message: 'ui boom',
          })
        ).resolves.toEqual({ success: true, data: { id: 'diag-test' } });

        await expect(ipcMain.invoke('diagnostics:get-event', 'diag-test')).resolves.toEqual({
          success: false,
          error: 'App is locked',
        });
        await expect(ipcMain.invoke('diagnostics:get-bundle', 5)).resolves.toEqual({
          success: false,
          error: 'App is locked',
        });
        approveExportPath('/Users/tester/diagnostics.json');
        await expect(
          ipcMain.invoke('diagnostics:export', '/Users/tester/diagnostics.json', 10)
        ).resolves.toEqual({
          success: false,
          error: 'App is locked',
        });
        expect(diagnostics.exportBundle).not.toHaveBeenCalled();

        await expect(ipcMain.invoke('budget:get-all')).resolves.toEqual({
          success: false,
          error: 'App is locked',
        });
      });

      it('gets event bundle and exports after unlock', async () => {
        const services = createServices();
        registerHandlers(ipcMain, services);

        await expect(ipcMain.invoke('diagnostics:get-event', 'diag-test')).resolves.toMatchObject({
          success: true,
          data: { errors: [expect.objectContaining({ id: 'diag-test' })] },
        });

        await expect(ipcMain.invoke('diagnostics:get-bundle', 5)).resolves.toMatchObject({
          success: true,
          data: { errors: expect.any(Array) },
        });

        approveExportPath('/Users/tester/diagnostics.json');
        await expect(
          ipcMain.invoke('diagnostics:export', '/Users/tester/diagnostics.json', 10)
        ).resolves.toEqual({ success: true });
        expect(diagnostics.exportBundle).toHaveBeenCalledWith(
          '/Users/tester/diagnostics.json',
          10
        );
      });
    });

    describe('sad', () => {
      it('rejects malformed report and unapproved export path', async () => {
        vi.mocked(diagnostics.exportBundle).mockClear();
        const services = createServices();
        registerHandlers(ipcMain, services);

        await expect(ipcMain.invoke('diagnostics:report', null)).resolves.toEqual({
          success: false,
          error: 'Invalid diagnostics report',
        });

        await expect(ipcMain.invoke('diagnostics:export', '/etc/passwd')).resolves.toEqual({
          success: false,
          error: 'Invalid export path',
        });
        expect(diagnostics.exportBundle).not.toHaveBeenCalled();
      });
    });

    describe('hostile', () => {
      it('forwards oversized bag rejection from service', async () => {
        vi.mocked(diagnostics.report).mockReturnValueOnce({
          success: false,
          error: 'Diagnostics bag exceeds max depth',
        });
        const services = createServices();
        registerHandlers(ipcMain, services);

        await expect(
          ipcMain.invoke('diagnostics:report', {
            source: 'renderer:hostile',
            message: 'x',
            diagnostics: { nested: {} },
          })
        ).resolves.toEqual({
          success: false,
          error: 'Diagnostics bag exceeds max depth',
        });
      });
    });
  });
});
