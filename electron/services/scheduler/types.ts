import { format } from 'date-fns';

export const DEFAULT_TARGET_CASH_ON_HAND = 250;
export const DEFAULT_MIN_CASH_ON_HAND = 100;
export const MIN_BREATHING_ROOM = 50; // Minimum balance to maintain after bills
export const MAX_PREPAY_DAYS = 14; // Bills cannot be paid more than 14 days early
export const SCHEDULE_CALCULATION_MONTHS = 12;

export type RebalanceStrategy = 'deficit_killer' | 'prepay_minimizer' | 'goal_guardian';

export type UnfundableReason =
  | 'no_eligible_earlier_paycheck'
  | 'all_movable_bills_locked'
  | 'insufficient_income_this_paycheck'
  | 'goal_reserve_conflict';

export const REBALANCE_STRATEGIES: RebalanceStrategy[] = [
  'deficit_killer',
  'prepay_minimizer',
  'goal_guardian',
];

/** Max movable bills considered by the Phase F micro-solver per deficit paycheck. */
export const MICRO_SOLVER_MAX_BILLS = 8;

export interface DebtPayoffInfo {
  billId: string;
  payoffDate: Date;
  finalPaymentAmount: number;
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
  unfundableReason?: UnfundableReason;
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

export interface ScheduleEntry {
  date: string;
  type: 'income' | 'expense' | 'savings';
  description: string;
  amount: number;
  runningBalance: number;
  isShortfall: boolean;
  recommendation?: string;
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
  reasonCode?: UnfundableReason;
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

export interface ProjectedIncome {
  date: Date;
  sourceId: string;
  sourceName: string;
  amount: number;
}

export interface ProjectedBill {
  date: Date;
  billId: string;
  creditorName: string;
  amount: number;
  dueDay: number;
  priority: 'critical' | 'high' | 'normal' | 'low';
  category?: string;
  preferredIncomeSourceId?: string;
  isIncomeAttached?: boolean;
  isUnpayable?: boolean;
  unfundableReason?: UnfundableReason;
}

export interface PaycheckAssignment {
  date: Date;
  incomes: ProjectedIncome[];
  bills: ProjectedBill[];
}

export function billOccurrenceKey(billId: string, date: Date): string {
  return `${billId}-${format(date, 'yyyy-MM-dd')}`;
}
