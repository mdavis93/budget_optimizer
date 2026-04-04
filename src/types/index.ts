export interface Budget {
  id: string;
  name: string;
  startingBalance: number;
  targetCashOnHand: number;
  minCashOnHand: number;
  createdAt: string;
  updatedAt: string;
}

export interface BudgetInput {
  name: string;
  startingBalance?: number;
  targetCashOnHand?: number;
  minCashOnHand?: number;
}

export interface SavingsGoal {
  id: string;
  budgetId: string;
  name: string;
  targetAmount: number;
  targetDate: string;
  alreadySaved: number;
  priority: number;
  createdAt: string;
}

export interface SavingsGoalInput {
  name: string;
  targetAmount: number;
  targetDate: string;
  alreadySaved?: number;
  priority?: number;
}

export interface BudgetWithStats extends Budget {
  incomeCount: number;
  billCount: number;
}

export interface Income {
  id: string;
  sourceName: string;
  amount: number;
  cadence: 'weekly' | 'biweekly' | 'semimonthly' | 'monthly';
  startDate: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface IncomeInput {
  sourceName: string;
  amount: number;
  cadence: 'weekly' | 'biweekly' | 'semimonthly' | 'monthly';
  startDate: string;
  isActive: boolean;
}

export interface Bill {
  id: string;
  creditorName: string;
  budgetedAmount: number;
  dueDay: number;
  category?: string;
  isRecurring: boolean;
  priority: 'critical' | 'high' | 'normal' | 'low';
  preferredIncomeSourceId?: string;
  isIncomeAttached?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BillInput {
  creditorName: string;
  budgetedAmount: number;
  dueDay: number;
  category?: string;
  isRecurring: boolean;
  priority: 'critical' | 'high' | 'normal' | 'low';
  preferredIncomeSourceId?: string;
  isIncomeAttached?: boolean;
}

export interface SkippedBill {
  id: string;
  billId: string;
  skipDate: string;
  createdAt: string;
}

export interface BillAssignment {
  id: string;
  billId: string;
  billDueDate: string;
  paycheckDate: string;
  createdAt: string;
}

export interface ScheduleEntry {
  date: string;
  type: 'income' | 'expense' | 'savings';
  description: string;
  amount: number;
  runningBalance: number;
  isShortfall: boolean;
  recommendation?: string;
}

export interface PaycheckBill {
  billId: string;
  creditorName: string;
  amount: number;
  dueDay: number;
  priority: 'critical' | 'high' | 'normal' | 'low';
  category?: string;
  billDate: string; // The projected due date for this bill occurrence
  isIncomeAttached?: boolean;
}

export interface GoalDeposit {
  goalId: string;
  goalName: string;
  amount: number;
}

export interface PaycheckEntry {
  date: string;
  incomeSources: {
    id: string;
    name: string;
    amount: number;
  }[];
  totalIncome: number;
  bills: PaycheckBill[];
  totalBills: number;
  goalDeposits: GoalDeposit[];
  totalGoalDeposits: number;
  budgetRemaining: number;
  savingsDeposit: number;
  totalSavings: number;
  isShortfall: boolean;
}

export interface GoalSuggestion {
  type: 'extend_deadline' | 'reduce_target' | 'increase_priority';
  description: string;
  newValue: string | number;
  resultPercent: number;
}

export interface GoalProjection {
  goalId: string;
  goalName: string;
  targetAmount: number;
  alreadySaved: number;
  remainingAmount: number;
  targetDate: string;
  paycheckCount: number;
  requiredPerPaycheck: number;
  availablePerPaycheck: number;
  achievableAmount: number;
  achievabilityPercent: number;
  status: 'achievable' | 'partial' | 'impossible';
  suggestions: GoalSuggestion[];
}

export interface ScheduleData {
  startDate: string;
  endDate: string;
  paychecks: PaycheckEntry[];
  entries: ScheduleEntry[];
  summary: ScheduleSummary;
  recommendations: string[];
  maxBudgetRemaining: number;
  reconciliation?: ReconciliationReport;
  goalProjections?: GoalProjection[];
}

export interface ProposedFix {
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
}

export interface ShortfallDetail {
  paycheckDate: string;
  deficit: number;
  bills: PaycheckBill[];
}

export interface ReconciliationReport {
  needsReconciliation: boolean;
  shortfalls: ShortfallDetail[];
  proposedFixes: ProposedFix[];
  canBeFullyResolved: boolean;
  totalDeficit: number;
  estimatedResolution: number;
}

export interface ScheduleSummary {
  totalIncome: number;
  totalExpenses: number;
  totalSavingsDeposits: number;
  finalSavingsBalance: number;
  netBalance: number;
  shortfallCount: number;
  averageBalance: number;
  lowestBalance: number;
  highestBalance: number;
}

export interface AppSettings {
  theme: 'light' | 'dark' | 'system';
  autoLockMinutes: number;
  currency: string;
  defaultScheduleMonths: number;
  savingsAPY: number;
  lastBudgetId?: string;
}

export const CADENCE_LABELS: Record<Income['cadence'], string> = {
  weekly: 'Weekly',
  biweekly: 'Bi-weekly',
  semimonthly: 'Semi-monthly',
  monthly: 'Monthly',
};

export const PRIORITY_LABELS: Record<Bill['priority'], string> = {
  critical: 'Critical',
  high: 'High',
  normal: 'Normal',
  low: 'Low',
};

export const PRIORITY_COLORS: Record<Bill['priority'], string> = {
  critical: 'text-danger-500',
  high: 'text-warning-500',
  normal: 'text-primary-500',
  low: 'text-[var(--color-text-muted)]',
};

export const CATEGORY_OPTIONS = [
  'Housing',
  'Utilities',
  'Transportation',
  'Insurance',
  'Debt',
  'Subscriptions',
  'Food',
  'Healthcare',
  'Entertainment',
  'Savings',
  'Other',
] as const;

export type Category = typeof CATEGORY_OPTIONS[number];
