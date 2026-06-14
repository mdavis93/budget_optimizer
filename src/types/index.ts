export interface Budget {
  id: string;
  name: string;
  startingBalance: number;
  targetCashOnHand: number;
  minCashOnHand: number;
  minSavingsPerPaycheck: number;
  createdAt: string;
  updatedAt: string;
}

export interface BudgetInput {
  name: string;
  startingBalance?: number;
  targetCashOnHand?: number;
  minCashOnHand?: number;
  minSavingsPerPaycheck?: number;
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

/** Scheduled gross for one income source on a specific paycheck date (yyyy-MM-dd). */
export interface IncomeOverride {
  id: string;
  incomeId: string;
  paycheckDate: string;
  amount: number;
  createdAt: string;
}

export interface Debt {
  id: string;
  budgetId: string;
  billId: string;
  principalBalance: number;
  apr: number;
  monthlyPayment: number;
  createdAt: string;
  updatedAt: string;
}

export interface DebtInput {
  billId: string;
  principalBalance: number;
  apr: number;
  monthlyPayment: number;
}

export interface AmortizationPayment {
  paymentNumber: number;
  date: string;
  payment: number;
  principal: number;
  interest: number;
  remainingBalance: number;
}

export interface AmortizationSchedule {
  payments: AmortizationPayment[];
  totalPayments: number;
  totalInterest: number;
  totalPrincipal: number;
  payoffDate: string;
  monthsToPayoff: number;
}

export interface DebtWithAmortization {
  debt: Debt;
  bill: Bill | null;
  amortization: AmortizationSchedule | null;
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
  isUnpayable?: boolean;
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

export interface GoalScheduleHealth {
  tightPaycheckCount: number;
  shortfallCount: number;
  savingsTotal: number;
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
  adjustedRequiredPerPaycheck: number;
  availablePerPaycheck: number;
  actualAllocation: number;  // Real amount allocated in schedule
  achievableAmount: number;
  achievabilityPercent: number;
  status: 'achievable' | 'partial' | 'impossible';
  suggestions: GoalSuggestion[];
  isProjected: boolean;  // True if goal is beyond 12-month schedule window
  projectionNote?: string;  // Explanation when isProjected is true
  avgAllocationPerPaycheck: number;
  marginPerPaycheck: number;
  paychecksToFullyFund: number | null;
  estimatedFundedDate: string | null;
  beatsDeadlineByPaychecks: number | null;
  missesDeadlineByPaychecks: number | null;
  scheduleHealth: GoalScheduleHealth;
}

export interface ScheduleData {
  startDate: string;
  endDate: string;
  paychecks: PaycheckEntry[];
  fullPaychecks: PaycheckEntry[];  // Always contains full 12-month schedule
  viewportMonths: number;  // The currently displayed viewport (1, 3, 6, or 12)
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
