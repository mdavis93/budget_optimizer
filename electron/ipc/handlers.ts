import { IpcMain } from 'electron';
import { AuthService } from '../services/auth.service';
import { CryptoService } from '../services/crypto.service';
import { DatabaseService } from '../services/database.service';
import { SchedulerService } from '../services/scheduler.service';
import { PdfService } from '../services/pdf.service';
import { GoogleService } from '../services/google.service';
import { BudgetManager } from '../services/budget-manager.service';

interface Services {
  auth: AuthService;
  crypto: CryptoService;
  database: DatabaseService | null;
  budgetManager: BudgetManager | null;
  scheduler: SchedulerService;
  pdf: PdfService;
  google: GoogleService;
}

export function registerIpcHandlers(ipcMain: IpcMain, services: Services): void {
  ipcMain.handle('auth:is-first-time-setup', () => {
    return services.auth.isFirstTimeSetup();
  });

  ipcMain.handle('auth:create-master-password', async (_, password: string) => {
    const result = await services.auth.createMasterPassword(password);
    if (result.success) {
      services.database = new DatabaseService(services.auth.getCryptoService());
      services.database.initialize();
      services.budgetManager = new BudgetManager(services.database);
    }
    return result;
  });

  ipcMain.handle('auth:unlock', async (_, password: string) => {
    const result = await services.auth.unlock(password);
    if (result.success) {
      services.database = new DatabaseService(services.auth.getCryptoService());
      services.database.initialize();
      services.budgetManager = new BudgetManager(services.database);
    }
    return result;
  });

  ipcMain.handle('auth:unlock-with-biometric', async () => {
    const result = await services.auth.unlockWithBiometric();
    if (result.success) {
      services.database = new DatabaseService(services.auth.getCryptoService());
      services.database.initialize();
      services.budgetManager = new BudgetManager(services.database);
    }
    return result;
  });

  ipcMain.handle('auth:lock', () => {
    services.auth.lock();
    if (services.budgetManager) {
      services.budgetManager = null;
    }
    if (services.database) {
      services.database.close();
      services.database = null;
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

  ipcMain.handle('auth:change-password', async (_, oldPassword: string, newPassword: string) => {
    return services.auth.changePassword(oldPassword, newPassword);
  });

  ipcMain.handle('auth:get-pending-recovery-key', () => {
    return services.auth.getPendingRecoveryKey();
  });

  ipcMain.handle('auth:clear-pending-recovery-key', () => {
    services.auth.clearPendingRecoveryKey();
  });

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

  // Budget Management
  ipcMain.handle('budget:get-all', () => {
    if (!services.budgetManager) {
      return { success: false, error: 'Not initialized' };
    }
    try {
      const data = services.budgetManager.getAllBudgets();
      return { success: true, data };
    } catch (error) {
      return { success: false, error: 'Failed to get budgets' };
    }
  });

  ipcMain.handle('budget:get-current', () => {
    if (!services.budgetManager) {
      return { success: false, error: 'Not initialized' };
    }
    try {
      const state = services.budgetManager.getCurrentState();
      const budget = state.budgetId ? services.budgetManager.getBudgetById(state.budgetId) : null;
      return { 
        success: true, 
        data: { 
          budget, 
          isQuickBudget: state.isQuickBudget 
        } 
      };
    } catch (error) {
      return { success: false, error: 'Failed to get current budget' };
    }
  });

  ipcMain.handle('budget:get-stats', (_, budgetId: string) => {
    if (!services.budgetManager) {
      return { success: false, error: 'Not initialized' };
    }
    try {
      const data = services.budgetManager.getBudgetStats(budgetId);
      return { success: true, data };
    } catch (error) {
      return { success: false, error: 'Failed to get budget stats' };
    }
  });

  ipcMain.handle('budget:create', (_, input: { name: string; startingBalance?: number }) => {
    if (!services.budgetManager) {
      return { success: false, error: 'Not initialized' };
    }
    try {
      const data = services.budgetManager.createBudget(input);
      return { success: true, data };
    } catch (error) {
      return { success: false, error: 'Failed to create budget' };
    }
  });

  ipcMain.handle('budget:update', (_, id: string, input: { name?: string; startingBalance?: number }) => {
    if (!services.budgetManager) {
      return { success: false, error: 'Not initialized' };
    }
    try {
      const data = services.budgetManager.updateBudget(id, input);
      if (!data) {
        return { success: false, error: 'Budget not found' };
      }
      return { success: true, data };
    } catch (error) {
      return { success: false, error: 'Failed to update budget' };
    }
  });

  ipcMain.handle('budget:delete', (_, id: string) => {
    if (!services.budgetManager) {
      return { success: false, error: 'Not initialized' };
    }
    try {
      const deleted = services.budgetManager.deleteBudget(id);
      if (!deleted) {
        return { success: false, error: 'Cannot delete budget (may be current budget)' };
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: 'Failed to delete budget' };
    }
  });

  ipcMain.handle('budget:switch', (_, id: string) => {
    if (!services.budgetManager) {
      return { success: false, error: 'Not initialized' };
    }
    try {
      const data = services.budgetManager.setCurrentBudget(id);
      if (!data) {
        return { success: false, error: 'Budget not found' };
      }
      return { success: true, data };
    } catch (error) {
      return { success: false, error: 'Failed to switch budget' };
    }
  });

  ipcMain.handle('budget:start-quick', () => {
    if (!services.budgetManager) {
      return { success: false, error: 'Not initialized' };
    }
    try {
      services.budgetManager.startQuickBudget();
      return { success: true };
    } catch (error) {
      return { success: false, error: 'Failed to start quick budget' };
    }
  });

  ipcMain.handle('budget:end-quick', () => {
    if (!services.budgetManager) {
      return { success: false, error: 'Not initialized' };
    }
    try {
      services.budgetManager.endQuickBudget();
      return { success: true };
    } catch (error) {
      return { success: false, error: 'Failed to end quick budget' };
    }
  });

  // Income Management (via BudgetManager)
  ipcMain.handle('income:get-all', () => {
    if (!services.budgetManager) {
      return { success: false, error: 'Not initialized' };
    }
    try {
      const data = services.budgetManager.getAllIncomes();
      return { success: true, data };
    } catch (error) {
      return { success: false, error: 'Failed to get incomes' };
    }
  });

  ipcMain.handle('income:create', (_, income) => {
    if (!services.budgetManager) {
      return { success: false, error: 'Not initialized' };
    }
    try {
      const data = services.budgetManager.createIncome(income);
      return { success: true, data };
    } catch (error) {
      return { success: false, error: 'Failed to create income' };
    }
  });

  ipcMain.handle('income:update', (_, id: string, income) => {
    if (!services.budgetManager) {
      return { success: false, error: 'Not initialized' };
    }
    try {
      const data = services.budgetManager.updateIncome(id, income);
      if (!data) {
        return { success: false, error: 'Income not found' };
      }
      return { success: true, data };
    } catch (error) {
      return { success: false, error: 'Failed to update income' };
    }
  });

  ipcMain.handle('income:delete', (_, id: string) => {
    if (!services.budgetManager) {
      return { success: false, error: 'Not initialized' };
    }
    try {
      const deleted = services.budgetManager.deleteIncome(id);
      if (!deleted) {
        return { success: false, error: 'Income not found' };
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: 'Failed to delete income' };
    }
  });

  // Bills Management (via BudgetManager)
  ipcMain.handle('bills:get-all', () => {
    if (!services.budgetManager) {
      return { success: false, error: 'Not initialized' };
    }
    try {
      const data = services.budgetManager.getAllBills();
      return { success: true, data };
    } catch (error) {
      return { success: false, error: 'Failed to get bills' };
    }
  });

  ipcMain.handle('bills:create', (_, bill) => {
    if (!services.budgetManager) {
      return { success: false, error: 'Not initialized' };
    }
    try {
      const data = services.budgetManager.createBill(bill);
      return { success: true, data };
    } catch (error) {
      return { success: false, error: 'Failed to create bill' };
    }
  });

  ipcMain.handle('bills:update', (_, id: string, bill) => {
    if (!services.budgetManager) {
      return { success: false, error: 'Not initialized' };
    }
    try {
      const data = services.budgetManager.updateBill(id, bill);
      if (!data) {
        return { success: false, error: 'Bill not found' };
      }
      return { success: true, data };
    } catch (error) {
      return { success: false, error: 'Failed to update bill' };
    }
  });

  ipcMain.handle('bills:delete', (_, id: string) => {
    if (!services.budgetManager) {
      return { success: false, error: 'Not initialized' };
    }
    try {
      const deleted = services.budgetManager.deleteBill(id);
      if (!deleted) {
        return { success: false, error: 'Bill not found' };
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: 'Failed to delete bill' };
    }
  });

  // Skipped Bills (via BudgetManager)
  ipcMain.handle('skipped-bills:get-all', () => {
    if (!services.budgetManager) {
      return { success: false, error: 'Not initialized' };
    }
    try {
      const data = services.budgetManager.getSkippedBills();
      return { success: true, data };
    } catch (error) {
      return { success: false, error: 'Failed to get skipped bills' };
    }
  });

  ipcMain.handle('skipped-bills:skip', (_, billId: string, skipDate: string) => {
    if (!services.budgetManager) {
      return { success: false, error: 'Not initialized' };
    }
    try {
      const data = services.budgetManager.skipBill(billId, skipDate);
      return { success: true, data };
    } catch (error) {
      return { success: false, error: 'Failed to skip bill' };
    }
  });

  ipcMain.handle('skipped-bills:unskip', (_, billId: string, skipDate: string) => {
    if (!services.budgetManager) {
      return { success: false, error: 'Not initialized' };
    }
    try {
      const success = services.budgetManager.unskipBill(billId, skipDate);
      return { success };
    } catch (error) {
      return { success: false, error: 'Failed to unskip bill' };
    }
  });

  ipcMain.handle('skipped-bills:is-skipped', (_, billId: string, skipDate: string) => {
    if (!services.budgetManager) {
      return { success: false, error: 'Not initialized' };
    }
    try {
      const isSkipped = services.budgetManager.isSkipped(billId, skipDate);
      return { success: true, data: isSkipped };
    } catch (error) {
      return { success: false, error: 'Failed to check skip status' };
    }
  });

  // Bill Assignments (via BudgetManager)
  ipcMain.handle('bill-assignments:get-all', () => {
    if (!services.budgetManager) {
      return { success: false, error: 'Not initialized' };
    }
    try {
      const data = services.budgetManager.getBillAssignments();
      return { success: true, data };
    } catch (error) {
      return { success: false, error: 'Failed to get bill assignments' };
    }
  });

  ipcMain.handle('bill-assignments:assign', (_, billId: string, billDueDate: string, paycheckDate: string) => {
    if (!services.budgetManager) {
      return { success: false, error: 'Not initialized' };
    }
    try {
      const data = services.budgetManager.assignBillToPaycheck(billId, billDueDate, paycheckDate);
      return { success: true, data };
    } catch (error) {
      return { success: false, error: 'Failed to assign bill' };
    }
  });

  ipcMain.handle('bill-assignments:remove', (_, billId: string, billDueDate: string) => {
    if (!services.budgetManager) {
      return { success: false, error: 'Not initialized' };
    }
    try {
      const success = services.budgetManager.removeBillAssignment(billId, billDueDate);
      return { success };
    } catch (error) {
      return { success: false, error: 'Failed to remove bill assignment' };
    }
  });

  // Savings Goals Management (via BudgetManager)
  ipcMain.handle('goals:get-all', () => {
    if (!services.budgetManager) {
      return { success: false, error: 'Not initialized' };
    }
    try {
      const data = services.budgetManager.getAllGoals();
      return { success: true, data };
    } catch (error) {
      return { success: false, error: 'Failed to get goals' };
    }
  });

  ipcMain.handle('goals:create', (_, input: { 
    name: string; 
    targetAmount: number; 
    targetDate: string;
    alreadySaved?: number;
    priority?: number;
  }) => {
    if (!services.budgetManager) {
      return { success: false, error: 'Not initialized' };
    }
    try {
      const data = services.budgetManager.createGoal(input);
      return { success: true, data };
    } catch (error) {
      return { success: false, error: 'Failed to create goal' };
    }
  });

  ipcMain.handle('goals:update', (_, id: string, input: { 
    name?: string; 
    targetAmount?: number; 
    targetDate?: string;
    alreadySaved?: number;
    priority?: number;
  }) => {
    if (!services.budgetManager) {
      return { success: false, error: 'Not initialized' };
    }
    try {
      const data = services.budgetManager.updateGoal(id, input);
      if (!data) {
        return { success: false, error: 'Goal not found' };
      }
      return { success: true, data };
    } catch (error) {
      return { success: false, error: 'Failed to update goal' };
    }
  });

  ipcMain.handle('goals:delete', (_, id: string) => {
    if (!services.budgetManager) {
      return { success: false, error: 'Not initialized' };
    }
    try {
      const deleted = services.budgetManager.deleteGoal(id);
      if (!deleted) {
        return { success: false, error: 'Goal not found' };
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: 'Failed to delete goal' };
    }
  });

  // Schedule Generation (via BudgetManager)
  ipcMain.handle('schedule:generate', (_, startDate: string, months: number) => {
    if (!services.budgetManager) {
      return { success: false, error: 'Not initialized' };
    }
    try {
      const incomes = services.budgetManager.getAllIncomes();
      const bills = services.budgetManager.getAllBills();
      const goals = services.budgetManager.getAllGoals();
      const startingBalance = services.budgetManager.getStartingBalance();
      const targetCashOnHand = services.budgetManager.getTargetCashOnHand();
      const minCashOnHand = services.budgetManager.getMinCashOnHand();
      const skippedBills = services.budgetManager.getSkippedBills();
      const billAssignments = services.budgetManager.getBillAssignments();
      
      // Create a Set of skipped bill keys for fast lookup
      const skippedSet = new Set(
        skippedBills.map(sb => `${sb.billId}-${sb.skipDate}`)
      );
      
      // Create a Map of manual assignments (billId + billDueDate -> paycheckDate)
      const manualAssignments = new Map(
        billAssignments.map(a => [`${a.billId}-${a.billDueDate}`, a.paycheckDate])
      );
      
      const data = services.scheduler.generateSchedule(
        incomes, 
        bills, 
        startDate, 
        months, 
        startingBalance,
        skippedSet,
        manualAssignments,
        targetCashOnHand,
        goals,
        minCashOnHand
      );
      
      // FINAL DEDUPLICATION - nuclear option
      if (data.paychecks) {
        for (const paycheck of data.paychecks) {
          const seen = new Set<string>();
          paycheck.bills = paycheck.bills.filter(bill => {
            // Use creditorName + dueDay as unique key per paycheck
            const key = `${bill.creditorName}-${bill.dueDay}`;
            if (seen.has(key)) {
              return false;
            }
            seen.add(key);
            return true;
          });
          // Recalculate totals
          paycheck.totalBills = paycheck.bills.reduce((sum, b) => sum + b.amount, 0);
          const grossRemaining = paycheck.totalIncome - paycheck.totalBills - paycheck.totalGoalDeposits;
          paycheck.budgetRemaining = grossRemaining > targetCashOnHand 
            ? targetCashOnHand 
            : grossRemaining;
          if (grossRemaining > targetCashOnHand) {
            paycheck.savingsDeposit = grossRemaining - targetCashOnHand;
          }
          paycheck.isShortfall = paycheck.budgetRemaining < 0;
        }
      }
      
      // Analyze for shortfalls and generate fix proposals
      const reconciliation = services.scheduler.analyzeAndProposeFixes(data);
      data.reconciliation = reconciliation;
      
      return { success: true, data };
    } catch (error) {
      return { success: false, error: 'Failed to generate schedule' };
    }
  });

  ipcMain.handle('schedule:optimize', (_, startDate: string, months: number, startingBalance: number) => {
    if (!services.budgetManager) {
      return { success: false, error: 'Not initialized' };
    }
    try {
      const incomes = services.budgetManager.getAllIncomes();
      const bills = services.budgetManager.getAllBills();
      const goals = services.budgetManager.getAllGoals();
      const targetCashOnHand = services.budgetManager.getTargetCashOnHand();
      const minCashOnHand = services.budgetManager.getMinCashOnHand();
      const skippedBills = services.budgetManager.getSkippedBills();
      const billAssignments = services.budgetManager.getBillAssignments();
      
      // Create a Set of skipped bill keys for fast lookup
      const skippedSet = new Set(
        skippedBills.map(sb => `${sb.billId}-${sb.skipDate}`)
      );
      
      // Create a Map of manual assignments (billId + billDueDate -> paycheckDate)
      const manualAssignments = new Map(
        billAssignments.map(a => [`${a.billId}-${a.billDueDate}`, a.paycheckDate])
      );
      
      const data = services.scheduler.generateSchedule(
        incomes, 
        bills, 
        startDate, 
        months, 
        startingBalance,
        skippedSet,
        manualAssignments,
        targetCashOnHand,
        goals,
        minCashOnHand
      );
      return { success: true, data };
    } catch (error) {
      return { success: false, error: 'Failed to optimize schedule' };
    }
  });

  ipcMain.handle('export:to-pdf', async (_, schedule, filePath: string) => {
    try {
      return await services.pdf.generatePdf(schedule, filePath);
    } catch (error) {
      return { success: false, error: 'Failed to export PDF' };
    }
  });

  ipcMain.handle('export:google-auth-url', () => {
    return services.google.getAuthUrl();
  });

  ipcMain.handle('export:google-auth-callback', async (_, code: string) => {
    return services.google.handleAuthCallback(code);
  });

  ipcMain.handle('export:is-google-authed', () => {
    return services.google.isAuthenticated();
  });

  ipcMain.handle('export:to-google-sheets', async (_, schedule) => {
    return services.google.exportToSheets(schedule);
  });

  // Reconciliation handlers
  ipcMain.handle('reconciliation:apply-fixes', (_, fixes: Array<{
    id: string;
    type: 'move_bill' | 'skip_bill';
    billId: string;
    billDueDate: string;
    fromPaycheckDate: string;
    toPaycheckDate?: string;
  }>) => {
    if (!services.budgetManager) {
      return { success: false, error: 'Not initialized' };
    }
    try {
      for (const fix of fixes) {
        if (fix.type === 'move_bill' && fix.toPaycheckDate) {
          // Create a bill assignment to move the bill to a different paycheck
          services.budgetManager.assignBillToPaycheck(
            fix.billId,
            fix.billDueDate,
            fix.toPaycheckDate
          );
        } else if (fix.type === 'skip_bill') {
          // Skip the bill for this date
          services.budgetManager.skipBill(fix.billId, fix.fromPaycheckDate);
        }
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: 'Failed to apply fixes' };
    }
  });

  ipcMain.handle('settings:get', () => {
    if (!services.database) {
      return { success: false, error: 'Database not initialized' };
    }
    try {
      const data = services.database.getSettings();
      return { success: true, data };
    } catch (error) {
      return { success: false, error: 'Failed to get settings' };
    }
  });

  ipcMain.handle('settings:update', (_, settings) => {
    if (!services.database) {
      return { success: false, error: 'Database not initialized' };
    }
    try {
      const data = services.database.updateSettings(settings);
      return { success: true, data };
    } catch (error) {
      return { success: false, error: 'Failed to update settings' };
    }
  });
}
