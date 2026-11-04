import { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron';
import { AuthService } from '../services/auth.service';
import { CryptoService } from '../services/crypto.service';
import { DatabaseService, DebtInput, LeaveInput } from '../services/database.service';
import { SchedulerService } from '../services/scheduler.service';
import { PdfService } from '../services/pdf.service';
import { SpreadsheetService } from '../services/spreadsheet.service';
import { BudgetManager } from '../services/budget-manager.service';
import { DebtService } from '../services/debt.service';
import { ipcLogger } from '../services/logger.service';
import { diagnostics } from '../services/diagnostics.service';
import { DraftOverlayInput, resolveScheduleInputs } from '../services/draft-overlay.service';
import { billOccurrenceKeyFromIso } from '@shared/billOccurrence';
import { CredentialsService } from '../services/credentials.service';
import { ScheduleComputeHost } from '../services/schedule-compute-host';
import {
  computeScheduleInputHash,
  serializeScheduleComputeInput,
} from '../services/schedule-compute-serialize';
import {
  isScheduleComputeError,
  type ScheduleComputeOp,
  type ScheduleComputeProgressMessage,
} from '@shared/scheduleComputeProtocol';
import type { BudgetInput, ScheduleData } from '@shared/types';
import { DEFAULT_CURRENCY } from '@shared/settingsDefaults';
import { extraMonthlyDollars } from '../services/scheduler/debt/debtSimulator';
import { resolveAppBrowserWindow } from '../utils/dialog';
import { validateScheduleBuildArgs } from '../services/validation.service';
import { applyLockSideEffects } from './appLock';
import {
  withUnlockGuard,
  withBudgetGuard,
  ipcData,
  ipcVoid,
  asReadyServices,
  getSafeErrorMessage,
  assertAppSender,
  setMainWindowGetter,
  type ApiResult,
} from './guards';
import { validateExportPath } from '../utils/exportPaths';
import { IPC } from '@shared/ipcChannels';

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function reportScheduleFailure(
  op: ScheduleComputeOp,
  error: unknown,
  errorCode: string
): string | undefined {
  if (errorCode === 'superseded' || errorCode === 'cancelled') {
    return undefined;
  }
  const reported = diagnostics.report({
    source: `ipc:schedule:${op}`,
    message: getSafeErrorMessage(error),
    stack: error instanceof Error ? error.stack ?? null : null,
    errorCode,
    diagnostics: { op, channel: `schedule:${op}` },
  });
  return reported.success ? reported.id : undefined;
}

interface ScheduleMaps {
  skippedSet: Set<string>;
  manualAssignments: Map<string, string>;
  preferredAssignments: Map<string, string>;
  incomeOverridesMap: Map<string, number>;
}

function buildScheduleMaps(
  resolved: ReturnType<typeof resolveScheduleInputs>
): ScheduleMaps {
  return {
    skippedSet: new Set(
      resolved.skippedBills.map((sb) => billOccurrenceKeyFromIso(sb.billId, sb.skipDate))
    ),
    manualAssignments: new Map(
      resolved.billAssignments.map((a) => [billOccurrenceKeyFromIso(a.billId, a.billDueDate), a.paycheckDate])
    ),
    preferredAssignments: resolved.preferredAssignments,
    incomeOverridesMap: new Map(
      resolved.incomeOverrides.map((o) => [`${o.incomeId}-${o.paycheckDate}`, o.amount])
    ),
  };
}

interface Services {
  auth: AuthService;
  crypto: CryptoService;
  database: DatabaseService | null;
  budgetManager: BudgetManager | null;
  scheduler: SchedulerService;
  scheduleCompute: ScheduleComputeHost;
  pdf: PdfService;
  spreadsheet: SpreadsheetService;
  debt: DebtService;
  credentials: CredentialsService;
}

async function runOffloadedCompute<T>(
  services: Services,
  op: ScheduleComputeOp,
  native: Parameters<typeof serializeScheduleComputeInput>[0],
  extract: (
    message: Awaited<ReturnType<ScheduleComputeHost['runJob']>>
  ) => T,
  onProgress?: (progress: ScheduleComputeProgressMessage) => void
): Promise<ApiResult<T>> {
  if (services.scheduleCompute.isDisposed) {
    // Recover from a cancelled Quit that disposed the host while the window stayed open.
    services.scheduleCompute = new ScheduleComputeHost();
  }

  try {
    const input = serializeScheduleComputeInput(native);
    const inputHash = computeScheduleInputHash(op, input);
    const message = onProgress
      ? await services.scheduleCompute.runJob(
          {
            op,
            inputHash,
            input,
          },
          { onProgress }
        )
      : await services.scheduleCompute.runJob({
          op,
          inputHash,
          input,
        });
    return { success: true, data: extract(message) };
  } catch (error) {
    if (isScheduleComputeError(error)) {
      if (error.code !== 'superseded' && error.code !== 'cancelled') {
        ipcLogger.error(`schedule compute ${op} failed:`, error.code, error.message);
      }
      const diagnosticId = reportScheduleFailure(op, error, error.code);
      return {
        success: false,
        error: error.message,
        errorCode: error.code,
        ...(diagnosticId ? { diagnosticId } : {}),
      };
    }
    ipcLogger.error(`schedule compute ${op} failed:`, error);
    const diagnosticId = reportScheduleFailure(op, error, 'worker_error');
    return {
      success: false,
      error: getErrorMessage(error),
      errorCode: 'worker_error',
      ...(diagnosticId ? { diagnosticId } : {}),
    };
  }
}

function initializeDatabaseServices(services: Services): { success: true } | { success: false; error: string } {
  try {
    services.database = new DatabaseService(services.auth.getCryptoService());
    services.database.initialize();
    services.budgetManager = new BudgetManager(services.database);
    const settings = services.database.getSettings();
    services.auth.setAutoLock(settings.autoLockMinutes);
    // Lock clears BudgetManager; restore last selection so parked drafts can save.
    if (settings.lastBudgetId) {
      services.budgetManager.setCurrentBudget(settings.lastBudgetId);
    }
    return { success: true };
  } catch (error) {
    ipcLogger.error('database init failed:', error);
    diagnostics.report({
      source: 'main:database-init',
      message: getSafeErrorMessage(error),
      stack: error instanceof Error ? error.stack ?? null : null,
      diagnostics: { phase: 'initializeDatabaseServices' },
    });
    services.auth.lock();
    services.database = null;
    services.budgetManager = null;
    return {
      success: false,
      error: `Failed to initialize database: ${getErrorMessage(error)}`,
    };
  }
}

export function registerIpcHandlers(
  ipcMain: IpcMain,
  services: Services,
  options?: { getMainWindow?: () => { webContents: unknown; isDestroyed: () => boolean } | null }
): void {
  if (options?.getMainWindow) {
    setMainWindowGetter(options.getMainWindow);
  }

  services.auth.setOnLock(() => {
    applyLockSideEffects(services);
  });

  ipcMain.handle(IPC.authIsFirstTimeSetup, () => {
    return services.auth.isFirstTimeSetup();
  });

  ipcMain.handle(IPC.authCreateMasterPassword, async (event: IpcMainInvokeEvent, password: string) => {
    const senderError = assertAppSender(event);
    if (senderError) {
      return senderError;
    }
    try {
      const result = await services.auth.createMasterPassword(password);
      if (result.success) {
        try {
          services.database = new DatabaseService(services.auth.getCryptoService());
          services.database.initialize();
          services.budgetManager = new BudgetManager(services.database);
        } catch (error) {
          ipcLogger.error(`${IPC.authCreateMasterPassword} database init failed:`, error);
          diagnostics.report({
            source: 'main:database-init',
            message: getSafeErrorMessage(error),
            stack: error instanceof Error ? error.stack ?? null : null,
            diagnostics: { phase: 'create-master-password' },
          });
          services.auth.revertFirstTimeSetup();
          services.database = null;
          services.budgetManager = null;
          return {
            success: false,
            error: `Failed to initialize database: ${getErrorMessage(error)}`,
          };
        }
        const parentWindow = resolveAppBrowserWindow(BrowserWindow.fromWebContents(event.sender));
        await services.credentials.offerSave(password, parentWindow);
      }
      return result;
    } catch (error) {
      ipcLogger.error(`${IPC.authCreateMasterPassword} failed:`, error);
      diagnostics.report({
        source: 'ipc:auth:create-master-password',
        message: getSafeErrorMessage(error),
        stack: error instanceof Error ? error.stack ?? null : null,
      });
      return { success: false, error: getErrorMessage(error) };
    }
  });

  ipcMain.handle(IPC.authUnlock, async (event: IpcMainInvokeEvent, password: string) => {
    const senderError = assertAppSender(event);
    if (senderError) {
      return senderError;
    }
    const result = await services.auth.unlock(password);
    if (result.success) {
      const dbResult = initializeDatabaseServices(services);
      if (!dbResult.success) {
        return dbResult;
      }
    }
    return result;
  });

  ipcMain.handle(IPC.authUnlockWithSavedCredentials, async (event: IpcMainInvokeEvent) => {
    const senderError = assertAppSender(event);
    if (senderError) {
      return senderError;
    }
    const stored = await services.credentials.getPassword();
    if (!stored.success || !stored.password) {
      return { success: false, error: stored.error || 'No saved password found' };
    }
    const passwordBuf = Buffer.from(stored.password, 'utf8');
    try {
      const result = await services.auth.unlock(passwordBuf.toString('utf8'));
      if (result.success) {
        const dbResult = initializeDatabaseServices(services);
        if (!dbResult.success) {
          return dbResult;
        }
      }
      return { success: result.success, ...(result.error ? { error: result.error } : {}) };
    } finally {
      passwordBuf.fill(0);
    }
  });

  ipcMain.handle(IPC.authUnlockWithBiometric, async (event: IpcMainInvokeEvent) => {
    const senderError = assertAppSender(event);
    if (senderError) {
      return senderError;
    }
    const result = await services.auth.unlockWithBiometric();
    if (result.success) {
      const dbResult = initializeDatabaseServices(services);
      if (!dbResult.success) {
        return dbResult;
      }
    }
    return result;
  });

  ipcMain.handle(IPC.authLock, (event: IpcMainInvokeEvent) => {
    const senderError = assertAppSender(event);
    if (senderError) {
      return senderError;
    }
    try {
      services.auth.lock();
      return { success: true };
    } catch (error) {
      ipcLogger.error(`${IPC.authLock} failed:`, error);
      diagnostics.report({
        source: 'ipc:auth:lock',
        message: getSafeErrorMessage(error),
        stack: error instanceof Error ? error.stack ?? null : null,
      });
      return { success: false, error: getErrorMessage(error) };
    }
  });

  ipcMain.handle(IPC.authIsUnlocked, () => {
    return services.auth.getIsUnlocked();
  });

  ipcMain.handle(IPC.authEnableBiometric, async (event: IpcMainInvokeEvent) => {
    const senderError = assertAppSender(event);
    if (senderError) {
      return senderError;
    }
    return services.auth.enableBiometric();
  });

  ipcMain.handle(IPC.authIsBiometricEnabled, () => {
    return services.auth.isBiometricEnabled();
  });

  ipcMain.handle(IPC.authChangePassword, async (event: IpcMainInvokeEvent, oldPassword: string, newPassword: string) => {
    const senderError = assertAppSender(event);
    if (senderError) {
      return senderError;
    }
    const result = await services.auth.changePassword(oldPassword, newPassword);
    if (result.success) {
      const parentWindow = resolveAppBrowserWindow(BrowserWindow.fromWebContents(event.sender));
      await services.credentials.offerSave(newPassword, parentWindow);
    }
    return result;
  });

  ipcMain.handle(
    IPC.authGetPendingRecoveryKey,
    withUnlockGuard(services, () => services.auth.getPendingRecoveryKey())
  );

  ipcMain.handle(
    IPC.authClearPendingRecoveryKey,
    withUnlockGuard(services, () =>
      ipcVoid(IPC.authClearPendingRecoveryKey, () => services.auth.clearPendingRecoveryKey())
    )
  );

  ipcMain.handle(IPC.authVerifyRecoveryKey, async (event: IpcMainInvokeEvent, recoveryKey: string) => {
    const senderError = assertAppSender(event);
    if (senderError) {
      return senderError;
    }
    return services.auth.verifyRecoveryKey(recoveryKey);
  });

  ipcMain.handle(IPC.authResetPasswordWithRecovery, async (event: IpcMainInvokeEvent, recoveryKey: string, newPassword: string) => {
    const senderError = assertAppSender(event);
    if (senderError) {
      return senderError;
    }
    const result = await services.auth.resetPasswordWithRecoveryKey(recoveryKey, newPassword);
    if (result.success) {
      services.database = new DatabaseService(services.auth.getCryptoService());
      services.database.initialize();
      services.budgetManager = new BudgetManager(services.database);
      const parentWindow = resolveAppBrowserWindow(BrowserWindow.fromWebContents(event.sender));
      await services.credentials.offerSave(newPassword, parentWindow);
    }
    return result;
  });

  ipcMain.handle(IPC.authActivityPing, () => {
    services.auth.recordActivity();
    return { success: true };
  });

  ipcMain.handle(
    IPC.credentialsDelete,
    withUnlockGuard(services, () => services.credentials.deletePassword())
  );

  // Intentionally unguarded: pre-unlock login probe; returns boolean only, not the password.
  ipcMain.handle(IPC.credentialsHas, async () => services.credentials.hasPassword());

  // Budget Management
  const ready = () => asReadyServices(services);

  ipcMain.handle(IPC.budgetGetAll, withBudgetGuard(services, () =>
    ipcData(IPC.budgetGetAll, () => ready().budgetManager.getAllBudgets())
  ));

  ipcMain.handle(IPC.budgetGetAllWithStats, withBudgetGuard(services, () =>
    ipcData(IPC.budgetGetAllWithStats, () => ready().budgetManager.getAllBudgetsWithStats())
  ));

  ipcMain.handle(IPC.budgetGetCurrent, withBudgetGuard(services, () =>
    ipcData(IPC.budgetGetCurrent, () => {
      const { budgetManager } = ready();
      const state = budgetManager.getCurrentState();
      const budget = state.budgetId ? budgetManager.getBudgetById(state.budgetId) : null;
      return { budget, isQuickBudget: state.isQuickBudget };
    })
  ));

  ipcMain.handle(IPC.budgetGetSnapshot, withBudgetGuard(services, () =>
    ipcData(IPC.budgetGetSnapshot, () => ready().budgetManager.getBudgetSnapshot())
  ));

  ipcMain.handle(IPC.budgetGetStats, withBudgetGuard(services, (_, budgetId: string) =>
    ipcData(IPC.budgetGetStats, () => ready().budgetManager.getBudgetStats(budgetId))
  ));

  ipcMain.handle(IPC.budgetCreate, withBudgetGuard(services, (_, input: BudgetInput) =>
    ipcData(IPC.budgetCreate, () => ready().budgetManager.createBudget(input))
  ));

  ipcMain.handle(IPC.budgetUpdate, withBudgetGuard(services, async (_, id: string, input: Partial<BudgetInput>) => {
    const result = await ipcData(IPC.budgetUpdate, () => ready().budgetManager.updateBudget(id, input));
    if (result.success && !result.data) {
      return { success: false, error: 'Budget not found' };
    }
    return result;
  }));

  ipcMain.handle(IPC.budgetDelete, withBudgetGuard(services, async (_, id: string) => {
    const result = await ipcVoid(IPC.budgetDelete, () => {
      const deleted = ready().budgetManager.deleteBudget(id);
      if (!deleted) {
        throw new Error('Cannot delete budget (may be current budget)');
      }
    });
    return result;
  }));

  ipcMain.handle(IPC.budgetSwitch, withBudgetGuard(services, async (_, id: string) => {
    services.scheduleCompute.cancelInFlight('budget-switch');
    const result = await ipcData(IPC.budgetSwitch, () => ready().budgetManager.setCurrentBudget(id));
    if (result.success && !result.data) {
      return { success: false, error: 'Budget not found' };
    }
    return result;
  }));

  ipcMain.handle(IPC.budgetStartQuick, withBudgetGuard(services, () =>
    ipcVoid(IPC.budgetStartQuick, () => { ready().budgetManager.startQuickBudget(); })
  ));

  ipcMain.handle(IPC.budgetEndQuick, withBudgetGuard(services, () =>
    ipcVoid(IPC.budgetEndQuick, () => { ready().budgetManager.endQuickBudget(); })
  ));

  // Income Management (via BudgetManager)
  ipcMain.handle(IPC.incomeGetAll, withBudgetGuard(services, () =>
    ipcData(IPC.incomeGetAll, () => ready().budgetManager.getAllIncomes())
  ));

  ipcMain.handle(IPC.incomeCreate, withBudgetGuard(services, (_, income) =>
    ipcData(IPC.incomeCreate, () => ready().budgetManager.createIncome(income))
  ));

  ipcMain.handle(IPC.incomeUpdate, withBudgetGuard(services, async (_, id: string, income) => {
    const result = await ipcData(IPC.incomeUpdate, () => ready().budgetManager.updateIncome(id, income));
    if (result.success && !result.data) {
      return { success: false, error: 'Income not found' };
    }
    return result;
  }));

  ipcMain.handle(IPC.incomeDelete, withBudgetGuard(services, async (_, id: string) => {
    const result = await ipcVoid(IPC.incomeDelete, () => {
      const deleted = ready().budgetManager.deleteIncome(id);
      if (!deleted) {
        throw new Error('Income not found');
      }
    });
    return result;
  }));

  // Bills Management (via BudgetManager)
  ipcMain.handle(IPC.billsGetAll, withBudgetGuard(services, () =>
    ipcData(IPC.billsGetAll, () => ready().budgetManager.getAllBills())
  ));

  ipcMain.handle(IPC.billsCreate, withBudgetGuard(services, (_, bill) =>
    ipcData(IPC.billsCreate, () => ready().budgetManager.createBill(bill))
  ));

  ipcMain.handle(IPC.billsUpdate, withBudgetGuard(services, async (_, id: string, bill) => {
    const result = await ipcData(IPC.billsUpdate, () => ready().budgetManager.updateBill(id, bill));
    if (result.success && !result.data) {
      return { success: false, error: 'Bill not found' };
    }
    return result;
  }));

  ipcMain.handle(IPC.billsDelete, withBudgetGuard(services, async (_, id: string) => {
    const result = await ipcVoid(IPC.billsDelete, () => {
      const deleted = ready().budgetManager.deleteBill(id);
      if (!deleted) {
        throw new Error('Bill not found');
      }
    });
    return result;
  }));

  // Skipped Bills (via BudgetManager)
  ipcMain.handle(IPC.skippedBillsGetAll, withBudgetGuard(services, () =>
    ipcData(IPC.skippedBillsGetAll, () => ready().budgetManager.getSkippedBills())
  ));

  ipcMain.handle(IPC.skippedBillsSkip, withBudgetGuard(services, (_, billId: string, skipDate: string) =>
    ipcData(IPC.skippedBillsSkip, () => ready().budgetManager.skipBill(billId, skipDate))
  ));

  ipcMain.handle(IPC.skippedBillsUnskip, withBudgetGuard(services, async (_, billId: string, skipDate: string) => {
    const result = await ipcData(IPC.skippedBillsUnskip, () =>
      ready().budgetManager.unskipBill(billId, skipDate)
    );
    if (!result.success) {
      return result;
    }
    return { success: result.data };
  }));

  ipcMain.handle(IPC.skippedBillsIsSkipped, withBudgetGuard(services, (_, billId: string, skipDate: string) =>
    ipcData(IPC.skippedBillsIsSkipped, () => ready().budgetManager.isSkipped(billId, skipDate))
  ));

  // Bill Assignments (via BudgetManager)
  ipcMain.handle(IPC.billAssignmentsGetAll, withBudgetGuard(services, () =>
    ipcData(IPC.billAssignmentsGetAll, () => ready().budgetManager.getBillAssignments())
  ));

  ipcMain.handle(IPC.billAssignmentsAssign, withBudgetGuard(services, (_, billId: string, billDueDate: string, paycheckDate: string) =>
    ipcData(IPC.billAssignmentsAssign, () =>
      ready().budgetManager.assignBillToPaycheck(billId, billDueDate, paycheckDate)
    )
  ));

  ipcMain.handle(IPC.billAssignmentsRemove, withBudgetGuard(services, async (_, billId: string, billDueDate: string) => {
    const result = await ipcData(IPC.billAssignmentsRemove, () =>
      ready().budgetManager.removeBillAssignment(billId, billDueDate)
    );
    if (!result.success) {
      return result;
    }
    return { success: result.data };
  }));

  ipcMain.handle(IPC.incomeOverridesGetAll, withBudgetGuard(services, () =>
    ipcData(IPC.incomeOverridesGetAll, () => ready().budgetManager.getIncomeOverrides())
  ));

  ipcMain.handle(IPC.incomeOverridesSet, withBudgetGuard(services, (_, incomeId: string, paycheckDate: string, amount: number) =>
    ipcData(IPC.incomeOverridesSet, () =>
      ready().budgetManager.setIncomeOverride(incomeId, paycheckDate, amount)
    )
  ));

  ipcMain.handle(IPC.incomeOverridesRemove, withBudgetGuard(services, (_, incomeId: string, paycheckDate: string) =>
    ipcData(IPC.incomeOverridesRemove, () =>
      ready().budgetManager.removeIncomeOverride(incomeId, paycheckDate)
    )
  ));

  // Savings Goals Management (via BudgetManager)
  ipcMain.handle(IPC.goalsGetAll, withBudgetGuard(services, () =>
    ipcData(IPC.goalsGetAll, () => ready().budgetManager.getAllGoals())
  ));

  ipcMain.handle(IPC.goalsCreate, withBudgetGuard(services, (_, input: {
    name: string;
    targetAmount: number;
    targetDate: string;
    alreadySaved?: number;
    priority?: number;
  }) => ipcData(IPC.goalsCreate, () => ready().budgetManager.createGoal(input))));

  ipcMain.handle(IPC.goalsUpdate, withBudgetGuard(services, async (_, id: string, input: {
    name?: string;
    targetAmount?: number;
    targetDate?: string;
    alreadySaved?: number;
    priority?: number;
  }) => {
    const result = await ipcData(IPC.goalsUpdate, () => ready().budgetManager.updateGoal(id, input));
    if (result.success && !result.data) {
      return { success: false, error: 'Goal not found' };
    }
    return result;
  }));

  ipcMain.handle(IPC.goalsDelete, withBudgetGuard(services, async (_, id: string) => {
    const result = await ipcVoid(IPC.goalsDelete, () => {
      const deleted = ready().budgetManager.deleteGoal(id);
      if (!deleted) {
        throw new Error('Goal not found');
      }
    });
    return result;
  }));

  ipcMain.handle(IPC.scheduleBuild, withBudgetGuard(services, async (event, startDate: string, months: number, startingBalance: number, overlay?: DraftOverlayInput) => {
    const buildArgs = validateScheduleBuildArgs(startDate, months, startingBalance);
    if (!buildArgs.valid) {
      return { success: false, error: buildArgs.errors.join(', ') };
    }

    const { budgetManager, database } = ready();
    const resolved = resolveScheduleInputs(budgetManager, database, overlay);
    const effectiveStartingBalance = overlay ? startingBalance : resolved.startingBalance;

    const { skippedSet, manualAssignments, preferredAssignments, incomeOverridesMap: incomeOverridesMapOpt } =
      buildScheduleMaps(resolved);

    return runOffloadedCompute(
      services,
      'schedule',
      {
        incomes: resolved.incomes,
        bills: resolved.bills,
        startDate,
        months,
        startingBalance: effectiveStartingBalance,
        skippedBills: skippedSet,
        manualAssignments,
        preferredAssignments,
        targetCashOnHand: resolved.targetCashOnHand,
        goals: resolved.goals,
        minCashOnHand: resolved.minCashOnHand,
        minSavingsPerPaycheck: resolved.minSavingsPerPaycheck,
        debts: resolved.debts,
        accelerateDebtPayoff: resolved.accelerateDebtPayoff,
        incomeOverrides: incomeOverridesMapOpt,
        leaves: resolved.leaves,
        nowIso: new Date().toISOString(),
      },
      (message) => {
        if (message.op !== 'schedule') {
          throw new Error('Unexpected compute op for schedule');
        }
        return message.schedule as ScheduleData;
      },
      (progress) => {
        const sender = event.sender;
        if (typeof sender.isDestroyed === 'function' && sender.isDestroyed()) {
          return;
        }
        if (!services.auth.getIsUnlocked()) {
          return;
        }
        if (typeof sender.send !== 'function') {
          return;
        }
        sender.send(IPC.scheduleProgress, progress);
      }
    );
  }));
  ipcMain.handle(IPC.exportToPdf, withBudgetGuard(services, async (_, schedule, filePath: string) => {
    if (!validateExportPath(filePath)) {
      return { success: false, error: 'Invalid export path' };
    }
    try {
      const currency = ready().database.getSettings().currency || DEFAULT_CURRENCY;
      return await services.pdf.generatePdf(schedule, filePath, currency);
    } catch (error) {
      ipcLogger.error(`${IPC.exportToPdf} failed:`, error);
      return { success: false, error: getErrorMessage(error) };
    }
  }));

  ipcMain.handle(IPC.exportToHtml, withBudgetGuard(services, async (_, schedule, filePath: string) => {
    if (!validateExportPath(filePath)) {
      return { success: false, error: 'Invalid export path' };
    }
    try {
      const currency = ready().database.getSettings().currency || DEFAULT_CURRENCY;
      return await services.pdf.generateHtmlFile(schedule, filePath, currency);
    } catch (error) {
      ipcLogger.error(`${IPC.exportToHtml} failed:`, error);
      return { success: false, error: getErrorMessage(error) };
    }
  }));

  ipcMain.handle(IPC.exportToSpreadsheet, withBudgetGuard(services, async (_, schedule, filePath: string) => {
    if (!validateExportPath(filePath)) {
      return { success: false, error: 'Invalid export path' };
    }
    try {
      const currency = ready().database.getSettings().currency || DEFAULT_CURRENCY;
      return await services.spreadsheet.generateXlsx(schedule, filePath, currency);
    } catch (error) {
      ipcLogger.error(`${IPC.exportToSpreadsheet} failed:`, error);
      return { success: false, error: getErrorMessage(error) };
    }
  }));

  ipcMain.handle(IPC.settingsGet, withBudgetGuard(services, () =>
    ipcData(IPC.settingsGet, () => ready().database.getSettings())
  ));

  ipcMain.handle(IPC.settingsUpdate, withBudgetGuard(services, (_, settings) =>
    ipcData(IPC.settingsUpdate, () => {
      const updated = ready().database.updateSettings(settings);
      if (settings && typeof settings === 'object' && 'autoLockMinutes' in settings && typeof settings.autoLockMinutes === 'number') {
        services.auth.setAutoLock(settings.autoLockMinutes);
      }
      return updated;
    })
  ));

  // Debt Management
  ipcMain.handle(IPC.debtsGetAll, withBudgetGuard(services, async (): Promise<ApiResult<import('@shared/types').Debt[]>> => {
    const { budgetManager } = ready();
    const state = budgetManager.getCurrentState();
    if (!state.budgetId) {
      return { success: false, error: 'No budget selected' };
    }
    return ipcData(IPC.debtsGetAll, () => budgetManager.getDebts());
  }));

  ipcMain.handle(IPC.debtsGetByBill, withBudgetGuard(services, async (_, billId: string): Promise<ApiResult<import('@shared/types').Debt | null>> => {
    const { budgetManager } = ready();
    const state = budgetManager.getCurrentState();
    if (!state.budgetId) {
      return { success: false, error: 'No budget selected' };
    }
    return ipcData(IPC.debtsGetByBill, () => budgetManager.getDebtByBillId(billId));
  }));

  ipcMain.handle(IPC.debtsCreate, withBudgetGuard(services, async (_, input: DebtInput): Promise<ApiResult<import('@shared/types').Debt>> => {
    const { budgetManager } = ready();
    const state = budgetManager.getCurrentState();
    if (!state.budgetId) {
      return { success: false, error: 'No budget selected' };
    }
    return ipcData(IPC.debtsCreate, () => budgetManager.createDebt(input));
  }));

  ipcMain.handle(IPC.debtsUpdate, withBudgetGuard(services, async (_, id: string, input: Partial<DebtInput>) => {
    const { budgetManager } = ready();
    const state = budgetManager.getCurrentState();
    if (!state.budgetId) {
      return { success: false, error: 'No budget selected' };
    }
    const result = await ipcData(IPC.debtsUpdate, () => budgetManager.updateDebt(id, input));
    if (result.success && !result.data) {
      return { success: false, error: 'Debt not found' };
    }
    return result;
  }));

  ipcMain.handle(IPC.debtsDelete, withBudgetGuard(services, async (_, id: string) => {
    const { budgetManager } = ready();
    const state = budgetManager.getCurrentState();
    if (!state.budgetId) {
      return { success: false, error: 'No budget selected' };
    }
    return ipcVoid(IPC.debtsDelete, () => {
      const deleted = budgetManager.deleteDebt(id);
      if (!deleted) {
        throw new Error('Debt not found');
      }
    });
  }));

  ipcMain.handle(IPC.debtsGetAmortization, withBudgetGuard(services, async (_, debtId: string) => {
    const { budgetManager } = ready();
    const state = budgetManager.getCurrentState();
    if (!state.budgetId) {
      return { success: false, error: 'No budget selected' };
    }

    const debt = budgetManager.getDebtById(debtId);
    if (!debt) {
      return { success: false, error: 'Debt not found' };
    }

    return ipcData(IPC.debtsGetAmortization, () => {
      const bills = budgetManager.getAllBills();
      const linkedBill = bills.find((b) => b.id === debt.billId);
      const extra = linkedBill ? extraMonthlyDollars(linkedBill.budgetedAmount, debt.monthlyPayment) : 0;
      const startDate = new Date(`${budgetManager.getScheduleStartDate()}T00:00:00`);
      return services.debt.calculateAmortization(
        debt.principalBalance,
        debt.apr,
        debt.monthlyPayment,
        extra,
        extra > 0 ? 'monthly' : 'none',
        startDate,
        linkedBill?.dueDay
      );
    });
  }));

  ipcMain.handle(IPC.debtsGetAllWithAmortization, withBudgetGuard(services, async (_, overlay?: DraftOverlayInput): Promise<ApiResult<Array<{ debt: import('@shared/types').Debt; bill: import('@shared/types').Bill | null; amortization: ReturnType<DebtService['calculateAmortization']> }>>> => {
    const { budgetManager, database } = ready();
    const state = budgetManager.getCurrentState();
    if (!state.budgetId && !overlay?.debts) {
      return { success: false, error: 'No budget selected' };
    }

    return ipcData(IPC.debtsGetAllWithAmortization, () => {
      const resolved = resolveScheduleInputs(budgetManager, database, overlay);
      return resolved.debts.map((debt) => {
        const linkedBill = resolved.bills.find((b) => b.id === debt.billId);
        const extra = linkedBill ? extraMonthlyDollars(linkedBill.budgetedAmount, debt.monthlyPayment) : 0;
        const startDate = new Date(`${resolved.scheduleStartDate}T00:00:00`);
        const amortization = services.debt.calculateAmortization(
          debt.principalBalance,
          debt.apr,
          debt.monthlyPayment,
          extra,
          extra > 0 ? 'monthly' : 'none',
          startDate,
          linkedBill?.dueDay
        );
        return { debt, bill: linkedBill || null, amortization };
      });
    });
  }));

  // Leave Management
  ipcMain.handle(IPC.leavesGetAll, withBudgetGuard(services, async (): Promise<ApiResult<import('@shared/types').Leave[]>> => {
    const { budgetManager } = ready();
    const state = budgetManager.getCurrentState();
    if (!state.budgetId) {
      return { success: false, error: 'No budget selected' };
    }
    return ipcData(IPC.leavesGetAll, () => budgetManager.getLeaves());
  }));

  ipcMain.handle(IPC.leavesCreate, withBudgetGuard(services, async (_, input: LeaveInput): Promise<ApiResult<import('@shared/types').Leave>> => {
    const { budgetManager } = ready();
    const state = budgetManager.getCurrentState();
    if (!state.budgetId) {
      return { success: false, error: 'No budget selected' };
    }
    return ipcData(IPC.leavesCreate, () => budgetManager.createLeave(input));
  }));

  ipcMain.handle(IPC.leavesUpdate, withBudgetGuard(services, async (_, id: string, input: LeaveInput) => {
    const { budgetManager } = ready();
    const state = budgetManager.getCurrentState();
    if (!state.budgetId) {
      return { success: false, error: 'No budget selected' };
    }
    const result = await ipcData(IPC.leavesUpdate, () => budgetManager.updateLeave(id, input));
    if (result.success && !result.data) {
      return { success: false, error: 'Leave not found' };
    }
    return result;
  }));

  ipcMain.handle(IPC.leavesDelete, withBudgetGuard(services, async (_, id: string) => {
    const { budgetManager } = ready();
    const state = budgetManager.getCurrentState();
    if (!state.budgetId) {
      return { success: false, error: 'No budget selected' };
    }
    return ipcVoid(IPC.leavesDelete, () => {
      const deleted = budgetManager.deleteLeave(id);
      if (!deleted) {
        throw new Error('Leave not found');
      }
    });
  }));

  // Diagnostics (unlock-free; hostile-hardened in diagnostics.service)
  ipcMain.handle(IPC.diagnosticsReport, (_event, input: unknown) => {
    if (!input || typeof input !== 'object') {
      return { success: false, error: 'Invalid diagnostics report' };
    }
    const body = input as Record<string, unknown>;
    const reported = diagnostics.report({
      source: typeof body.source === 'string' ? body.source : '',
      level: body.level === 'warn' ? 'warn' : 'error',
      message: typeof body.message === 'string' ? body.message : undefined,
      stack: typeof body.stack === 'string' ? body.stack : body.stack === null ? null : undefined,
      componentStack:
        typeof body.componentStack === 'string'
          ? body.componentStack
          : body.componentStack === null
            ? null
            : undefined,
      errorCode:
        typeof body.errorCode === 'string'
          ? body.errorCode
          : body.errorCode === null
            ? null
            : undefined,
      diagnostics:
        body.diagnostics && typeof body.diagnostics === 'object' && !Array.isArray(body.diagnostics)
          ? (body.diagnostics as Record<string, unknown>)
          : undefined,
    });
    if (!reported.success) {
      return { success: false, error: reported.error };
    }
    return { success: true, data: { id: reported.id } };
  });

  ipcMain.handle(
    IPC.diagnosticsGetEvent,
    withUnlockGuard(services, (_event, eventId: unknown) => {
      const result = diagnostics.getEventBundle(typeof eventId === 'string' ? eventId : '');
      if (!result.success) {
        return { success: false, error: result.error };
      }
      return { success: true, data: result.data };
    })
  );

  ipcMain.handle(
    IPC.diagnosticsGetBundle,
    withUnlockGuard(services, (_event, limit?: unknown) => {
      const result = diagnostics.getBundle(limit);
      if (!result.success) {
        return { success: false, error: result.error };
      }
      return { success: true, data: result.data };
    })
  );

  ipcMain.handle(
    IPC.diagnosticsExport,
    withUnlockGuard(services, (_event, filePath: unknown, limit?: unknown) => {
      if (typeof filePath !== 'string' || !validateExportPath(filePath)) {
        return { success: false, error: 'Invalid export path' };
      }
      const result = diagnostics.exportBundle(filePath, limit);
      if (!result.success) {
        return { success: false, error: result.error };
      }
      return { success: true };
    })
  );
}
