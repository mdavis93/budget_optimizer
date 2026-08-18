import type {
  AmortizationSchedule,
  ApiResult,
  AppSettings,
  Bill,
  BillAssignment,
  BillInput,
  Budget,
  BudgetInput,
  BudgetSnapshot,
  BudgetWithStats,
  Debt,
  DebtInput,
  DebtWithAmortization,
  DraftOverlay,
  GoalProjection,
  Income,
  IncomeInput,
  IncomeOverride,
  Leave,
  LeaveInput,
  SavingsGoal,
  SavingsGoalInput,
  ScheduleData,
  SkippedBill,
} from './types';
import type { DiagnosticBundle, DiagnosticReportInput } from './diagnostics';
import type { ScheduleComputeProgressMessage } from './scheduleComputeProtocol';

export interface BudgetStats {
  incomeCount: number;
  billCount: number;
}

export interface CurrentBudgetState {
  budget: Budget | null;
  isQuickBudget: boolean;
}

export interface ElectronAPI {
  platform: () => Promise<string>;
  checkBiometricAvailable: () => Promise<boolean>;
  showSaveDialog: (options: {
    title?: string;
    defaultPath?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
  }) => Promise<{ canceled: boolean; filePath?: string }>;
  quitApp: () => Promise<void>;
  onCloseRequested: (callback: () => void) => () => void;

  budget: {
    getAll: () => Promise<ApiResult<Budget[]>>;
    getAllWithStats: () => Promise<ApiResult<BudgetWithStats[]>>;
    getCurrent: () => Promise<ApiResult<CurrentBudgetState>>;
    getSnapshot: () => Promise<ApiResult<BudgetSnapshot>>;
    getStats: (budgetId: string) => Promise<ApiResult<BudgetStats>>;
    create: (input: BudgetInput) => Promise<ApiResult<Budget>>;
    update: (id: string, input: Partial<BudgetInput>) => Promise<ApiResult<Budget>>;
    delete: (id: string) => Promise<ApiResult>;
    switch: (id: string) => Promise<ApiResult<Budget>>;
    startQuick: () => Promise<ApiResult>;
    endQuick: () => Promise<ApiResult>;
  };

  auth: {
    isFirstTimeSetup: () => Promise<boolean>;
    createMasterPassword: (password: string) => Promise<ApiResult & { recoveryKey?: string }>;
    unlock: (password: string) => Promise<ApiResult>;
    unlockWithSavedCredentials: () => Promise<ApiResult>;
    unlockWithBiometric: () => Promise<ApiResult>;
    lock: () => Promise<ApiResult>;
    isUnlocked: () => Promise<boolean>;
    enableBiometric: () => Promise<ApiResult>;
    isBiometricEnabled: () => Promise<boolean>;
    changePassword: (oldPassword: string, newPassword: string) => Promise<ApiResult & { newRecoveryKey?: string }>;
    getPendingRecoveryKey: () => Promise<string | null>;
    clearPendingRecoveryKey: () => Promise<ApiResult | void>;
    verifyRecoveryKey: (recoveryKey: string) => Promise<ApiResult>;
    resetPasswordWithRecovery: (recoveryKey: string, newPassword: string) => Promise<ApiResult & { newRecoveryKey?: string }>;
    activityPing: () => Promise<ApiResult>;
    onLocked: (callback: () => void) => () => void;
  };

  income: {
    getAll: () => Promise<ApiResult<Income[]>>;
    create: (income: IncomeInput) => Promise<ApiResult<Income>>;
    update: (id: string, income: IncomeInput) => Promise<ApiResult<Income>>;
    delete: (id: string) => Promise<ApiResult>;
  };

  bills: {
    getAll: () => Promise<ApiResult<Bill[]>>;
    create: (bill: BillInput) => Promise<ApiResult<Bill>>;
    update: (id: string, bill: BillInput) => Promise<ApiResult<Bill>>;
    delete: (id: string) => Promise<ApiResult>;
  };

  skippedBills: {
    getAll: () => Promise<ApiResult<SkippedBill[]>>;
    skip: (billId: string, skipDate: string) => Promise<ApiResult<SkippedBill>>;
    unskip: (billId: string, skipDate: string) => Promise<ApiResult>;
    isSkipped: (billId: string, skipDate: string) => Promise<ApiResult<boolean>>;
  };

  billAssignments: {
    getAll: () => Promise<ApiResult<BillAssignment[]>>;
    assign: (billId: string, billDueDate: string, paycheckDate: string) => Promise<ApiResult<BillAssignment>>;
    remove: (billId: string, billDueDate: string) => Promise<ApiResult>;
  };

  incomeOverrides: {
    getAll: () => Promise<ApiResult<IncomeOverride[]>>;
    set: (incomeId: string, paycheckDate: string, amount: number) => Promise<ApiResult<IncomeOverride>>;
    remove: (incomeId: string, paycheckDate: string) => Promise<ApiResult<boolean>>;
  };

  goals: {
    getAll: () => Promise<ApiResult<SavingsGoal[]>>;
    create: (input: SavingsGoalInput) => Promise<ApiResult<SavingsGoal>>;
    update: (id: string, input: Partial<SavingsGoalInput>) => Promise<ApiResult<SavingsGoal>>;
    delete: (id: string) => Promise<ApiResult>;
    getProjections: (overlay?: DraftOverlay) => Promise<ApiResult<GoalProjection[]>>;
  };

  debts: {
    getAll: () => Promise<ApiResult<Debt[]>>;
    getByBill: (billId: string) => Promise<ApiResult<Debt | null>>;
    create: (input: DebtInput) => Promise<ApiResult<Debt>>;
    update: (id: string, input: Partial<DebtInput>) => Promise<ApiResult<Debt>>;
    delete: (id: string) => Promise<ApiResult>;
    getAmortization: (debtId: string) => Promise<ApiResult<AmortizationSchedule>>;
    getAllWithAmortization: (overlay?: DraftOverlay) => Promise<ApiResult<DebtWithAmortization[]>>;
  };

  leaves: {
    getAll: () => Promise<ApiResult<Leave[]>>;
    create: (input: LeaveInput) => Promise<ApiResult<Leave>>;
    update: (id: string, input: LeaveInput) => Promise<ApiResult<Leave>>;
    delete: (id: string) => Promise<ApiResult>;
  };

  schedule: {
    build: (
      startDate: string,
      months: number,
      startingBalance: number,
      overlay?: DraftOverlay
    ) => Promise<ApiResult<ScheduleData>>;
    onProgress: (callback: (progress: ScheduleComputeProgressMessage) => void) => () => void;
  };

  export: {
    toPdf: (schedule: ScheduleData, filePath: string) => Promise<ApiResult>;
    toHtml: (schedule: ScheduleData, filePath: string) => Promise<ApiResult>;
    toSpreadsheet: (schedule: ScheduleData, filePath: string) => Promise<ApiResult>;
  };

  settings: {
    get: () => Promise<ApiResult<AppSettings>>;
    update: (settings: Partial<AppSettings>) => Promise<ApiResult<AppSettings>>;
  };

  credentials: {
    delete: () => Promise<ApiResult>;
    has: () => Promise<boolean>;
  };

  diagnostics: {
    report: (input: DiagnosticReportInput) => Promise<ApiResult<{ id: string }>>;
    getEvent: (eventId: string) => Promise<ApiResult<DiagnosticBundle>>;
    getBundle: (limit?: number) => Promise<ApiResult<DiagnosticBundle>>;
    export: (filePath: string, limit?: number) => Promise<ApiResult>;
  };
}
