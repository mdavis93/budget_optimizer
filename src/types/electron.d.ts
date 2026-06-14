export interface Budget {
  id: string;
  name: string;
  startingBalance: number;
  targetCashOnHand: number;
  minCashOnHand: number;
  minSavingsPerPaycheck: number;
  scheduleStartDate: string;
  createdAt: string;
  updatedAt: string;
}

interface BudgetInput {
  name: string;
  startingBalance?: number;
  targetCashOnHand?: number;
  minCashOnHand?: number;
  minSavingsPerPaycheck?: number;
  scheduleStartDate?: string;
}

interface SavingsGoalInput {
  name: string;
  targetAmount: number;
  targetDate: string;
  alreadySaved?: number;
  priority?: number;
}

interface SavingsGoalData {
  id: string;
  budgetId: string;
  name: string;
  targetAmount: number;
  targetDate: string;
  alreadySaved: number;
  priority: number;
  createdAt: string;
}

interface BudgetStats {
  incomeCount: number;
  billCount: number;
}

interface BudgetDataWithStats extends BudgetData, BudgetStats {}

interface CurrentBudgetState {
  budget: BudgetData | null;
  isQuickBudget: boolean;
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

type UnfundableReason =
  | 'no_eligible_earlier_paycheck'
  | 'all_movable_bills_locked'
  | 'insufficient_income_this_paycheck'
  | 'goal_reserve_conflict';

interface PaycheckBillData {
  billId: string;
  creditorName: string;
  amount: number;
  dueDay: number;
  priority: 'critical' | 'high' | 'normal' | 'low';
  category?: string;
  billDate: string;
  isIncomeAttached?: boolean;
  isUnpayable?: boolean;
  unfundableReason?: UnfundableReason;
}

interface GoalDepositData {
  goalId: string;
  goalName: string;
  amount: number;
}

interface PaycheckEntryData {
  date: string;
  incomeSources: {
    id: string;
    name: string;
    amount: number;
  }[];
  totalIncome: number;
  bills: PaycheckBillData[];
  totalBills: number;
  goalDeposits: GoalDepositData[];
  totalGoalDeposits: number;
  budgetRemaining: number;
  savingsDeposit: number;
  totalSavings: number;
  isShortfall: boolean;
}

interface ProposedFix {
  id: string;
  type: 'move_bill' | 'skip_bill';
  billId: string;
  billName: string;
  billAmount: number;
  fromPaycheckDate: string;
  toPaycheckDate?: string;
  billDueDate: string;
  reason: string;
  impact: number;
  reasonCode?: UnfundableReason;
}

interface ShortfallDetail {
  paycheckDate: string;
  deficit: number;
  bills: PaycheckBillData[];
}

interface ReconciliationReport {
  needsReconciliation: boolean;
  shortfalls: ShortfallDetail[];
  proposedFixes: ProposedFix[];
  canBeFullyResolved: boolean;
  totalDeficit: number;
  estimatedResolution: number;
}

interface GoalSuggestionData {
  type: 'extend_deadline' | 'reduce_target' | 'increase_priority';
  description: string;
  newValue: string | number;
  resultPercent: number;
}

interface GoalScheduleHealthData {
  tightPaycheckCount: number;
  shortfallCount: number;
  savingsTotal: number;
}

interface GoalProjectionData {
  goalId: string;
  goalName: string;
  targetAmount: number;
  alreadySaved: number;
  remainingAmount: number;
  targetDate: string;
  paycheckCount: number;
  requiredPerPaycheck: number;
  adjustedRequiredPerPaycheck: number;
  availablePerPaycheck: number;
  actualAllocation: number;
  achievableAmount: number;
  achievabilityPercent: number;
  status: 'achievable' | 'partial' | 'impossible';
  suggestions: GoalSuggestionData[];
  isProjected: boolean;
  projectionNote?: string;
  avgAllocationPerPaycheck: number;
  marginPerPaycheck: number;
  paychecksToFullyFund: number | null;
  estimatedFundedDate: string | null;
  beatsDeadlineByPaychecks: number | null;
  missesDeadlineByPaychecks: number | null;
  scheduleHealth: GoalScheduleHealthData;
}

interface ScheduleData {
  startDate: string;
  endDate: string;
  paychecks: PaycheckEntryData[];
  fullPaychecks: PaycheckEntryData[];
  viewportMonths: number;
  entries: Array<{
    date: string;
    type: 'income' | 'expense' | 'savings';
    description: string;
    amount: number;
    runningBalance: number;
    isShortfall: boolean;
    recommendation?: string;
  }>;
  summary: {
    totalIncome: number;
    totalExpenses: number;
    totalSavingsDeposits: number;
    finalSavingsBalance: number;
    netBalance: number;
    shortfallCount: number;
    averageBalance: number;
    lowestBalance: number;
    highestBalance: number;
  };
  recommendations: string[];
  maxBudgetRemaining: number;
  reconciliation?: ReconciliationReport;
  goalProjections?: GoalProjectionData[];
}

interface AppSettings {
  theme: 'light' | 'dark' | 'system';
  autoLockMinutes: number;
  currency: string;
  defaultScheduleMonths: number;
  savingsAPY: number;
  lastBudgetId?: string;
}

interface DebtInput {
  billId: string;
  principalBalance: number;
  apr: number;
  monthlyPayment: number;
}

interface DebtData {
  id: string;
  budgetId: string;
  billId: string;
  principalBalance: number;
  apr: number;
  monthlyPayment: number;
  createdAt: string;
  updatedAt: string;
}

interface AmortizationPaymentData {
  paymentNumber: number;
  date: string;
  payment: number;
  principal: number;
  interest: number;
  remainingBalance: number;
}

interface AmortizationScheduleData {
  payments: AmortizationPaymentData[];
  totalPayments: number;
  totalInterest: number;
  totalPrincipal: number;
  payoffDate: string;
  monthsToPayoff: number;
}

interface DebtWithAmortizationData {
  debt: DebtData;
  bill: import('./index').Bill | null;
  amortization: AmortizationScheduleData | null;
}

interface ApiResult<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}

