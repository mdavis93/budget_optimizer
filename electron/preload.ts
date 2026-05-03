import { contextBridge, ipcRenderer } from 'electron';

const api = {
  platform: () => ipcRenderer.invoke('app:get-platform'),
  checkBiometricAvailable: () => ipcRenderer.invoke('app:check-biometric-available'),
  showSaveDialog: (options: Electron.SaveDialogOptions) => 
    ipcRenderer.invoke('app:show-save-dialog', options),
  showOpenDialog: (options: Electron.OpenDialogOptions) => 
    ipcRenderer.invoke('app:show-open-dialog', options),
  quitApp: () => ipcRenderer.invoke('app:quit'),

  budget: {
    getAll: () => ipcRenderer.invoke('budget:get-all'),
    getAllWithStats: () => ipcRenderer.invoke('budget:get-all-with-stats'),
    getCurrent: () => ipcRenderer.invoke('budget:get-current'),
    getStats: (budgetId: string) => ipcRenderer.invoke('budget:get-stats', budgetId),
    create: (input: BudgetInput) => ipcRenderer.invoke('budget:create', input),
    update: (id: string, input: Partial<BudgetInput>) => 
      ipcRenderer.invoke('budget:update', id, input),
    delete: (id: string) => ipcRenderer.invoke('budget:delete', id),
    switch: (id: string) => ipcRenderer.invoke('budget:switch', id),
    startQuick: () => ipcRenderer.invoke('budget:start-quick'),
    endQuick: () => ipcRenderer.invoke('budget:end-quick'),
  },

  auth: {
    isFirstTimeSetup: () => ipcRenderer.invoke('auth:is-first-time-setup'),
    createMasterPassword: (password: string) => 
      ipcRenderer.invoke('auth:create-master-password', password),
    unlock: (password: string) => ipcRenderer.invoke('auth:unlock', password),
    unlockWithBiometric: () => ipcRenderer.invoke('auth:unlock-with-biometric'),
    lock: () => ipcRenderer.invoke('auth:lock'),
    isUnlocked: () => ipcRenderer.invoke('auth:is-unlocked'),
    enableBiometric: () => ipcRenderer.invoke('auth:enable-biometric'),
    isBiometricEnabled: () => ipcRenderer.invoke('auth:is-biometric-enabled'),
    changePassword: (oldPassword: string, newPassword: string) =>
      ipcRenderer.invoke('auth:change-password', oldPassword, newPassword),
    getPendingRecoveryKey: () => ipcRenderer.invoke('auth:get-pending-recovery-key'),
    clearPendingRecoveryKey: () => ipcRenderer.invoke('auth:clear-pending-recovery-key'),
    verifyRecoveryKey: (recoveryKey: string) => 
      ipcRenderer.invoke('auth:verify-recovery-key', recoveryKey),
    resetPasswordWithRecovery: (recoveryKey: string, newPassword: string) =>
      ipcRenderer.invoke('auth:reset-password-with-recovery', recoveryKey, newPassword),
    setAutoLock: (minutes: number) =>
      ipcRenderer.invoke('auth:set-auto-lock', minutes),
  },

  income: {
    getAll: () => ipcRenderer.invoke('income:get-all'),
    create: (income: IncomeInput) => ipcRenderer.invoke('income:create', income),
    update: (id: string, income: IncomeInput) => 
      ipcRenderer.invoke('income:update', id, income),
    delete: (id: string) => ipcRenderer.invoke('income:delete', id),
  },

  bills: {
    getAll: () => ipcRenderer.invoke('bills:get-all'),
    create: (bill: BillInput) => ipcRenderer.invoke('bills:create', bill),
    update: (id: string, bill: BillInput) => 
      ipcRenderer.invoke('bills:update', id, bill),
    delete: (id: string) => ipcRenderer.invoke('bills:delete', id),
  },

  skippedBills: {
    getAll: () => ipcRenderer.invoke('skipped-bills:get-all'),
    skip: (billId: string, skipDate: string) => 
      ipcRenderer.invoke('skipped-bills:skip', billId, skipDate),
    unskip: (billId: string, skipDate: string) => 
      ipcRenderer.invoke('skipped-bills:unskip', billId, skipDate),
    isSkipped: (billId: string, skipDate: string) => 
      ipcRenderer.invoke('skipped-bills:is-skipped', billId, skipDate),
  },

  billAssignments: {
    getAll: () => ipcRenderer.invoke('bill-assignments:get-all'),
    assign: (billId: string, billDueDate: string, paycheckDate: string) => 
      ipcRenderer.invoke('bill-assignments:assign', billId, billDueDate, paycheckDate),
    remove: (billId: string, billDueDate: string) => 
      ipcRenderer.invoke('bill-assignments:remove', billId, billDueDate),
  },

  goals: {
    getAll: () => ipcRenderer.invoke('goals:get-all'),
    create: (input: SavingsGoalInput) => ipcRenderer.invoke('goals:create', input),
    update: (id: string, input: Partial<SavingsGoalInput>) => 
      ipcRenderer.invoke('goals:update', id, input),
    delete: (id: string) => ipcRenderer.invoke('goals:delete', id),
    getProjections: () => ipcRenderer.invoke('goals:get-projections'),
  },

  debts: {
    getAll: () => ipcRenderer.invoke('debts:get-all'),
    getByBill: (billId: string) => ipcRenderer.invoke('debts:get-by-bill', billId),
    create: (input: DebtInput) => ipcRenderer.invoke('debts:create', input),
    update: (id: string, input: Partial<DebtInput>) => 
      ipcRenderer.invoke('debts:update', id, input),
    delete: (id: string) => ipcRenderer.invoke('debts:delete', id),
    getAmortization: (debtId: string) => ipcRenderer.invoke('debts:get-amortization', debtId),
    getAllWithAmortization: () => ipcRenderer.invoke('debts:get-all-with-amortization'),
  },

  schedule: {
    generate: (startDate: string, months: number) => 
      ipcRenderer.invoke('schedule:generate', startDate, months),
    optimize: (startDate: string, months: number, startingBalance: number) => 
      ipcRenderer.invoke('schedule:optimize', startDate, months, startingBalance),
  },

  reconciliation: {
    applyFixes: (fixes: Array<{
      id: string;
      type: 'move_bill' | 'skip_bill';
      billId: string;
      billDueDate: string;
      fromPaycheckDate: string;
      toPaycheckDate?: string;
    }>) => ipcRenderer.invoke('reconciliation:apply-fixes', fixes),
  },

  export: {
    toPdf: (schedule: ScheduleData, filePath: string) =>
      ipcRenderer.invoke('export:to-pdf', schedule, filePath),
    toHtml: (schedule: ScheduleData, filePath: string) =>
      ipcRenderer.invoke('export:to-html', schedule, filePath),
    toSpreadsheet: (schedule: ScheduleData, filePath: string) =>
      ipcRenderer.invoke('export:to-spreadsheet', schedule, filePath),
  },

  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    update: (settings: AppSettings) => ipcRenderer.invoke('settings:update', settings),
  },
};

