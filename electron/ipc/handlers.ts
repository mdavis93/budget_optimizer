import { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron';
import { AuthService } from '../services/auth.service';
import { CryptoService } from '../services/crypto.service';
import { DatabaseService, DebtInput } from '../services/database.service';
import { SchedulerService, DebtPayoffInfo, SCHEDULE_CALCULATION_MONTHS } from '../services/scheduler.service';
import { PdfService } from '../services/pdf.service';
import { SpreadsheetService } from '../services/spreadsheet.service';
import { BudgetManager } from '../services/budget-manager.service';
import { DebtService } from '../services/debt.service';
import { ipcLogger } from '../services/logger.service';
import { DraftOverlayInput, resolveScheduleInputs } from '../services/draft-overlay.service';
import { CredentialsService } from '../services/credentials.service';
import { resolveAppBrowserWindow } from '../utils/dialog';
import {
  withUnlockGuard,
  withBudgetGuard,
  ipcData,
  ipcVoid,
  asReadyServices,
} from './guards';
import { clearApprovedExportPaths, validateExportPath } from '../utils/exportPaths';
import {
  assertValid,
  validateReconciliationFixes,
  ReconciliationFixInput,
} from '../services/validation.service';

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

interface ScheduleMaps {
  skippedSet: Set<string>;
  manualAssignments: Map<string, string>;
  incomeOverridesMap: Map<string, number>;
  debtPayoffs: Map<string, DebtPayoffInfo>;
}

function buildScheduleMaps(
  resolved: ReturnType<typeof resolveScheduleInputs>,
  debtService: DebtService
): ScheduleMaps {
  return {
    skippedSet: new Set(
      resolved.skippedBills.map((sb) => `${sb.billId}-${sb.skipDate}`)
    ),
    manualAssignments: new Map(
      resolved.billAssignments.map((a) => [`${a.billId}-${a.billDueDate}`, a.paycheckDate])
    ),
    incomeOverridesMap: new Map(
      resolved.incomeOverrides.map((o) => [`${o.incomeId}-${o.paycheckDate}`, o.amount])
    ),
    debtPayoffs: buildDebtPayoffs(resolved.debts, resolved.bills, debtService),
  };
}

function buildDebtPayoffs(
  debts: ReturnType<typeof resolveScheduleInputs>['debts'],
  bills: ReturnType<typeof resolveScheduleInputs>['bills'],
  debtService: DebtService
): Map<string, DebtPayoffInfo> {
  const debtPayoffs = new Map<string, DebtPayoffInfo>();

  for (const debt of debts) {
    const linkedBill = bills.find((b) => b.id === debt.billId);
    if (linkedBill) {
      const extra = Math.max(0, linkedBill.budgetedAmount - debt.monthlyPayment);
      const amortization = debtService.calculateAmortization(
        debt.principalBalance,
        debt.apr,
        debt.monthlyPayment,
        extra,
        extra > 0 ? 'monthly' : 'none'
      );

      if (amortization.monthsToPayoff > 0) {
        const lastPayment = amortization.payments[amortization.payments.length - 1];
        debtPayoffs.set(debt.billId, {
          billId: debt.billId,
          payoffDate: new Date(amortization.payoffDate),
          finalPaymentAmount: lastPayment?.payment || linkedBill.budgetedAmount,
        });
      }
    }
  }

  return debtPayoffs;
}

interface Services {
  auth: AuthService;
  crypto: CryptoService;
  database: DatabaseService | null;
  budgetManager: BudgetManager | null;
  scheduler: SchedulerService;
  pdf: PdfService;
  spreadsheet: SpreadsheetService;
  debt: DebtService;
  credentials: CredentialsService;
}

function initializeDatabaseServices(services: Services): { success: true } | { success: false; error: string } {
  try {
    services.database = new DatabaseService(services.auth.getCryptoService());
    services.database.initialize();
    services.budgetManager = new BudgetManager(services.database);
    const settings = services.database.getSettings();
    services.auth.setAutoLock(settings.autoLockMinutes);
    return { success: true };
  } catch (error) {
    ipcLogger.error('database init failed:', error);
    services.auth.lock();
    services.database = null;
    services.budgetManager = null;
    return {
      success: false,
      error: `Failed to initialize database: ${getErrorMessage(error)}`,
    };
  }
}

export function registerIpcHandlers(ipcMain: IpcMain, services: Services): void {
  ipcMain.handle('auth:is-first-time-setup', () => {
    return services.auth.isFirstTimeSetup();
  });

  ipcMain.handle('auth:create-master-password', async (_, password: string) => {
    try {
      const result = await services.auth.createMasterPassword(password);
      if (result.success) {
        try {
          services.database = new DatabaseService(services.auth.getCryptoService());
          services.database.initialize();
          services.budgetManager = new BudgetManager(services.database);
        } catch (error) {
          ipcLogger.error('auth:create-master-password database init failed:', error);
          services.auth.revertFirstTimeSetup();
          services.database = null;
          services.budgetManager = null;
          return {
            success: false,
            error: `Failed to initialize database: ${getErrorMessage(error)}`,
          };
        }
      }
      return result;
    } catch (error) {
      ipcLogger.error('auth:create-master-password failed:', error);
      return { success: false, error: getErrorMessage(error) };
    }
  });

  ipcMain.handle('auth:unlock', async (_, password: string) => {
    const result = await services.auth.unlock(password);
    if (result.success) {
      const dbResult = initializeDatabaseServices(services);
      if (!dbResult.success) {
        return dbResult;
      }
    }
    return result;
  });

  ipcMain.handle('auth:unlock-with-biometric', async () => {
    const result = await services.auth.unlockWithBiometric();
    if (result.success) {
      const dbResult = initializeDatabaseServices(services);
      if (!dbResult.success) {
        return dbResult;
      }
    }
    return result;
  });

  ipcMain.handle('auth:lock', () => {
    try {
      services.auth.lock();
      clearApprovedExportPaths();
      if (services.budgetManager) {
        services.budgetManager = null;
      }
      if (services.database) {
        services.database.close();
        services.database = null;
      }
      return { success: true };
    } catch (error) {
      ipcLogger.error('auth:lock failed:', error);
      return { success: false, error: getErrorMessage(error) };
    }
  });

  ipcMain.handle('auth:is-unlocked', () => {
    return services.auth.getIsUnlocked();
  });

  ipcMain.handle('auth:enable-biometric', async () => {
    return services.auth.enableBiometric();
  });

  ipcMain.handle('auth:is-biometric-enabled', () => {
    return services.auth.isBiometricEnabled();
  });

  ipcMain.handle('auth:change-password', async (event: IpcMainInvokeEvent, oldPassword: string, newPassword: string) => {
    const result = await services.auth.changePassword(oldPassword, newPassword);
    if (result.success) {
      const parentWindow = resolveAppBrowserWindow(BrowserWindow.fromWebContents(event.sender));
      await services.credentials.offerSave(newPassword, parentWindow);
    }
    return result;
  });

  ipcMain.handle(
    'auth:get-pending-recovery-key',
    withUnlockGuard(services, () => services.auth.getPendingRecoveryKey())
  );

  ipcMain.handle(
    'auth:clear-pending-recovery-key',
    withUnlockGuard(services, () =>
      ipcVoid('auth:clear-pending-recovery-key', () => services.auth.clearPendingRecoveryKey())
    )
  );

  ipcMain.handle('auth:verify-recovery-key', async (_, recoveryKey: string) => {
    return services.auth.verifyRecoveryKey(recoveryKey);
  });

  ipcMain.handle('auth:reset-password-with-recovery', async (_, recoveryKey: string, newPassword: string) => {
    const result = await services.auth.resetPasswordWithRecoveryKey(recoveryKey, newPassword);
    if (result.success) {
      services.database = new DatabaseService(services.auth.getCryptoService());
      services.database.initialize();
      services.budgetManager = new BudgetManager(services.database);
    }
    return result;
  });

  ipcMain.handle('auth:set-auto-lock', (_, minutes: number) => {
    services.auth.setAutoLock(minutes);
    return { success: true };
  });

  ipcMain.handle('auth:activity-ping', () => {
    services.auth.recordActivity();
    return { success: true };
  });

  ipcMain.handle(
    'credentials:save',
    withUnlockGuard(services, (_, password: string) => services.credentials.savePassword(password))
  );

  ipcMain.handle(
    'credentials:get',
    withUnlockGuard(services, () => services.credentials.getPassword())
  );

  ipcMain.handle(
    'credentials:delete',
    withUnlockGuard(services, () => services.credentials.deletePassword())
  );

  // Intentionally unguarded: pre-unlock login probe; returns boolean only, not the password.
  ipcMain.handle('credentials:has', async () => services.credentials.hasPassword());

  ipcMain.handle(
    'credentials:offer-save',
    withUnlockGuard(services, async (event: IpcMainInvokeEvent, password: string) => {
      const parentWindow = resolveAppBrowserWindow(BrowserWindow.fromWebContents(event.sender));
      return services.credentials.offerSave(password, parentWindow);
    })
  );

  // Budget Management
  const ready = () => asReadyServices(services);

  ipcMain.handle('budget:get-all', withBudgetGuard(services, () =>
    ipcData('budget:get-all', () => ready().budgetManager.getAllBudgets())
  ));

  ipcMain.handle('budget:get-all-with-stats', withBudgetGuard(services, () =>
    ipcData('budget:get-all-with-stats', () => ready().budgetManager.getAllBudgetsWithStats())
  ));

  ipcMain.handle('budget:get-current', withBudgetGuard(services, () =>
    ipcData('budget:get-current', () => {
      const { budgetManager } = ready();
      const state = budgetManager.getCurrentState();
      const budget = state.budgetId ? budgetManager.getBudgetById(state.budgetId) : null;
      return { budget, isQuickBudget: state.isQuickBudget };
    })
  ));

  ipcMain.handle('budget:get-stats', withBudgetGuard(services, (_, budgetId: string) =>
    ipcData('budget:get-stats', () => ready().budgetManager.getBudgetStats(budgetId))
  ));

  ipcMain.handle('budget:create', withBudgetGuard(services, (_, input: { name: string; startingBalance?: number }) =>
    ipcData('budget:create', () => ready().budgetManager.createBudget(input))
  ));

  ipcMain.handle('budget:update', withBudgetGuard(services, async (_, id: string, input: { name?: string; startingBalance?: number }) => {
    const result = await ipcData('budget:update', () => ready().budgetManager.updateBudget(id, input));
    if (result.success && !result.data) {
      return { success: false, error: 'Budget not found' };
    }
    return result;
  }));

  ipcMain.handle('budget:delete', withBudgetGuard(services, async (_, id: string) => {
    const result = await ipcVoid('budget:delete', () => {
      const deleted = ready().budgetManager.deleteBudget(id);
      if (!deleted) {
        throw new Error('Cannot delete budget (may be current budget)');
      }
    });
    return result;
  }));

  ipcMain.handle('budget:switch', withBudgetGuard(services, async (_, id: string) => {
    const result = await ipcData('budget:switch', () => ready().budgetManager.setCurrentBudget(id));
    if (result.success && !result.data) {
      return { success: false, error: 'Budget not found' };
    }
    return result;
  }));

  ipcMain.handle('budget:start-quick', withBudgetGuard(services, () =>
    ipcVoid('budget:start-quick', () => { ready().budgetManager.startQuickBudget(); })
  ));

  ipcMain.handle('budget:end-quick', withBudgetGuard(services, () =>
    ipcVoid('budget:end-quick', () => { ready().budgetManager.endQuickBudget(); })
  ));

  // Income Management (via BudgetManager)
  ipcMain.handle('income:get-all', withBudgetGuard(services, () =>
    ipcData('income:get-all', () => ready().budgetManager.getAllIncomes())
  ));

  ipcMain.handle('income:create', withBudgetGuard(services, (_, income) =>
    ipcData('income:create', () => ready().budgetManager.createIncome(income))
  ));

  ipcMain.handle('income:update', withBudgetGuard(services, async (_, id: string, income) => {
    const result = await ipcData('income:update', () => ready().budgetManager.updateIncome(id, income));
    if (result.success && !result.data) {
      return { success: false, error: 'Income not found' };
    }
    return result;
  }));

  ipcMain.handle('income:delete', withBudgetGuard(services, async (_, id: string) => {
    const result = await ipcVoid('income:delete', () => {
      const deleted = ready().budgetManager.deleteIncome(id);
      if (!deleted) {
        throw new Error('Income not found');
      }
    });
    return result;
  }));

  // Bills Management (via BudgetManager)
  ipcMain.handle('bills:get-all', withBudgetGuard(services, () =>
    ipcData('bills:get-all', () => ready().budgetManager.getAllBills())
  ));

  ipcMain.handle('bills:create', withBudgetGuard(services, (_, bill) =>
    ipcData('bills:create', () => ready().budgetManager.createBill(bill))
  ));

  ipcMain.handle('bills:update', withBudgetGuard(services, async (_, id: string, bill) => {
    const result = await ipcData('bills:update', () => ready().budgetManager.updateBill(id, bill));
    if (result.success && !result.data) {
      return { success: false, error: 'Bill not found' };
    }
    return result;
  }));

  ipcMain.handle('bills:delete', withBudgetGuard(services, async (_, id: string) => {
    const result = await ipcVoid('bills:delete', () => {
      const deleted = ready().budgetManager.deleteBill(id);
      if (!deleted) {
        throw new Error('Bill not found');
      }
    });
    return result;
  }));

  // Skipped Bills (via BudgetManager)
  ipcMain.handle('skipped-bills:get-all', withBudgetGuard(services, () =>
    ipcData('skipped-bills:get-all', () => ready().budgetManager.getSkippedBills())
  ));

  ipcMain.handle('skipped-bills:skip', withBudgetGuard(services, (_, billId: string, skipDate: string) =>
    ipcData('skipped-bills:skip', () => ready().budgetManager.skipBill(billId, skipDate))
  ));

  ipcMain.handle('skipped-bills:unskip', withBudgetGuard(services, async (_, billId: string, skipDate: string) => {
    const result = await ipcData('skipped-bills:unskip', () =>
      ready().budgetManager.unskipBill(billId, skipDate)
    );
    if (!result.success) {
      return result;
    }
    return { success: result.data };
  }));

  ipcMain.handle('skipped-bills:is-skipped', withBudgetGuard(services, (_, billId: string, skipDate: string) =>
    ipcData('skipped-bills:is-skipped', () => ready().budgetManager.isSkipped(billId, skipDate))
  ));

  // Bill Assignments (via BudgetManager)
  ipcMain.handle('bill-assignments:get-all', withBudgetGuard(services, () =>
    ipcData('bill-assignments:get-all', () => ready().budgetManager.getBillAssignments())
  ));

  ipcMain.handle('bill-assignments:assign', withBudgetGuard(services, (_, billId: string, billDueDate: string, paycheckDate: string) =>
    ipcData('bill-assignments:assign', () =>
      ready().budgetManager.assignBillToPaycheck(billId, billDueDate, paycheckDate)
    )
  ));

  ipcMain.handle('bill-assignments:remove', withBudgetGuard(services, async (_, billId: string, billDueDate: string) => {
    const result = await ipcData('bill-assignments:remove', () =>
      ready().budgetManager.removeBillAssignment(billId, billDueDate)
    );
    if (!result.success) {
      return result;
    }
    return { success: result.data };
  }));

  ipcMain.handle('income-overrides:get-all', withBudgetGuard(services, () =>
    ipcData('income-overrides:get-all', () => ready().budgetManager.getIncomeOverrides())
  ));

  ipcMain.handle('income-overrides:set', withBudgetGuard(services, (_, incomeId: string, paycheckDate: string, amount: number) =>
    ipcData('income-overrides:set', () =>
      ready().budgetManager.setIncomeOverride(incomeId, paycheckDate, amount)
    )
  ));

  ipcMain.handle('income-overrides:remove', withBudgetGuard(services, (_, incomeId: string, paycheckDate: string) =>
    ipcData('income-overrides:remove', () =>
      ready().budgetManager.removeIncomeOverride(incomeId, paycheckDate)
    )
  ));

  // Savings Goals Management (via BudgetManager)
  ipcMain.handle('goals:get-all', withBudgetGuard(services, () =>
    ipcData('goals:get-all', () => ready().budgetManager.getAllGoals())
  ));

  ipcMain.handle('goals:create', withBudgetGuard(services, (_, input: {
    name: string;
    targetAmount: number;
    targetDate: string;
    alreadySaved?: number;
    priority?: number;
  }) => ipcData('goals:create', () => ready().budgetManager.createGoal(input))));

  ipcMain.handle('goals:update', withBudgetGuard(services, async (_, id: string, input: {
    name?: string;
    targetAmount?: number;
    targetDate?: string;
    alreadySaved?: number;
    priority?: number;
  }) => {
    const result = await ipcData('goals:update', () => ready().budgetManager.updateGoal(id, input));
    if (result.success && !result.data) {
      return { success: false, error: 'Goal not found' };
    }
    return result;
  }));

  ipcMain.handle('goals:delete', withBudgetGuard(services, async (_, id: string) => {
    const result = await ipcVoid('goals:delete', () => {
      const deleted = ready().budgetManager.deleteGoal(id);
      if (!deleted) {
        throw new Error('Goal not found');
      }
    });
    return result;
  }));

  ipcMain.handle('goals:get-projections', withBudgetGuard(services, (_, overlay?: DraftOverlayInput) =>
    ipcData('goals:get-projections', () => {
      const { budgetManager, database } = ready();
      const resolved = resolveScheduleInputs(budgetManager, database, overlay);
      if (resolved.goals.length === 0) {
        return [];
      }

      const { skippedSet, manualAssignments, incomeOverridesMap, debtPayoffs } = buildScheduleMaps(
        resolved,
        services.debt
      );

      const scheduleData = services.scheduler.generateSchedule(
        resolved.incomes,
        resolved.bills,
        resolved.scheduleStartDate,
        SCHEDULE_CALCULATION_MONTHS,
        resolved.startingBalance,
        skippedSet,
        manualAssignments,
        resolved.targetCashOnHand,
        resolved.goals,
        resolved.minCashOnHand,
        resolved.minSavingsPerPaycheck,
        debtPayoffs,
        incomeOverridesMap
      );

      return scheduleData.goalProjections || [];
    })
  ));

  ipcMain.handle('schedule:build', withBudgetGuard(services, (_, startDate: string, months: number, startingBalance: number, overlay?: DraftOverlayInput) =>
    ipcData('schedule:build', () => {
      const { budgetManager, database } = ready();
      const resolved = resolveScheduleInputs(budgetManager, database, overlay);
      const effectiveStartingBalance = overlay ? startingBalance : resolved.startingBalance;

      const { skippedSet, manualAssignments, incomeOverridesMap: incomeOverridesMapOpt, debtPayoffs } =
        buildScheduleMaps(resolved, services.debt);

      const data = services.scheduler.generateSchedule(
        resolved.incomes,
        resolved.bills,
        startDate,
        months,
        effectiveStartingBalance,
        skippedSet,
        manualAssignments,
        resolved.targetCashOnHand,
        resolved.goals,
        resolved.minCashOnHand,
        resolved.minSavingsPerPaycheck,
        debtPayoffs,
        incomeOverridesMapOpt
      );
      data.reconciliation = services.scheduler.analyzeAndProposeFixes(data);
      return data;
    })
  ));

  ipcMain.handle('export:to-pdf', withBudgetGuard(services, async (_, schedule, filePath: string) => {
    if (!validateExportPath(filePath)) {
      return { success: false, error: 'Invalid export path' };
    }
    try {
      return await services.pdf.generatePdf(schedule, filePath);
    } catch (error) {
      ipcLogger.error('export:to-pdf failed:', error);
      return { success: false, error: getErrorMessage(error) };
    }
  }));

  ipcMain.handle('export:to-html', withBudgetGuard(services, async (_, schedule, filePath: string) => {
    if (!validateExportPath(filePath)) {
      return { success: false, error: 'Invalid export path' };
    }
    try {
      return await services.pdf.generateHtmlFile(schedule, filePath);
    } catch (error) {
      ipcLogger.error('export:to-html failed:', error);
      return { success: false, error: getErrorMessage(error) };
    }
  }));

  ipcMain.handle('export:to-spreadsheet', withBudgetGuard(services, async (_, schedule, filePath: string) => {
    if (!validateExportPath(filePath)) {
      return { success: false, error: 'Invalid export path' };
    }
    try {
      return await services.spreadsheet.generateXlsx(schedule, filePath);
    } catch (error) {
      ipcLogger.error('export:to-spreadsheet failed:', error);
      return { success: false, error: getErrorMessage(error) };
    }
  }));

  // Reconciliation handlers
  ipcMain.handle('reconciliation:apply-fixes', withBudgetGuard(services, (_, fixes: ReconciliationFixInput[]) =>
    ipcVoid('reconciliation:apply-fixes', async () => {
    assertValid(validateReconciliationFixes(fixes), 'Invalid reconciliation fixes');
    const { budgetManager } = ready();
    for (const fix of fixes) {
      if (fix.type === 'move_bill' && fix.toPaycheckDate) {
        budgetManager.assignBillToPaycheck(fix.billId, fix.billDueDate, fix.toPaycheckDate);
      } else if (fix.type === 'skip_bill') {
        budgetManager.skipBill(fix.billId, fix.fromPaycheckDate);
      }
    }
  })));

  ipcMain.handle('settings:get', withBudgetGuard(services, () =>
    ipcData('settings:get', () => ready().database.getSettings())
  ));

  ipcMain.handle('settings:update', withBudgetGuard(services, (_, settings) =>
    ipcData('settings:update', () => ready().database.updateSettings(settings))
  ));

  // Debt Management
  ipcMain.handle('debts:get-all', withBudgetGuard(services, () => {
    const { budgetManager, database } = ready();
    const state = budgetManager.getCurrentState();
    if (!state.budgetId) {
      return Promise.resolve({ success: false as const, error: 'No budget selected' });
    }
    return ipcData('debts:get-all', () => database.getDebts(state.budgetId!));
  }));

  ipcMain.handle('debts:get-by-bill', withBudgetGuard(services, (_, billId: string) => {
    const { budgetManager, database } = ready();
    const state = budgetManager.getCurrentState();
    if (!state.budgetId) {
      return Promise.resolve({ success: false as const, error: 'No budget selected' });
    }
    return ipcData('debts:get-by-bill', () => database.getDebtByBillId(billId, state.budgetId!));
  }));

  ipcMain.handle('debts:create', withBudgetGuard(services, (_, input: DebtInput) => {
    const { budgetManager, database } = ready();
    const state = budgetManager.getCurrentState();
    if (!state.budgetId) {
      return Promise.resolve({ success: false as const, error: 'No budget selected' });
    }
    return ipcData('debts:create', () => database.createDebt(state.budgetId!, input));
  }));

  ipcMain.handle('debts:update', withBudgetGuard(services, async (_, id: string, input: Partial<DebtInput>) => {
    const { budgetManager, database } = ready();
    const state = budgetManager.getCurrentState();
    if (!state.budgetId) {
      return { success: false, error: 'No budget selected' };
    }
    const result = await ipcData('debts:update', () => database.updateDebt(id, state.budgetId!, input));
    if (result.success && !result.data) {
      return { success: false, error: 'Debt not found' };
    }
    return result;
  }));

  ipcMain.handle('debts:delete', withBudgetGuard(services, async (_, id: string) => {
    const { budgetManager, database } = ready();
    const state = budgetManager.getCurrentState();
    if (!state.budgetId) {
      return { success: false, error: 'No budget selected' };
    }
    return ipcVoid('debts:delete', () => {
      const deleted = database.deleteDebt(id, state.budgetId!);
      if (!deleted) {
        throw new Error('Debt not found');
      }
    });
  }));

  ipcMain.handle('debts:get-amortization', withBudgetGuard(services, async (_, debtId: string) => {
    const { budgetManager, database } = ready();
    const state = budgetManager.getCurrentState();
    if (!state.budgetId) {
      return { success: false, error: 'No budget selected' };
    }

    const debt = database.getDebtById(debtId, state.budgetId);
    if (!debt) {
      return { success: false, error: 'Debt not found' };
    }

    return ipcData('debts:get-amortization', () => {
      const bills = budgetManager.getAllBills();
      const linkedBill = bills.find((b) => b.id === debt.billId);
      const extra = linkedBill ? Math.max(0, linkedBill.budgetedAmount - debt.monthlyPayment) : 0;
      return services.debt.calculateAmortization(
        debt.principalBalance,
        debt.apr,
        debt.monthlyPayment,
        extra,
        extra > 0 ? 'monthly' : 'none'
      );
    });
  }));

  ipcMain.handle('debts:get-all-with-amortization', withBudgetGuard(services, (_, overlay?: DraftOverlayInput) => {
    const { budgetManager, database } = ready();
    const state = budgetManager.getCurrentState();
    if (!state.budgetId && !overlay?.debts) {
      return Promise.resolve({ success: false as const, error: 'No budget selected' });
    }

    return ipcData('debts:get-all-with-amortization', () => {
      const resolved = resolveScheduleInputs(budgetManager, database, overlay);
      return resolved.debts.map((debt) => {
        const linkedBill = resolved.bills.find((b) => b.id === debt.billId);
        const extra = linkedBill ? Math.max(0, linkedBill.budgetedAmount - debt.monthlyPayment) : 0;
        const amortization = services.debt.calculateAmortization(
          debt.principalBalance,
          debt.apr,
          debt.monthlyPayment,
          extra,
          extra > 0 ? 'monthly' : 'none'
        );
        return { debt, bill: linkedBill || null, amortization };
      });
    });
  }));
}