interface DraftOverlay {
  incomes?: import('./index').Income[];
  bills?: import('./index').Bill[];
  goals?: SavingsGoalData[];
  debts?: DebtData[];
  skippedBills?: import('./index').SkippedBill[];
  billAssignments?: import('./index').BillAssignment[];
  incomeOverrides?: import('./index').IncomeOverride[];
  startingBalance?: number;
  targetCashOnHand?: number;
  minCashOnHand?: number;
  minSavingsPerPaycheck?: number;
}

interface ElectronAPI {
  platform: () => Promise<string>;
  checkBiometricAvailable: () => Promise<boolean>;
  showSaveDialog: (options: {
    title?: string;
    defaultPath?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
  }) => Promise<{ canceled: boolean; filePath?: string }>;
  showOpenDialog: (options: {
    title?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
  }) => Promise<{ canceled: boolean; filePaths: string[] }>;
  quitApp: () => Promise<void>;

  budget: {
    getAll: () => Promise<ApiResult<BudgetData[]>>;
    getAllWithStats: () => Promise<ApiResult<BudgetDataWithStats[]>>;
    getCurrent: () => Promise<ApiResult<CurrentBudgetState>>;
    getStats: (budgetId: string) => Promise<ApiResult<BudgetStats>>;
    create: (input: BudgetInput) => Promise<ApiResult<BudgetData>>;
    update: (id: string, input: Partial<BudgetInput>) => Promise<ApiResult<BudgetData>>;
    delete: (id: string) => Promise<ApiResult>;
    switch: (id: string) => Promise<ApiResult<BudgetData>>;
    startQuick: () => Promise<ApiResult>;
    endQuick: () => Promise<ApiResult>;
  };