interface BudgetInput {
  name: string;
  startingBalance?: number;
  targetCashOnHand?: number;
  minCashOnHand?: number;
}

interface SavingsGoalInput {
  name: string;
  targetAmount: number;
  targetDate: string;
  alreadySaved?: number;
  priority?: number;
}

interface IncomeInput {
  sourceName: string;
  amount: number;
  cadence: 'weekly' | 'biweekly' | 'semimonthly' | 'monthly';
  startDate: string;
  isActive: boolean;
}

interface BillInput {
  creditorName: string;
  budgetedAmount: number;
  dueDay: number;
  category?: string;
  isRecurring: boolean;
  priority: 'critical' | 'high' | 'normal' | 'low';
  preferredIncomeSourceId?: string;
  isIncomeAttached?: boolean;
}

interface DebtInput {
  billId: string;
  principalBalance: number;
  apr: number;
  monthlyPayment: number;
}

interface ScheduleData {
  startDate: string;
  endDate: string;
  entries: Array<{
    date: string;
    type: 'income' | 'expense';
    description: string;
    amount: number;
    runningBalance: number;
    isShortfall: boolean;
  }>;
  summary: {
    totalIncome: number;
    totalExpenses: number;
    netBalance: number;
    shortfallCount: number;
  };
}

interface AppSettings {
  theme: 'light' | 'dark' | 'system';
  autoLockMinutes: number;
  currency: string;
  defaultScheduleMonths: number;
  savingsAPY: number;
  lastBudgetId?: string;
}

contextBridge.exposeInMainWorld('electronAPI', api);

declare global {
  interface Window {
    electronAPI: typeof api;
  }
}
