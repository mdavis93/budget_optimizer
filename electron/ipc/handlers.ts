import { IpcMain } from 'electron';
import { addMonths, parseISO, isBefore } from 'date-fns';
import { AuthService } from '../services/auth.service';
import { CryptoService } from '../services/crypto.service';
import { DatabaseService, DebtInput } from '../services/database.service';
import { SchedulerService, DebtPayoffInfo } from '../services/scheduler.service';
import { PdfService } from '../services/pdf.service';
import { SpreadsheetService } from '../services/spreadsheet.service';
import { BudgetManager } from '../services/budget-manager.service';
import { DebtService } from '../services/debt.service';
import { ipcLogger } from '../services/logger.service';

// Schedule is always calculated for 12 months - viewport filtering only affects display
const SCHEDULE_CALCULATION_MONTHS = 12;

// Helper to extract error message from unknown error type
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
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
    try {
      services.auth.lock();
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

  ipcMain.handle('auth:change-password', async (_, oldPassword: string, newPassword: string) => {
    return services.auth.changePassword(oldPassword, newPassword);
  });

  ipcMain.handle('auth:get-pending-recovery-key', () => {
    return services.auth.getPendingRecoveryKey();
  });

  ipcMain.handle('auth:clear-pending-recovery-key', () => {
    try {
      services.auth.clearPendingRecoveryKey();
      return { success: true };
    } catch (error) {
      ipcLogger.error('auth:clear-pending-recovery-key failed:', error);
      return { success: false, error: getErrorMessage(error) };
    }
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
      ipcLogger.error('budget:get-all failed:', error);
      return { success: false, error: getErrorMessage(error) };
    }
  });

  ipcMain.handle('budget:get-all-with-stats', () => {
    if (!services.budgetManager) {
      return { success: false, error: 'Not initialized' };
    }
    try {
      const data = services.budgetManager.getAllBudgetsWithStats();
      return { success: true, data };
    } catch (error) {
      ipcLogger.error('budget:get-all-with-stats failed:', error);
      return { success: false, error: getErrorMessage(error) };
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
      ipcLogger.error('budget:get-current failed:', error);
      return { success: false, error: getErrorMessage(error) };
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
      ipcLogger.error('budget:get-stats failed:', error);
      return { success: false, error: getErrorMessage(error) };
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
      ipcLogger.error('budget:create failed:', error);
      return { success: false, error: getErrorMessage(error) };
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
      ipcLogger.error('budget:update failed:', error);
      return { success: false, error: getErrorMessage(error) };
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
      ipcLogger.error('budget:delete failed:', error);
      return { success: false, error: getErrorMessage(error) };
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
      ipcLogger.error('budget:switch failed:', error);
      return { success: false, error: getErrorMessage(error) };
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
      ipcLogger.error('budget:start-quick failed:', error);
      return { success: false, error: getErrorMessage(error) };
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
      ipcLogger.error('budget:end-quick failed:', error);
      return { success: false, error: getErrorMessage(error) };
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
      ipcLogger.error('income:get-all failed:', error);
      return { success: false, error: getErrorMessage(error) };
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
      ipcLogger.error('income:create failed:', error);
      return { success: false, error: getErrorMessage(error) };
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
      ipcLogger.error('income:update failed:', error);
      return { success: false, error: getErrorMessage(error) };
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
      ipcLogger.error('income:delete failed:', error);
      return { success: false, error: getErrorMessage(error) };
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
      ipcLogger.error('bills:get-all failed:', error);
      return { success: false, error: getErrorMessage(error) };
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
      ipcLogger.error('bills:create failed:', error);
      return { success: false, error: getErrorMessage(error) };
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
      ipcLogger.error('bills:update failed:', error);
      return { success: false, error: getErrorMessage(error) };
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
      ipcLogger.error('bills:delete failed:', error);
      return { success: false, error: getErrorMessage(error) };
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
      ipcLogger.error('skipped-bills:get-all failed:', error);
      return { success: false, error: getErrorMessage(error) };
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
      ipcLogger.error('skipped-bills:skip failed:', error);
      return { success: false, error: getErrorMessage(error) };
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
      ipcLogger.error('skipped-bills:unskip failed:', error);
      return { success: false, error: getErrorMessage(error) };
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
      ipcLogger.error('skipped-bills:is-skipped failed:', error);
      return { success: false, error: getErrorMessage(error) };
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
      ipcLogger.error('bill-assignments:get-all failed:', error);
      return { success: false, error: getErrorMessage(error) };
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
      ipcLogger.error('bill-assignments:assign failed:', error);
      return { success: false, error: getErrorMessage(error) };
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
      ipcLogger.error('bill-assignments:remove failed:', error);
      return { success: false, error: getErrorMessage(error) };
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
      ipcLogger.error('goals:get-all failed:', error);
      return { success: false, error: getErrorMessage(error) };
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
      ipcLogger.error('goals:create failed:', error);
      return { success: false, error: getErrorMessage(error) };
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
      ipcLogger.error('goals:update failed:', error);
      return { success: false, error: getErrorMessage(error) };
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
      ipcLogger.error('goals:delete failed:', error);
      return { success: false, error: getErrorMessage(error) };
    }
  });

  // Goal projections - uses ACTUAL 12-month scheduler allocation
  // Goals beyond 12 months are marked as isProjected with extrapolated estimates
  ipcMain.handle('goals:get-projections', () => {
    if (!services.budgetManager || !services.database) {
      return { success: false, error: 'Not initialized' };
    }
    try {
      const goals = services.budgetManager.getAllGoals();
      if (goals.length === 0) {
        return { success: true, data: [] };
      }

      const incomes = services.budgetManager.getAllIncomes();
      const bills = services.budgetManager.getAllBills();
      const startingBalance = services.budgetManager.getStartingBalance();
      const targetCashOnHand = services.budgetManager.getTargetCashOnHand();
      const minCashOnHand = services.budgetManager.getMinCashOnHand();
      const minSavingsPerPaycheck = services.budgetManager.getMinSavingsPerPaycheck();
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

      // Calculate debt payoff info for bills with linked debts
      const debtPayoffs = new Map<string, DebtPayoffInfo>();
      const state = services.budgetManager.getCurrentState();
      if (state.budgetId) {
        const debts = services.database.getDebts(state.budgetId);
        for (const debt of debts) {
          const linkedBill = bills.find(b => b.id === debt.billId);
          if (linkedBill) {
            const extra = Math.max(0, linkedBill.budgetedAmount - debt.monthlyPayment);
            const amortization = services.debt.calculateAmortization(
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
      }

      // Always use 12 months - consistent with schedule single source of truth
      // Goals beyond 12 months will be marked as isProjected with extrapolated estimates
      const today = new Date();
      const startDate = today.toISOString().split('T')[0];

      // Generate 12-month schedule for accurate goal projections
      const scheduleData = services.scheduler.generateSchedule(
        incomes,
        bills,
        startDate,
        SCHEDULE_CALCULATION_MONTHS,  // Always 12 months
        startingBalance,
        skippedSet,
        manualAssignments,
        targetCashOnHand,
        goals,
        minCashOnHand,
        minSavingsPerPaycheck,
        debtPayoffs
      );

      // Return the goal projections from the actual schedule
      return { success: true, data: scheduleData.goalProjections || [] };
    } catch (error) {
      ipcLogger.error('goals:get-projections failed:', error);
      return { success: false, error: getErrorMessage(error) };
    }
  });

  // Schedule Generation (via BudgetManager)
  // Always calculates 12 months internally - viewportMonths only affects what's displayed
  ipcMain.handle('schedule:generate', (_, startDate: string, viewportMonths: number) => {
    if (!services.budgetManager || !services.database) {
      return { success: false, error: 'Not initialized' };
    }
    try {
      const incomes = services.budgetManager.getAllIncomes();
      const bills = services.budgetManager.getAllBills();
      const goals = services.budgetManager.getAllGoals();
      const startingBalance = services.budgetManager.getStartingBalance();
      const targetCashOnHand = services.budgetManager.getTargetCashOnHand();
      const minCashOnHand = services.budgetManager.getMinCashOnHand();
      const minSavingsPerPaycheck = services.budgetManager.getMinSavingsPerPaycheck();
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
      
      // Calculate debt payoff info for bills with linked debts
      const debtPayoffs = new Map<string, DebtPayoffInfo>();
      const state = services.budgetManager.getCurrentState();
      if (state.budgetId) {
        const debts = services.database.getDebts(state.budgetId);
        for (const debt of debts) {
          const linkedBill = bills.find(b => b.id === debt.billId);
          if (linkedBill) {
            // Extra payment = bill budget - minimum payment (if budgeting more than minimum)
            const extra = Math.max(0, linkedBill.budgetedAmount - debt.monthlyPayment);
            const amortization = services.debt.calculateAmortization(
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
      }
      
      // ALWAYS calculate 12 months for consistent data - viewport only affects display
      const data = services.scheduler.generateSchedule(
        incomes, 
        bills, 
        startDate, 
        SCHEDULE_CALCULATION_MONTHS, // Always 12 months
        startingBalance,
        skippedSet,
        manualAssignments,
        targetCashOnHand,
        goals,
        minCashOnHand,
        minSavingsPerPaycheck,
        debtPayoffs
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
      
      // Store full 12-month paychecks before filtering
      const fullPaychecks = [...data.paychecks];
      
      // Filter paychecks for the requested viewport
      const viewportEndDate = addMonths(parseISO(startDate), viewportMonths);
      const viewportPaychecks = data.paychecks.filter(p => 
        isBefore(parseISO(p.date), viewportEndDate)
      );
      
      // Update data with viewport-filtered paychecks and full schedule
      data.paychecks = viewportPaychecks;
      data.fullPaychecks = fullPaychecks;
      data.viewportMonths = viewportMonths;
      
      // Recalculate summary for viewport (for display purposes)
      const viewportSummary = {
        ...data.summary,
        totalIncome: viewportPaychecks.reduce((sum, p) => sum + p.totalIncome, 0),
        totalExpenses: viewportPaychecks.reduce((sum, p) => sum + p.totalBills, 0),
        totalSavingsDeposits: viewportPaychecks.reduce((sum, p) => sum + p.savingsDeposit, 0),
        shortfallCount: viewportPaychecks.filter(p => p.isShortfall).length,
      };
      viewportSummary.netBalance = viewportSummary.totalIncome - viewportSummary.totalExpenses;
      data.summary = viewportSummary;
      
      // Analyze for shortfalls and generate fix proposals
      const reconciliation = services.scheduler.analyzeAndProposeFixes(data);
      data.reconciliation = reconciliation;
      
      return { success: true, data };
    } catch (error) {
      ipcLogger.error('schedule:generate failed:', error);
      return { success: false, error: getErrorMessage(error) };
    }
  });

  ipcMain.handle('schedule:optimize', (_, startDate: string, months: number, startingBalance: number) => {
    if (!services.budgetManager || !services.database) {
      return { success: false, error: 'Not initialized' };
    }
    try {
      const incomes = services.budgetManager.getAllIncomes();
      const bills = services.budgetManager.getAllBills();
      const goals = services.budgetManager.getAllGoals();
      const targetCashOnHand = services.budgetManager.getTargetCashOnHand();
      const minCashOnHand = services.budgetManager.getMinCashOnHand();
      const minSavingsPerPaycheck = services.budgetManager.getMinSavingsPerPaycheck();
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
      
      // Calculate debt payoff info for bills with linked debts
      const debtPayoffs = new Map<string, DebtPayoffInfo>();
      const state = services.budgetManager.getCurrentState();
      if (state.budgetId) {
        const debts = services.database.getDebts(state.budgetId);
        for (const debt of debts) {
          const linkedBill = bills.find(b => b.id === debt.billId);
          if (linkedBill) {
            // Extra payment = bill budget - minimum payment (if budgeting more than minimum)
            const extra = Math.max(0, linkedBill.budgetedAmount - debt.monthlyPayment);
            const amortization = services.debt.calculateAmortization(
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
      }
      
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
        minCashOnHand,
        minSavingsPerPaycheck,
        debtPayoffs
      );
      return { success: true, data };
    } catch (error) {
      ipcLogger.error('schedule:optimize failed:', error);
      return { success: false, error: getErrorMessage(error) };
    }
  });

  ipcMain.handle('export:to-pdf', async (_, schedule, filePath: string) => {
    try {
      return await services.pdf.generatePdf(schedule, filePath);
    } catch (error) {
      ipcLogger.error('export:to-pdf failed:', error);
      return { success: false, error: getErrorMessage(error) };
    }
  });

  ipcMain.handle('export:to-html', async (_, schedule, filePath: string) => {
    try {
      return await services.pdf.generateHtmlFile(schedule, filePath);
    } catch (error) {
      ipcLogger.error('export:to-html failed:', error);
      return { success: false, error: getErrorMessage(error) };
    }
  });

  ipcMain.handle('export:to-spreadsheet', async (_, schedule, filePath: string) => {
    try {
      return await services.spreadsheet.generateXlsx(schedule, filePath);
    } catch (error) {
      ipcLogger.error('export:to-spreadsheet failed:', error);
      return { success: false, error: getErrorMessage(error) };
    }
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
      ipcLogger.error('reconciliation:apply-fixes failed:', error);
      return { success: false, error: getErrorMessage(error) };
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
      ipcLogger.error('settings:get failed:', error);
      return { success: false, error: getErrorMessage(error) };
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
      ipcLogger.error('settings:update failed:', error);
      return { success: false, error: getErrorMessage(error) };
    }
  });

  // Debt Management
  ipcMain.handle('debts:get-all', () => {
    if (!services.budgetManager || !services.database) {
      return { success: false, error: 'Not initialized' };
    }
    try {
      const state = services.budgetManager.getCurrentState();
      if (!state.budgetId) {
        return { success: false, error: 'No budget selected' };
      }
      const data = services.database.getDebts(state.budgetId);
      return { success: true, data };
    } catch (error) {
      ipcLogger.error('debts:get-all failed:', error);
      return { success: false, error: getErrorMessage(error) };
    }
  });

  ipcMain.handle('debts:get-by-bill', (_, billId: string) => {
    if (!services.budgetManager || !services.database) {
      return { success: false, error: 'Not initialized' };
    }
    try {
      const state = services.budgetManager.getCurrentState();
      if (!state.budgetId) {
        return { success: false, error: 'No budget selected' };
      }
      const data = services.database.getDebtByBillId(billId, state.budgetId);
      return { success: true, data };
    } catch (error) {
      ipcLogger.error('debts:get-by-bill failed:', error);
      return { success: false, error: getErrorMessage(error) };
    }
  });

  ipcMain.handle('debts:create', (_, input: DebtInput) => {
    if (!services.budgetManager || !services.database) {
      return { success: false, error: 'Not initialized' };
    }
    try {
      const state = services.budgetManager.getCurrentState();
      if (!state.budgetId) {
        return { success: false, error: 'No budget selected' };
      }
      const data = services.database.createDebt(state.budgetId, input);
      return { success: true, data };
    } catch (error) {
      ipcLogger.error('debts:create failed:', error);
      return { success: false, error: getErrorMessage(error) };
    }
  });

  ipcMain.handle('debts:update', (_, id: string, input: Partial<DebtInput>) => {
    if (!services.budgetManager || !services.database) {
      return { success: false, error: 'Not initialized' };
    }
    try {
      const state = services.budgetManager.getCurrentState();
      if (!state.budgetId) {
        return { success: false, error: 'No budget selected' };
      }
      const data = services.database.updateDebt(id, state.budgetId, input);
      if (!data) {
        return { success: false, error: 'Debt not found' };
      }
      return { success: true, data };
    } catch (error) {
      ipcLogger.error('debts:update failed:', error);
      return { success: false, error: getErrorMessage(error) };
    }
  });

  ipcMain.handle('debts:delete', (_, id: string) => {
    if (!services.budgetManager || !services.database) {
      return { success: false, error: 'Not initialized' };
    }
    try {
      const state = services.budgetManager.getCurrentState();
      if (!state.budgetId) {
        return { success: false, error: 'No budget selected' };
      }
      const deleted = services.database.deleteDebt(id, state.budgetId);
      if (!deleted) {
        return { success: false, error: 'Debt not found' };
      }
      return { success: true };
    } catch (error) {
      ipcLogger.error('debts:delete failed:', error);
      return { success: false, error: getErrorMessage(error) };
    }
  });

  ipcMain.handle('debts:get-amortization', (_, debtId: string) => {
    if (!services.budgetManager || !services.database) {
      return { success: false, error: 'Not initialized' };
    }
    try {
      const state = services.budgetManager.getCurrentState();
      if (!state.budgetId) {
        return { success: false, error: 'No budget selected' };
      }
      
      const debt = services.database.getDebtById(debtId, state.budgetId);
      if (!debt) {
        return { success: false, error: 'Debt not found' };
      }
      
      // Get linked bill to calculate extra payment from budget overage
      const bills = services.budgetManager.getAllBills();
      const linkedBill = bills.find(b => b.id === debt.billId);
      
      // Extra payment = bill budget - minimum payment (if budgeting more than minimum)
      const extra = linkedBill ? Math.max(0, linkedBill.budgetedAmount - debt.monthlyPayment) : 0;
      
      const amortization = services.debt.calculateAmortization(
        debt.principalBalance,
        debt.apr,
        debt.monthlyPayment,
        extra,
        extra > 0 ? 'monthly' : 'none'
      );
      
      return { success: true, data: amortization };
    } catch (error) {
      ipcLogger.error('debts:get-amortization failed:', error);
      return { success: false, error: getErrorMessage(error) };
    }
  });

  ipcMain.handle('debts:get-all-with-amortization', () => {
    if (!services.budgetManager || !services.database) {
      return { success: false, error: 'Not initialized' };
    }
    try {
      const state = services.budgetManager.getCurrentState();
      if (!state.budgetId) {
        return { success: false, error: 'No budget selected' };
      }
      
      const debts = services.database.getDebts(state.budgetId);
      const bills = services.budgetManager.getAllBills();
      
      const data = debts.map(debt => {
        const linkedBill = bills.find(b => b.id === debt.billId);
        
        // Extra payment = bill budget - minimum payment (if budgeting more than minimum)
        const extra = linkedBill ? Math.max(0, linkedBill.budgetedAmount - debt.monthlyPayment) : 0;
        
        const amortization = services.debt.calculateAmortization(
          debt.principalBalance,
          debt.apr,
          debt.monthlyPayment,
          extra,
          extra > 0 ? 'monthly' : 'none'
        );
        
        return { 
          debt, 
          bill: linkedBill || null, 
          amortization 
        };
      });
      
      return { success: true, data };
    } catch (error) {
      ipcLogger.error('debts:get-all-with-amortization failed:', error);
      return { success: false, error: getErrorMessage(error) };
    }
  });
}