  auth: {
    isFirstTimeSetup: () => Promise<boolean>;
    createMasterPassword: (password: string) => Promise<ApiResult & { recoveryKey?: string }>;
    unlock: (password: string) => Promise<ApiResult>;
    unlockWithBiometric: () => Promise<ApiResult>;
    lock: () => Promise<void>;
    isUnlocked: () => Promise<boolean>;
    enableBiometric: () => Promise<ApiResult>;
    isBiometricEnabled: () => Promise<boolean>;
    changePassword: (oldPassword: string, newPassword: string) => Promise<ApiResult & { newRecoveryKey?: string }>;
    getPendingRecoveryKey: () => Promise<string | null>;
    clearPendingRecoveryKey: () => Promise<void>;
    verifyRecoveryKey: (recoveryKey: string) => Promise<ApiResult>;
    resetPasswordWithRecovery: (recoveryKey: string, newPassword: string) => Promise<ApiResult & { newRecoveryKey?: string }>;
    setAutoLock: (minutes: number) => Promise<ApiResult>;
    activityPing: () => Promise<ApiResult>;
  };

  income: {
    getAll: () => Promise<ApiResult<import('./index').Income[]>>;
    create: (income: IncomeInput) => Promise<ApiResult<import('./index').Income>>;
    update: (id: string, income: IncomeInput) => Promise<ApiResult<import('./index').Income>>;
    delete: (id: string) => Promise<ApiResult>;
  };

  bills: {
    getAll: () => Promise<ApiResult<import('./index').Bill[]>>;
    create: (bill: BillInput) => Promise<ApiResult<import('./index').Bill>>;
    update: (id: string, bill: BillInput) => Promise<ApiResult<import('./index').Bill>>;
    delete: (id: string) => Promise<ApiResult>;
  };

  skippedBills: {
    getAll: () => Promise<ApiResult<import('./index').SkippedBill[]>>;
    skip: (billId: string, skipDate: string) => Promise<ApiResult<import('./index').SkippedBill>>;
    unskip: (billId: string, skipDate: string) => Promise<ApiResult>;
    isSkipped: (billId: string, skipDate: string) => Promise<ApiResult<boolean>>;
  };

  billAssignments: {
    getAll: () => Promise<ApiResult<import('./index').BillAssignment[]>>;
    assign: (billId: string, billDueDate: string, paycheckDate: string) => Promise<ApiResult<import('./index').BillAssignment>>;
    remove: (billId: string, billDueDate: string) => Promise<ApiResult>;
  };

  incomeOverrides: {
    getAll: () => Promise<ApiResult<import('./index').IncomeOverride[]>>;
    set: (incomeId: string, paycheckDate: string, amount: number) => Promise<ApiResult<import('./index').IncomeOverride>>;
    remove: (incomeId: string, paycheckDate: string) => Promise<ApiResult<boolean>>;
  };

  goals: {
    getAll: () => Promise<ApiResult<SavingsGoalData[]>>;
    create: (input: SavingsGoalInput) => Promise<ApiResult<SavingsGoalData>>;
    update: (id: string, input: Partial<SavingsGoalInput>) => Promise<ApiResult<SavingsGoalData>>;
    delete: (id: string) => Promise<ApiResult>;
    getProjections: (overlay?: DraftOverlay) => Promise<ApiResult<GoalProjectionData[]>>;
  };

  debts: {
    getAll: () => Promise<ApiResult<DebtData[]>>;
    getByBill: (billId: string) => Promise<ApiResult<DebtData | null>>;
    create: (input: DebtInput) => Promise<ApiResult<DebtData>>;
    update: (id: string, input: Partial<DebtInput>) => Promise<ApiResult<DebtData>>;
    delete: (id: string) => Promise<ApiResult>;
    getAmortization: (debtId: string) => Promise<ApiResult<AmortizationScheduleData>>;
    getAllWithAmortization: (overlay?: DraftOverlay) => Promise<ApiResult<DebtWithAmortizationData[]>>;
  };

  schedule: {
    build: (startDate: string, months: number, startingBalance: number, overlay?: DraftOverlay) => Promise<ApiResult<ScheduleData>>;
  };

  reconciliation: {
    applyFixes: (fixes: Array<{
      id: string;
      type: 'move_bill' | 'skip_bill';
      billId: string;
      billDueDate: string;
      fromPaycheckDate: string;
      toPaycheckDate?: string;
    }>) => Promise<ApiResult>;
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
    save: (password: string) => Promise<ApiResult>;
    get: () => Promise<ApiResult & { password?: string }>;
    delete: () => Promise<ApiResult>;
    has: () => Promise<boolean>;
    offerSave: (password: string) => Promise<ApiResult & { saved?: boolean }>;
  };
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
