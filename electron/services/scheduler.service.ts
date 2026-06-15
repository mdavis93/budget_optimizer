import { 
  addWeeks, 
  addMonths, 
  isBefore, 
  isAfter, 
  format, 
  parseISO, 
  startOfDay,
  setDate,
  getDate,
  getDaysInMonth,
  startOfMonth,
  endOfMonth,
  isEqual,
  differenceInDays
} from 'date-fns';
import { Income, Bill, SavingsGoal } from './database.service';
import {
  getPaycheckDatesUntilGoal,
  calculateGlidePath,
  calculateAllocationMultiplier,
  estimateAchievableAmount,
  getNextIncomeDate,
} from '../utils/paycheck-calculator';
import { PRIORITY_ORDER, formatCurrency, roundCurrency } from '../utils/constants';
import { scoreEligiblePaycheck as scoreEligiblePaycheckUtil } from '../utils/scheduleScoring';
import { solvePaycheckDeficit } from '../utils/rebalanceMicroSolver';

const DEFAULT_TARGET_CASH_ON_HAND = 250;
const DEFAULT_MIN_CASH_ON_HAND = 100;
const MIN_BREATHING_ROOM = 50; // Minimum balance to maintain after bills
const MAX_PREPAY_DAYS = 14; // Bills cannot be paid more than 14 days early
export const SCHEDULE_CALCULATION_MONTHS = 12;

type RebalanceStrategy = 'deficit_killer' | 'prepay_minimizer' | 'goal_guardian';

export type UnfundableReason =
  | 'no_eligible_earlier_paycheck'
  | 'all_movable_bills_locked'
  | 'insufficient_income_this_paycheck'
  | 'goal_reserve_conflict';

const REBALANCE_STRATEGIES: RebalanceStrategy[] = [
  'deficit_killer',
  'prepay_minimizer',
  'goal_guardian',
];

/** Max movable bills considered by the Phase F micro-solver per deficit paycheck. */
const MICRO_SOLVER_MAX_BILLS = 8;

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

interface ProjectedIncome {
  date: Date;
  sourceId: string;
  sourceName: string;
  amount: number;
}

interface ProjectedBill {
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

export class SchedulerService {
  projectIncome(income: Income, startDate: Date, endDate: Date): ProjectedIncome[] {
    const events: ProjectedIncome[] = [];
    if (!income.isActive) return events;

    let currentDate = parseISO(income.startDate);
    currentDate = startOfDay(currentDate);

    while (isBefore(currentDate, startDate)) {
      currentDate = getNextIncomeDate(currentDate, income.cadence);
    }

    while (isBefore(currentDate, endDate) || isEqual(currentDate, endDate)) {
      events.push({
        date: currentDate,
        sourceId: income.id,
        sourceName: income.sourceName,
        amount: income.amount,
      });
      currentDate = getNextIncomeDate(currentDate, income.cadence);
    }

    return events;
  }

  projectBills(
    bill: Bill, 
    startDate: Date, 
    endDate: Date,
    debtPayoffInfo?: DebtPayoffInfo
  ): ProjectedBill[] {
    const events: ProjectedBill[] = [];
    
    let currentMonth = startOfMonth(startDate);
    const end = endOfMonth(endDate);

    while (isBefore(currentMonth, end) || isEqual(currentMonth, end)) {
      const daysInMonth = getDaysInMonth(currentMonth);
      const dueDay = Math.min(bill.dueDay, daysInMonth);
      const dueDate = setDate(currentMonth, dueDay);

      // If this bill has debt payoff info, stop projecting after payoff date
      if (debtPayoffInfo && isAfter(dueDate, debtPayoffInfo.payoffDate)) {
        break;
      }

      if (
        (isAfter(dueDate, startDate) || isEqual(dueDate, startDate)) &&
        (isBefore(dueDate, endDate) || isEqual(dueDate, endDate))
      ) {
        // Check if this is the final payment month for a debt
        const isFinalPayment = debtPayoffInfo && 
          startOfMonth(dueDate).getTime() === startOfMonth(debtPayoffInfo.payoffDate).getTime();
        
        events.push({
          date: dueDate,
          billId: bill.id,
          creditorName: bill.creditorName,
          amount: isFinalPayment ? debtPayoffInfo.finalPaymentAmount : bill.budgetedAmount,
          dueDay: bill.dueDay,
          priority: bill.priority,
          category: bill.category,
          preferredIncomeSourceId: bill.preferredIncomeSourceId,
          isIncomeAttached: bill.isIncomeAttached,
        });
      }

      currentMonth = addMonths(currentMonth, 1);

      if (!bill.isRecurring) break;
    }

    return events;
  }

  generateSchedule(
    incomes: Income[],
    bills: Bill[],
    startDateStr: string,
    months: number,
    startingBalance: number,
    skippedBills: Set<string> = new Set(),
    manualAssignments: Map<string, string> = new Map(),
    maxBudgetRemaining: number = DEFAULT_TARGET_CASH_ON_HAND,
    goals: SavingsGoal[] = [],
    minCashOnHand: number = DEFAULT_MIN_CASH_ON_HAND,
    minSavingsPerPaycheck: number = 0,
    debtPayoffs: Map<string, DebtPayoffInfo> = new Map(),
    incomeOverrides: Map<string, number> = new Map()
  ): ScheduleData {
    const startDate = startOfDay(parseISO(startDateStr));
    const endDate = addMonths(startDate, SCHEDULE_CALCULATION_MONTHS);

    const allIncomes: ProjectedIncome[] = [];
    for (const income of incomes) {
      allIncomes.push(...this.projectIncome(income, startDate, endDate));
    }

    for (const projected of allIncomes) {
      const key = `${projected.sourceId}-${format(projected.date, 'yyyy-MM-dd')}`;
      if (incomeOverrides.has(key)) {
        projected.amount = incomeOverrides.get(key)!;
      }
    }

    // Separate income-attached bills from regular bills BEFORE projection
    // Income-attached bills don't use date-based projection - they attach to every matching paycheck
    const incomeAttachedBillsRaw = bills.filter(b => b.isIncomeAttached && b.preferredIncomeSourceId);
    const regularBills = bills.filter(b => !b.isIncomeAttached);

    const allBills: ProjectedBill[] = [];
    for (const bill of regularBills) {
      const debtInfo = debtPayoffs.get(bill.id);
      allBills.push(...this.projectBills(bill, startDate, endDate, debtInfo));
    }

    allIncomes.sort((a, b) => a.date.getTime() - b.date.getTime());
    allBills.sort((a, b) => a.date.getTime() - b.date.getTime());

    // Filter out skipped bills and deduplicate (only for date-based bills)
    const seenBillKeys = new Set<string>();
    const uniqueBills = allBills.filter(bill => {
      const dateStr = format(bill.date, 'yyyy-MM-dd');
      const skipKey = `${bill.billId}-${dateStr}`;
      
      // Skip if this bill occurrence is marked as skipped
      if (skippedBills.has(skipKey)) {
        return false;
      }
      
      // Deduplicate by billId + date
      const dedupKey = this.billOccurrenceKey(bill.billId, bill.date);
      if (seenBillKeys.has(dedupKey)) {
        return false;
      }
      seenBillKeys.add(dedupKey);
      return true;
    });

    const paycheckDates = this.getUniquePaycheckDates(allIncomes);
    
    const paychecks = this.assignBillsToPaychecks(
      paycheckDates,
      allIncomes,
      uniqueBills,
      startingBalance,
      endDate,
      skippedBills,
      manualAssignments,
      incomeAttachedBillsRaw,
      maxBudgetRemaining,
      goals,
      minCashOnHand,
      minSavingsPerPaycheck
    );

    // Calculate goal projections
    const goalProjections = this.calculateGoalProjections(
      goals,
      paychecks,
      format(endDate, 'yyyy-MM-dd'),
      minCashOnHand,
      minSavingsPerPaycheck
    );

    const fullSchedule: ScheduleData = {
      startDate: format(startDate, 'yyyy-MM-dd'),
      endDate: format(endDate, 'yyyy-MM-dd'),
      paychecks,
      fullPaychecks: paychecks,
      viewportMonths: SCHEDULE_CALCULATION_MONTHS,
      entries: this.convertToLegacyEntries(paychecks, startingBalance),
      summary: this.calculateSummary(paychecks, startingBalance, maxBudgetRemaining),
      recommendations: this.generateRecommendations(paychecks, bills, startingBalance),
      maxBudgetRemaining,
      goalProjections,
    };

    return this.applyViewportFilter(fullSchedule, months, bills, startingBalance);
  }

  /**
   * Lightweight goal projection path: initial bill assignment + funding priority only.
   * Skips ensemble rebalance (backtrack / micro-solver) used by generateSchedule.
   */
  generateGoalProjections(
    incomes: Income[],
    bills: Bill[],
    startDateStr: string,
    startingBalance: number,
    skippedBills: Set<string> = new Set(),
    manualAssignments: Map<string, string> = new Map(),
    maxBudgetRemaining: number = DEFAULT_TARGET_CASH_ON_HAND,
    goals: SavingsGoal[] = [],
    minCashOnHand: number = DEFAULT_MIN_CASH_ON_HAND,
    minSavingsPerPaycheck: number = 0,
    debtPayoffs: Map<string, DebtPayoffInfo> = new Map(),
    incomeOverrides: Map<string, number> = new Map()
  ): GoalProjection[] {
    if (goals.length === 0) {
      return [];
    }

    const startDate = startOfDay(parseISO(startDateStr));
    const endDate = addMonths(startDate, SCHEDULE_CALCULATION_MONTHS);

    const allIncomes: ProjectedIncome[] = [];
    for (const income of incomes) {
      allIncomes.push(...this.projectIncome(income, startDate, endDate));
    }

    for (const projected of allIncomes) {
      const key = `${projected.sourceId}-${format(projected.date, 'yyyy-MM-dd')}`;
      if (incomeOverrides.has(key)) {
        projected.amount = incomeOverrides.get(key)!;
      }
    }

    const incomeAttachedBillsRaw = bills.filter(b => b.isIncomeAttached && b.preferredIncomeSourceId);
    const regularBills = bills.filter(b => !b.isIncomeAttached);

    const allBills: ProjectedBill[] = [];
    for (const bill of regularBills) {
      const debtInfo = debtPayoffs.get(bill.id);
      allBills.push(...this.projectBills(bill, startDate, endDate, debtInfo));
    }

    allIncomes.sort((a, b) => a.date.getTime() - b.date.getTime());
    allBills.sort((a, b) => a.date.getTime() - b.date.getTime());

    const seenBillKeys = new Set<string>();
    const uniqueBills = allBills.filter(bill => {
      const dateStr = format(bill.date, 'yyyy-MM-dd');
      const skipKey = `${bill.billId}-${dateStr}`;
      if (skippedBills.has(skipKey)) {
        return false;
      }
      const dedupKey = this.billOccurrenceKey(bill.billId, bill.date);
      if (seenBillKeys.has(dedupKey)) {
        return false;
      }
      seenBillKeys.add(dedupKey);
      return true;
    });

    const paycheckDates = this.getUniquePaycheckDates(allIncomes);
    const { paycheckAssignments, manuallyAssignedBills } = this.buildInitialPaycheckAssignments(
      paycheckDates,
      allIncomes,
      uniqueBills,
      skippedBills,
      manualAssignments,
      incomeAttachedBillsRaw,
      goals,
      minCashOnHand,
      minSavingsPerPaycheck
    );

    const trial = this.clonePaycheckAssignments(paycheckAssignments);
    this.applyFundingPriority(
      trial,
      manuallyAssignedBills,
      goals,
      minCashOnHand,
      minSavingsPerPaycheck,
      'deficit_killer'
    );
    this.dedupeAssignmentBills(trial);
    const paychecks = this.buildPaycheckEntries(
      trial,
      startingBalance,
      maxBudgetRemaining,
      goals,
      minCashOnHand,
      minSavingsPerPaycheck
    );

    return this.calculateGoalProjections(
      goals,
      paychecks,
      format(endDate, 'yyyy-MM-dd'),
      minCashOnHand,
      minSavingsPerPaycheck
    );
  }

  /**
   * Slice a full 12-month schedule to the requested viewport without recalculating assignments.
   */
  applyViewportFilter(
    fullSchedule: ScheduleData,
    viewportMonths: number,
    bills: Bill[],
    startingBalance: number
  ): ScheduleData {
    if (viewportMonths >= SCHEDULE_CALCULATION_MONTHS) {
      return {
        ...fullSchedule,
        paychecks: fullSchedule.fullPaychecks,
        viewportMonths,
        entries: this.convertToLegacyEntries(fullSchedule.fullPaychecks, startingBalance),
        summary: this.calculateSummary(
          fullSchedule.fullPaychecks,
          startingBalance,
          fullSchedule.maxBudgetRemaining
        ),
        recommendations: this.generateRecommendations(
          fullSchedule.fullPaychecks,
          bills,
          startingBalance
        ),
      };
    }

    const viewportEndDate = startOfDay(
      addMonths(parseISO(fullSchedule.startDate), viewportMonths)
    );
    const viewportPaychecks = fullSchedule.fullPaychecks.filter((paycheck) => {
      const paycheckDate = startOfDay(parseISO(paycheck.date));
      return !isAfter(paycheckDate, viewportEndDate);
    });

    const viewportEnd = format(viewportEndDate, 'yyyy-MM-dd');

    return {
      ...fullSchedule,
      endDate: viewportEnd,
      paychecks: viewportPaychecks,
      viewportMonths,
      entries: this.convertToLegacyEntries(viewportPaychecks, startingBalance),
      summary: this.calculateSummary(
        viewportPaychecks,
        startingBalance,
        fullSchedule.maxBudgetRemaining
      ),
      recommendations: this.generateRecommendations(viewportPaychecks, bills, startingBalance),
    };
  }

  private getUniquePaycheckDates(incomes: ProjectedIncome[]): Date[] {
    const dateSet = new Set<number>();
    const dates: Date[] = [];
    
    for (const income of incomes) {
      const timestamp = income.date.getTime();
      if (!dateSet.has(timestamp)) {
        dateSet.add(timestamp);
        dates.push(income.date);
      }
    }
    
    return dates.sort((a, b) => a.getTime() - b.getTime());
  }

  private billOccurrenceKey(billId: string, date: Date): string {
    return `${billId}-${format(date, 'yyyy-MM-dd')}`;
  }

  private buildPaycheckPressureSnapshot(
    paycheck: { date: Date; incomes: ProjectedIncome[]; bills: ProjectedBill[] },
    paycheckIndex: number,
    goalReservePerPaycheck: number[]
  ): { billLoadRatio: number; goalReserve: number; income: number; billTotal: number } {
    const income = paycheck.incomes.reduce((sum, inc) => sum + inc.amount, 0);
    const billTotal = paycheck.bills
      .filter(b => !b.isUnpayable)
      .reduce((sum, bill) => sum + bill.amount, 0);
    const billLoadRatio = income > 0 ? billTotal / income : billTotal > 0 ? 2 : 0;
    const goalReserve = goalReservePerPaycheck[paycheckIndex] ?? 0;
    return { billLoadRatio, goalReserve, income, billTotal };
  }

  private scoreEligiblePaycheck(
    daysEarly: number,
    pressure: { billLoadRatio: number; goalReserve: number; income: number; billTotal: number },
    billAmount: number,
    minCashOnHand: number,
    minSavingsPerPaycheck: number
  ): number {
    return scoreEligiblePaycheckUtil(
      daysEarly,
      pressure,
      billAmount,
      minCashOnHand,
      minSavingsPerPaycheck
    );
  }

  private findScoredAutomaticPaycheck(
    bill: ProjectedBill,
    paycheckAssignments: { date: Date; incomes: ProjectedIncome[]; bills: ProjectedBill[] }[],
    skippedBills: Set<string>,
    goals: SavingsGoal[],
    minCashOnHand: number,
    minSavingsPerPaycheck: number
  ): string | null {
    const goalReservePerPaycheck = this.buildGoalReservePerPaycheck(paycheckAssignments, goals);
    let bestPaycheck: { date: Date; incomes: ProjectedIncome[]; bills: ProjectedBill[] } | null = null;
    let bestScore = -Infinity;

    for (let i = 0; i < paycheckAssignments.length; i++) {
      const paycheck = paycheckAssignments[i];
      const paycheckDateStr = format(paycheck.date, 'yyyy-MM-dd');

      const skipKey = `${bill.billId}-${paycheckDateStr}`;
      if (skippedBills.has(skipKey)) continue;

      if (isAfter(paycheck.date, bill.date)) continue;

      const daysEarly = differenceInDays(bill.date, paycheck.date);
      if (daysEarly > MAX_PREPAY_DAYS) continue;

      const pressure = this.buildPaycheckPressureSnapshot(paycheck, i, goalReservePerPaycheck);
      const score = this.scoreEligiblePaycheck(
        daysEarly,
        pressure,
        bill.amount,
        minCashOnHand,
        minSavingsPerPaycheck
      );

      if (score > bestScore) {
        bestScore = score;
        bestPaycheck = paycheck;
      }
    }

    return bestPaycheck ? format(bestPaycheck.date, 'yyyy-MM-dd') : null;
  }

  private findPreferredPaycheck(
    bill: ProjectedBill,
    paycheckAssignments: { date: Date; incomes: ProjectedIncome[]; bills: ProjectedBill[] }[],
    skippedBills: Set<string>
  ): string | null {
    if (!bill.preferredIncomeSourceId) return null;

    // Find paychecks that have the preferred income source
    const matchingPaychecks = paycheckAssignments.filter(p =>
      p.incomes.some(inc => inc.sourceId === bill.preferredIncomeSourceId)
    );

    if (matchingPaychecks.length === 0) return null;

    // Find the best paycheck: closest to bill due date, but not more than MAX_PREPAY_DAYS early
    let bestPaycheck: { date: Date; incomes: ProjectedIncome[]; bills: ProjectedBill[] } | null = null;
    let bestDistance = Infinity;

    for (const paycheck of matchingPaychecks) {
      const paycheckDateStr = format(paycheck.date, 'yyyy-MM-dd');
      
      // Check if skipped
      const skipKey = `${bill.billId}-${paycheckDateStr}`;
      if (skippedBills.has(skipKey)) continue;

      // Paycheck must be on or before the bill due date
      if (isAfter(paycheck.date, bill.date)) continue;

      // Paycheck must not be more than MAX_PREPAY_DAYS before the bill due date
      const daysEarly = differenceInDays(bill.date, paycheck.date);
      if (daysEarly > MAX_PREPAY_DAYS) continue;

      // Prefer the paycheck closest to the due date
      if (daysEarly < bestDistance) {
        bestDistance = daysEarly;
        bestPaycheck = paycheck;
      }
    }

    return bestPaycheck ? format(bestPaycheck.date, 'yyyy-MM-dd') : null;
  }

  private clonePaycheckAssignments(
    assignments: { date: Date; incomes: ProjectedIncome[]; bills: ProjectedBill[] }[]
  ): { date: Date; incomes: ProjectedIncome[]; bills: ProjectedBill[] }[] {
    return assignments.map((assignment) => ({
      date: assignment.date,
      incomes: [...assignment.incomes],
      bills: assignment.bills.map((bill) => ({
        ...bill,
        date: new Date(bill.date.getTime()),
      })),
    }));
  }

  private dedupeAssignmentBills(
    assignments: { date: Date; incomes: ProjectedIncome[]; bills: ProjectedBill[] }[]
  ): void {
    for (const assignment of assignments) {
      const seen = new Set<string>();
      assignment.bills = assignment.bills.filter((bill) => {
        const key = this.billOccurrenceKey(bill.billId, bill.date);
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
    }
  }

  private calculateScheduleScore(paychecks: PaycheckEntry[], goals: SavingsGoal[]): number {
    let totalDaysEarly = 0;
    for (const paycheck of paychecks) {
      for (const bill of paycheck.bills) {
        totalDaysEarly += differenceInDays(parseISO(bill.billDate), parseISO(paycheck.date));
      }
    }

    const shortfallCount = paychecks.filter((p) => p.isShortfall).length;
    const totalDeficit = paychecks
      .filter((p) => p.isShortfall)
      .reduce((sum, p) => sum + Math.abs(p.budgetRemaining), 0);
    const criticalUnpayable = paychecks.reduce(
      (sum, p) => sum + p.bills.filter((b) => b.priority === 'critical' && b.isUnpayable).length,
      0
    );
    const tightPaycheckCount = paychecks.filter(
      (p) => !p.isShortfall && p.totalBills > p.totalIncome * 0.9 && p.savingsDeposit === 0
    ).length;

    let goalProgressRatio = 0;
    for (const goal of goals) {
      const remaining = goal.targetAmount - goal.alreadySaved;
      if (remaining <= 0) continue;
      const deposited = paychecks.reduce(
        (sum, p) => sum + (p.goalDeposits.find((d) => d.goalId === goal.id)?.amount ?? 0),
        0
      );
      goalProgressRatio += deposited / remaining;
    }

    return (
      -1000 * shortfallCount -
      100 * totalDeficit -
      10 * criticalUnpayable -
      totalDaysEarly -
      0.3 * tightPaycheckCount +
      0.2 * goalProgressRatio
    );
  }

  private buildInitialPaycheckAssignments(
    paycheckDates: Date[],
    allIncomes: ProjectedIncome[],
    allBills: ProjectedBill[],
    skippedBills: Set<string>,
    manualAssignments: Map<string, string>,
    incomeAttachedBillsRaw: Bill[],
    goals: SavingsGoal[],
    minCashOnHand: number,
    minSavingsPerPaycheck: number
  ): {
    paycheckAssignments: { date: Date; incomes: ProjectedIncome[]; bills: ProjectedBill[] }[];
    manuallyAssignedBills: Set<string>;
  } {
    const paycheckAssignments: {
      date: Date;
      incomes: ProjectedIncome[];
      bills: ProjectedBill[];
    }[] = [];

    const manuallyAssignedBills = new Set<string>();

    for (let i = 0; i < paycheckDates.length; i++) {
      const paycheckDate = paycheckDates[i];
      const incomesOnDate = allIncomes.filter(inc =>
        isEqual(inc.date, paycheckDate)
      );
      paycheckAssignments.push({
        date: paycheckDate,
        incomes: incomesOnDate,
        bills: [],
      });
    }

    for (const bill of allBills) {
      const billDateStr = format(bill.date, 'yyyy-MM-dd');
      const assignmentKey = `${bill.billId}-${billDateStr}`;
      const targetPaycheckDate = manualAssignments.get(assignmentKey);

      if (targetPaycheckDate) {
        const skipKey = `${bill.billId}-${targetPaycheckDate}`;
        if (skippedBills.has(skipKey)) continue;

        const paycheckIdx = paycheckAssignments.findIndex(
          p => format(p.date, 'yyyy-MM-dd') === targetPaycheckDate
        );
        if (paycheckIdx !== -1) {
          paycheckAssignments[paycheckIdx].bills.push(bill);
          manuallyAssignedBills.add(this.billOccurrenceKey(bill.billId, bill.date));
        }
      }
    }

    const remainingBills = allBills.filter(b =>
      !manuallyAssignedBills.has(this.billOccurrenceKey(b.billId, b.date))
    );

    const billsWithPreference = remainingBills.filter(b => b.preferredIncomeSourceId);
    const regularBills = remainingBills.filter(b => !b.preferredIncomeSourceId);
    const assignedPreferenceBills = new Set<string>();

    for (const bill of incomeAttachedBillsRaw) {
      for (const paycheck of paycheckAssignments) {
        const hasMatchingIncome = paycheck.incomes.some(
          inc => inc.sourceId === bill.preferredIncomeSourceId
        );

        if (hasMatchingIncome) {
          const paycheckDateStr = format(paycheck.date, 'yyyy-MM-dd');
          const skipKey = `${bill.id}-${paycheckDateStr}`;

          if (!skippedBills.has(skipKey)) {
            paycheck.bills.push({
              date: paycheck.date,
              billId: bill.id,
              creditorName: bill.creditorName,
              amount: bill.budgetedAmount,
              dueDay: bill.dueDay,
              priority: bill.priority,
              category: bill.category,
              preferredIncomeSourceId: bill.preferredIncomeSourceId,
              isIncomeAttached: true,
            });
          }
        }
      }
    }

    for (const bill of billsWithPreference) {
      const paycheckDateStr = this.findPreferredPaycheck(
        bill,
        paycheckAssignments,
        skippedBills
      );

      if (paycheckDateStr) {
        const paycheckIdx = paycheckAssignments.findIndex(
          p => format(p.date, 'yyyy-MM-dd') === paycheckDateStr
        );
        if (paycheckIdx !== -1) {
          paycheckAssignments[paycheckIdx].bills.push(bill);
          assignedPreferenceBills.add(this.billOccurrenceKey(bill.billId, bill.date));
        }
      }
    }

    for (const bill of regularBills) {
      const billKey = this.billOccurrenceKey(bill.billId, bill.date);
      if (assignedPreferenceBills.has(billKey)) continue;

      const paycheckDateStr = this.findScoredAutomaticPaycheck(
        bill,
        paycheckAssignments,
        skippedBills,
        goals,
        minCashOnHand,
        minSavingsPerPaycheck
      );

      if (paycheckDateStr) {
        const paycheckIdx = paycheckAssignments.findIndex(
          p => format(p.date, 'yyyy-MM-dd') === paycheckDateStr
        );
        if (paycheckIdx !== -1) {
          paycheckAssignments[paycheckIdx].bills.push(bill);
        }
      }
    }

    for (const assignment of paycheckAssignments) {
      assignment.bills.sort((a, b) => {
        return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      });
    }

    return { paycheckAssignments, manuallyAssignedBills };
  }

  private assignBillsToPaychecks(
    paycheckDates: Date[],
    allIncomes: ProjectedIncome[],
    allBills: ProjectedBill[],
    startingBalance: number,
    endDate: Date,
    skippedBills: Set<string> = new Set(),
    manualAssignments: Map<string, string> = new Map(),
    incomeAttachedBillsRaw: Bill[] = [],
    maxBudgetRemaining: number = DEFAULT_TARGET_CASH_ON_HAND,
    goals: SavingsGoal[] = [],
    minCashOnHand: number = DEFAULT_MIN_CASH_ON_HAND,
    minSavingsPerPaycheck: number = 0
  ): PaycheckEntry[] {
    const { paycheckAssignments, manuallyAssignedBills } = this.buildInitialPaycheckAssignments(
      paycheckDates,
      allIncomes,
      allBills,
      skippedBills,
      manualAssignments,
      incomeAttachedBillsRaw,
      goals,
      minCashOnHand,
      minSavingsPerPaycheck
    );

    const assignmentSnapshot = this.clonePaycheckAssignments(paycheckAssignments);
    let bestPaychecks: PaycheckEntry[] = [];
    let bestScore = -Infinity;

    for (const strategy of REBALANCE_STRATEGIES) {
      const trial = this.clonePaycheckAssignments(assignmentSnapshot);
      this.rebalanceBills(
        trial,
        manuallyAssignedBills,
        goals,
        minCashOnHand,
        minSavingsPerPaycheck,
        strategy
      );
      this.applyFundingPriority(
        trial,
        manuallyAssignedBills,
        goals,
        minCashOnHand,
        minSavingsPerPaycheck,
        strategy
      );
      this.dedupeAssignmentBills(trial);
      const paychecks = this.buildPaycheckEntries(
        trial,
        startingBalance,
        maxBudgetRemaining,
        goals,
        minCashOnHand,
        minSavingsPerPaycheck
      );
      const score = this.calculateScheduleScore(paychecks, goals);
      if (score > bestScore) {
        bestScore = score;
        bestPaychecks = paychecks;
      }
    }

    return bestPaychecks;
  }

  private buildGoalReservePerPaycheck(
    assignments: { date: Date; incomes: ProjectedIncome[]; bills: ProjectedBill[] }[],
    goals: SavingsGoal[]
  ): number[] {
    const reserves = new Array(assignments.length).fill(0);
    if (goals.length === 0) {
      return reserves;
    }

    const requirements = this.calculateGoalRequirementsPerPaycheck(goals, assignments);

    for (let i = 0; i < assignments.length; i++) {
      const paycheckDate = assignments[i].date;
      for (const goal of goals) {
        if (goal.targetAmount - goal.alreadySaved <= 0) {
          continue;
        }
        const goalDate = parseISO(goal.targetDate);
        if (isAfter(paycheckDate, goalDate)) {
          continue;
        }
        reserves[i] += requirements.get(goal.id) ?? 0;
      }
    }

    return reserves;
  }

  // Type for rebalance helper functions (passed to phase methods)
  private createRebalanceHelpers(
    assignments: { date: Date; incomes: ProjectedIncome[]; bills: ProjectedBill[] }[],
    lockedBills: Set<string> = new Set(),
    poolOptions: {
      minCashOnHand: number;
      minSavingsPerPaycheck: number;
      goalReservePerPaycheck: number[];
    },
    strategy: RebalanceStrategy = 'deficit_killer'
  ) {
    const { minCashOnHand, minSavingsPerPaycheck, goalReservePerPaycheck } = poolOptions;

    const getBillTotal = (index: number): number =>
      assignments[index].bills
        .filter(b => !b.isUnpayable)
        .reduce((sum, bill) => sum + bill.amount, 0);

    const getIncome = (index: number): number =>
      assignments[index].incomes.reduce((sum, inc) => sum + inc.amount, 0);

    const getBalance = (index: number): number => getIncome(index) - getBillTotal(index);

    /** Income minus bills and all three-pool commitments for this paycheck silo. */
    const getAvailableAfterCommitments = (index: number): number => {
      const goalReserve = goalReservePerPaycheck[index] ?? 0;
      return (
        getIncome(index) -
        getBillTotal(index) -
        minCashOnHand -
        minSavingsPerPaycheck -
        goalReserve
      );
    };

    const getSurplus = (index: number): number => {
      return Math.max(0, getAvailableAfterCommitments(index));
    };

    const getDeficit = (index: number): number => {
      return Math.max(0, -getAvailableAfterCommitments(index));
    };

    const getTotalDeficit = (): number => {
      return assignments.reduce((sum, _, i) => sum + getDeficit(i), 0);
    };

    const moveBill = (fromIdx: number, toIdx: number, bill: ProjectedBill): boolean => {
      const billKey = this.billOccurrenceKey(bill.billId, bill.date);
      if (lockedBills.has(billKey) || bill.isIncomeAttached) {
        return false;
      }

      const targetPaycheckDate = assignments[toIdx].date;
      const billDueDate = bill.date;
      const daysEarly = differenceInDays(billDueDate, targetPaycheckDate);
      
      if (daysEarly > MAX_PREPAY_DAYS) {
        return false;
      }
      
      const billIndex = assignments[fromIdx].bills.findIndex(b => 
        b.billId === bill.billId && 
        b.date.getTime() === bill.date.getTime() &&
        b.amount === bill.amount
      );
      
      if (billIndex === -1) {
        return false;
      }
      
      const alreadyInTarget = assignments[toIdx].bills.some(b =>
        b.billId === bill.billId && 
        b.date.getTime() === bill.date.getTime() &&
        b.amount === bill.amount
      );
      
      if (alreadyInTarget) {
        assignments[fromIdx].bills.splice(billIndex, 1);
        return true;
      }
      
      const [movedBill] = assignments[fromIdx].bills.splice(billIndex, 1);
      assignments[toIdx].bills.push(movedBill);
      return true;
    };

    const getMovableBills = (index: number): ProjectedBill[] => {
      const bills = [...assignments[index].bills].filter(
        (b) => !b.isIncomeAttached && !b.isUnpayable
      );

      if (strategy === 'prepay_minimizer') {
        return bills.sort((a, b) => {
          const daysEarlyA = differenceInDays(a.date, assignments[index].date);
          const daysEarlyB = differenceInDays(b.date, assignments[index].date);
          return daysEarlyA - daysEarlyB;
        });
      }

      if (strategy === 'goal_guardian') {
        return bills.sort((a, b) => {
          const priorityDiff = PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority];
          if (priorityDiff !== 0) return priorityDiff;
          return a.amount - b.amount;
        });
      }

      return bills.sort((a, b) => {
        const priorityDiff = PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority];
        if (priorityDiff !== 0) return priorityDiff;
        return b.amount - a.amount;
      });
    };

    return { getBalance, getSurplus, getDeficit, getTotalDeficit, moveBill, getMovableBills };
  }

  private rebalancePhase1_DirectMoves(
    assignments: { date: Date; incomes: ProjectedIncome[]; bills: ProjectedBill[] }[],
    helpers: ReturnType<typeof this.createRebalanceHelpers>
  ): void {
    const { getSurplus, getDeficit, getTotalDeficit, moveBill, getMovableBills } = helpers;
    let maxPasses = 200;
    let madeProgress = true;

    while (madeProgress && maxPasses > 0 && getTotalDeficit() > 0) {
      madeProgress = false;
      maxPasses--;

      for (let i = assignments.length - 1; i >= 0; i--) {
        const deficitAmount = getDeficit(i);
        if (deficitAmount <= 0) continue;

        const movableBills = getMovableBills(i).sort((a, b) => {
          const aFit = Math.abs(a.amount - deficitAmount);
          const bFit = Math.abs(b.amount - deficitAmount);
          if (aFit !== bFit) return aFit - bFit;
          return PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority];
        });

        for (const bill of movableBills) {
          let bestJ = -1;
          let bestSurplus = Infinity;

          for (let j = i - 1; j >= 0; j--) {
            const surplus = getSurplus(j);
            if (surplus >= bill.amount && surplus < bestSurplus) {
              bestSurplus = surplus;
              bestJ = j;
            }
          }

          if (bestJ !== -1 && moveBill(i, bestJ, bill)) {
            madeProgress = true;
          }

          if (getDeficit(i) === 0) break;
        }
      }
    }
  }

  private rebalancePhase2_CascadeMoves(
    assignments: { date: Date; incomes: ProjectedIncome[]; bills: ProjectedBill[] }[],
    helpers: ReturnType<typeof this.createRebalanceHelpers>
  ): void {
    const { getSurplus, getDeficit, getTotalDeficit, moveBill, getMovableBills } = helpers;
    let maxPasses = 200;
    let madeProgress = true;

    while (madeProgress && maxPasses > 0 && getTotalDeficit() > 0) {
      madeProgress = false;
      maxPasses--;

      for (let deficitIdx = assignments.length - 1; deficitIdx >= 0; deficitIdx--) {
        if (getDeficit(deficitIdx) === 0) continue;

        for (let midIdx = deficitIdx - 1; midIdx >= 1; midIdx--) {
          const midMovable = getMovableBills(midIdx);
          
          for (const midBill of midMovable) {
            let bestEarlyIdx = -1;
            let bestSurplus = Infinity;

            for (let earlyIdx = midIdx - 1; earlyIdx >= 0; earlyIdx--) {
              const surplus = getSurplus(earlyIdx);
              if (surplus >= midBill.amount && surplus < bestSurplus) {
                bestSurplus = surplus;
                bestEarlyIdx = earlyIdx;
              }
            }

            if (bestEarlyIdx !== -1 && moveBill(midIdx, bestEarlyIdx, midBill)) {
              madeProgress = true;

              const newCapacity = getSurplus(midIdx);
              const deficitBills = getMovableBills(deficitIdx).sort((a, b) => {
                const deficitAmount = getDeficit(deficitIdx);
                return Math.abs(a.amount - deficitAmount) - Math.abs(b.amount - deficitAmount);
              });

              for (const defBill of deficitBills) {
                if (newCapacity >= defBill.amount && moveBill(deficitIdx, midIdx, defBill)) {
                  break;
                }
              }
            }

            if (getDeficit(deficitIdx) === 0) break;
          }
          if (getDeficit(deficitIdx) === 0) break;
        }
      }
    }
  }

  private rebalancePhase3_DeepCascade(
    assignments: { date: Date; incomes: ProjectedIncome[]; bills: ProjectedBill[] }[],
    helpers: ReturnType<typeof this.createRebalanceHelpers>
  ): void {
    const { getSurplus, getDeficit, getTotalDeficit, moveBill, getMovableBills } = helpers;
    let maxPasses = 100;
    let madeProgress = true;

    while (madeProgress && maxPasses > 0 && getTotalDeficit() > 0) {
      madeProgress = false;
      maxPasses--;

      for (let deficitIdx = assignments.length - 1; deficitIdx >= 0; deficitIdx--) {
        const deficit = getDeficit(deficitIdx);
        if (deficit === 0) continue;

        const deficitBills = getMovableBills(deficitIdx);
        
        for (const targetBill of deficitBills) {
          for (let midIdx = deficitIdx - 1; midIdx >= 0; midIdx--) {
            const currentCapacity = getSurplus(midIdx);
            const needed = targetBill.amount - currentCapacity;
            
            if (needed <= 0) {
              if (moveBill(deficitIdx, midIdx, targetBill)) {
                madeProgress = true;
                break;
              }
            } else if (midIdx > 0) {
              const midBills = getMovableBills(midIdx)
                .filter(b => b.amount <= needed + 50);
              
              let freedAmount = 0;
              const billsToMove: { bill: ProjectedBill; to: number }[] = [];
              
              for (const midBill of midBills) {
                for (let earlyIdx = midIdx - 1; earlyIdx >= 0; earlyIdx--) {
                  if (getSurplus(earlyIdx) >= midBill.amount) {
                    billsToMove.push({ bill: midBill, to: earlyIdx });
                    freedAmount += midBill.amount;
                    break;
                  }
                }
                if (freedAmount >= needed) break;
              }

              if (freedAmount >= needed) {
                for (const move of billsToMove) {
                  moveBill(midIdx, move.to, move.bill);
                }
                if (getSurplus(midIdx) >= targetBill.amount) {
                  moveBill(deficitIdx, midIdx, targetBill);
                  madeProgress = true;
                  break;
                }
              }
            }
          }
          if (madeProgress) break;
        }
        if (madeProgress) break;
      }
    }
  }

  private rebalancePhase4_EvenOut(
    assignments: { date: Date; incomes: ProjectedIncome[]; bills: ProjectedBill[] }[],
    helpers: ReturnType<typeof this.createRebalanceHelpers>,
    minCashOnHand: number
  ): void {
    const { getBalance, getSurplus, moveBill, getMovableBills } = helpers;
    let maxPasses = 50;
    let madeProgress = true;

    while (madeProgress && maxPasses > 0) {
      madeProgress = false;
      maxPasses--;

      for (let i = 1; i < assignments.length; i++) {
        const balance = getBalance(i);
        
        if (balance >= minCashOnHand && balance < minCashOnHand * 3) {
          const movableBills = getMovableBills(i);

          for (const bill of movableBills) {
            for (let j = i - 1; j >= 0; j--) {
              if (getSurplus(j) >= bill.amount + minCashOnHand) {
                if (moveBill(i, j, bill)) {
                  madeProgress = true;
                  break;
                }
              }
            }
            if (madeProgress) break;
          }
        }
        if (madeProgress) break;
      }
    }
  }

  private rebalanceBacktrackSearch(
    assignments: { date: Date; incomes: ProjectedIncome[]; bills: ProjectedBill[] }[],
    helpers: ReturnType<typeof this.createRebalanceHelpers>,
    maxDepth = 4
  ): void {
    const { getTotalDeficit, getDeficit, getSurplus, moveBill, getMovableBills } = helpers;

    for (let depth = 0; depth < maxDepth && getTotalDeficit() > 0; depth++) {
      let madeProgress = false;

      for (let i = assignments.length - 1; i >= 0; i--) {
        if (getDeficit(i) <= 0) continue;

        for (const bill of getMovableBills(i)) {
          for (let j = i - 1; j >= 0; j--) {
            if (getSurplus(j) >= bill.amount && moveBill(i, j, bill)) {
              madeProgress = true;
              break;
            }
          }
          if (getDeficit(i) === 0) break;
        }
        if (madeProgress) break;
      }

      if (!madeProgress) break;
    }
  }

  private rebalanceMicroSolver(
    assignments: { date: Date; incomes: ProjectedIncome[]; bills: ProjectedBill[] }[],
    helpers: ReturnType<typeof this.createRebalanceHelpers>
  ): void {
    const { getDeficit, getTotalDeficit, getSurplus, moveBill, getMovableBills } = helpers;

    if (getTotalDeficit() <= 0) {
      return;
    }

    let madeProgress = true;
    while (madeProgress && getTotalDeficit() > 0) {
      madeProgress = false;

      for (let i = assignments.length - 1; i >= 0; i--) {
        const deficitAmount = getDeficit(i);
        if (deficitAmount <= 0) continue;

        const movableBills = getMovableBills(i);
        if (movableBills.length === 0) continue;

        const earlierPaychecks = assignments.slice(0, i).map((assignment, index) => ({
          index,
          dateMs: assignment.date.getTime(),
          surplus: getSurplus(index),
        }));

        const solverBills = movableBills.map((bill) => ({
          key: this.billOccurrenceKey(bill.billId, bill.date),
          amount: bill.amount,
          dueDateMs: bill.date.getTime(),
        }));

        const plan = solvePaycheckDeficit(
          i,
          deficitAmount,
          earlierPaychecks,
          solverBills,
          MAX_PREPAY_DAYS,
          MICRO_SOLVER_MAX_BILLS
        );

        if (!plan || plan.moves.length === 0) {
          continue;
        }

        const billByKey = new Map(
          movableBills.map((bill) => [this.billOccurrenceKey(bill.billId, bill.date), bill])
        );

        for (const move of plan.moves) {
          const bill = billByKey.get(move.billKey);
          if (bill && moveBill(i, move.toIndex, bill)) {
            madeProgress = true;
          }
        }
      }
    }
  }

  private diagnoseUnfundableReason(
    paycheckIndex: number,
    bill: ProjectedBill,
    assignments: { date: Date; incomes: ProjectedIncome[]; bills: ProjectedBill[] }[],
    lockedBills: Set<string>,
    minCashOnHand: number,
    minSavingsPerPaycheck: number,
    goalReservePerPaycheck: number[]
  ): UnfundableReason {
    const income = assignments[paycheckIndex].incomes.reduce((sum, inc) => sum + inc.amount, 0);
    const billTotal = assignments[paycheckIndex].bills
      .filter((b) => !b.isUnpayable)
      .reduce((sum, b) => sum + b.amount, 0);
    const goalReserve = goalReservePerPaycheck[paycheckIndex] ?? 0;

    if (income < billTotal + minCashOnHand + minSavingsPerPaycheck + goalReserve) {
      if (goalReserve > 0 && income >= billTotal + minCashOnHand + minSavingsPerPaycheck) {
        return 'goal_reserve_conflict';
      }
      return 'insufficient_income_this_paycheck';
    }

    let hasEligibleEarlier = false;
    let hasUnlockedEligibleMove = false;
    const billKey = this.billOccurrenceKey(bill.billId, bill.date);

    for (let j = paycheckIndex - 1; j >= 0; j--) {
      const paycheckDate = assignments[j].date;
      if (isAfter(paycheckDate, bill.date)) continue;
      const daysEarly = differenceInDays(bill.date, paycheckDate);
      if (daysEarly > MAX_PREPAY_DAYS) continue;

      const targetIncome = assignments[j].incomes.reduce((sum, inc) => sum + inc.amount, 0);
      const targetBills = assignments[j].bills
        .filter((b) => !b.isUnpayable)
        .reduce((sum, b) => sum + b.amount, 0);
      const targetGoalReserve = goalReservePerPaycheck[j] ?? 0;
      const headroom =
        targetIncome -
        targetBills -
        minCashOnHand -
        minSavingsPerPaycheck -
        targetGoalReserve;

      if (headroom >= bill.amount) {
        hasEligibleEarlier = true;
        if (!lockedBills.has(billKey) && !bill.isIncomeAttached) {
          hasUnlockedEligibleMove = true;
        }
      }
    }

    if (!hasEligibleEarlier) {
      return 'no_eligible_earlier_paycheck';
    }
    if (!hasUnlockedEligibleMove) {
      return 'all_movable_bills_locked';
    }
    return 'insufficient_income_this_paycheck';
  }

  private rebalanceFinalCleanup(
    assignments: { date: Date; incomes: ProjectedIncome[]; bills: ProjectedBill[] }[]
  ): void {
    // Deduplicate bills across all paychecks
    const seenBills = new Set<string>();
    for (const assignment of assignments) {
      assignment.bills = assignment.bills.filter(bill => {
        const key = this.billOccurrenceKey(bill.billId, bill.date);
        if (seenBills.has(key)) {
          return false;
        }
        seenBills.add(key);
        return true;
      });
    }

    // Re-sort bills by priority
    for (const assignment of assignments) {
      assignment.bills.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
    }
  }

  private rebalanceBills(
    assignments: { date: Date; incomes: ProjectedIncome[]; bills: ProjectedBill[] }[],
    lockedBills: Set<string> = new Set(),
    goals: SavingsGoal[] = [],
    minCashOnHand: number = DEFAULT_MIN_CASH_ON_HAND,
    minSavingsPerPaycheck: number = 0,
    strategy: RebalanceStrategy = 'deficit_killer'
  ): void {
    const goalReservePerPaycheck = this.buildGoalReservePerPaycheck(assignments, goals);
    const poolOptions = { minCashOnHand, minSavingsPerPaycheck, goalReservePerPaycheck };
    const helpers = this.createRebalanceHelpers(assignments, lockedBills, poolOptions, strategy);
    
    // Phase 1: Direct moves - move bills from deficit to surplus paychecks
    this.rebalancePhase1_DirectMoves(assignments, helpers);
    
    // Phase 2: Cascade moves - create capacity by moving bills between non-deficit paychecks
    this.rebalancePhase2_CascadeMoves(assignments, helpers);
    
    // Phase 3: Deep cascade - try moving smaller bills to create room for larger ones
    this.rebalancePhase3_DeepCascade(assignments, helpers);
    
    // Phase 4: Even out paychecks for better breathing room
    this.rebalancePhase4_EvenOut(assignments, helpers, minCashOnHand);

    // Phase 5: Bounded backtrack search when deficits remain
    this.rebalanceBacktrackSearch(assignments, helpers);

    // Phase 6: Exact micro-solver for stubborn single-paycheck deficits
    this.rebalanceMicroSolver(assignments, helpers);
    
    // Final cleanup: deduplicate and sort
    this.rebalanceFinalCleanup(assignments);
  }

  private applyFundingPriority(
    assignments: { date: Date; incomes: ProjectedIncome[]; bills: ProjectedBill[] }[],
    lockedBills: Set<string> = new Set(),
    goals: SavingsGoal[] = [],
    minCashOnHand: number = DEFAULT_MIN_CASH_ON_HAND,
    minSavingsPerPaycheck: number = 0,
    strategy: RebalanceStrategy = 'deficit_killer'
  ): void {
    const goalReservePerPaycheck = this.buildGoalReservePerPaycheck(assignments, goals);
    const poolOptions = { minCashOnHand, minSavingsPerPaycheck, goalReservePerPaycheck };
    const helpers = this.createRebalanceHelpers(assignments, lockedBills, poolOptions, strategy);
    const { getDeficit, getSurplus, moveBill, getMovableBills } = helpers;

    // Retry prepay moves after rebalance
    let maxPasses = 200;
    let madeProgress = true;
    while (madeProgress && maxPasses > 0) {
      madeProgress = false;
      maxPasses--;

      for (let i = assignments.length - 1; i >= 0; i--) {
        if (getDeficit(i) <= 0) continue;

        const movableBills = getMovableBills(i);
        for (const bill of movableBills) {
          for (let j = i - 1; j >= 0; j--) {
            if (getSurplus(j) >= bill.amount) {
              if (moveBill(i, j, bill)) {
                madeProgress = true;
                break;
              }
            }
          }
          if (madeProgress) break;
          if (getDeficit(i) === 0) break;
        }
        if (madeProgress) break;
      }
    }

    // Triage unfundable bills: Low → Normal → High (Critical never dropped)
    const triageTiers: Array<'low' | 'normal' | 'high'> = ['low', 'normal', 'high'];

    for (let i = 0; i < assignments.length; i++) {
      for (const tier of triageTiers) {
        while (getDeficit(i) > 0) {
          const billToDrop = assignments[i].bills.find(
            b => b.priority === tier && !b.isUnpayable && !b.isIncomeAttached
          );
          if (!billToDrop) break;
          billToDrop.unfundableReason = this.diagnoseUnfundableReason(
            i,
            billToDrop,
            assignments,
            lockedBills,
            minCashOnHand,
            minSavingsPerPaycheck,
            goalReservePerPaycheck
          );
          billToDrop.isUnpayable = true;
        }
      }
    }
  }

  private buildPaycheckEntries(
    assignments: { date: Date; incomes: ProjectedIncome[]; bills: ProjectedBill[] }[],
    startingBalance: number,
    maxBudgetRemaining: number = DEFAULT_TARGET_CASH_ON_HAND,
    goals: SavingsGoal[] = [],
    minCashOnHand: number = DEFAULT_MIN_CASH_ON_HAND,
    minSavingsPerPaycheck: number = 0
  ): PaycheckEntry[] {
    const paychecks: PaycheckEntry[] = [];
    let totalSavings = 0;

    // Track cumulative progress for each goal (for glide-path allocation)
    const goalProgress = new Map<string, number>();
    for (const goal of goals) {
      goalProgress.set(goal.id, goal.alreadySaved);
    }

    // Calculate glide-path expected progress for each goal at each paycheck
    const goalGlidePaths = new Map<string, Map<string, number>>();
    for (const goal of goals) {
      const remainingAmount = goal.targetAmount - goal.alreadySaved;
      if (remainingAmount <= 0) continue;

      const goalDate = parseISO(goal.targetDate);
      const relevantAssignments = assignments.filter(a => 
        isBefore(a.date, goalDate) || isEqual(a.date, goalDate)
      );

      if (relevantAssignments.length === 0) continue;

      const idealPerPaycheck = remainingAmount / relevantAssignments.length;
      const glidePath = new Map<string, number>();
      
      for (let i = 0; i < relevantAssignments.length; i++) {
        const dateStr = format(relevantAssignments[i].date, 'yyyy-MM-dd');
        glidePath.set(dateStr, goal.alreadySaved + (idealPerPaycheck * (i + 1)));
      }
      
      goalGlidePaths.set(goal.id, glidePath);
    }

    for (let assignmentIndex = 0; assignmentIndex < assignments.length; assignmentIndex++) {
      const assignment = assignments[assignmentIndex];
      // Deduplicate bills by billId+date (keep first occurrence)
      const seenBills = new Set<string>();
      const uniqueBills = assignment.bills.filter(bill => {
        const key = this.billOccurrenceKey(bill.billId, bill.date);
        if (seenBills.has(key)) {
          return false;
        }
        seenBills.add(key);
        return true;
      });
      
      const totalIncome = assignment.incomes.reduce((sum, inc) => sum + inc.amount, 0);
      const fundedBills = uniqueBills.filter(bill => !bill.isUnpayable);
      const totalBillsAmount = fundedBills.reduce((sum, bill) => sum + bill.amount, 0);
      const hasUnpayableBills = uniqueBills.some(bill => bill.isUnpayable);

      // Each paycheck is standalone: income - bills. Starting checking balance applies only
      // to the first paycheck (cash on hand at schedule start; no cross-paycheck carry).
      const ledgerBoost = assignmentIndex === 0 ? startingBalance : 0;
      let budgetRemaining = totalIncome - totalBillsAmount + ledgerBoost;
      const paycheckDateStr = format(assignment.date, 'yyyy-MM-dd');

      // GLIDE-PATH ALLOCATION ALGORITHM:
      // Bills must be fully funded before any savings or goal deposits.
      // 1. Calculate available surplus above minimum cash on hand
      // 2. Minimum savings gets first priority
      // 3. Goals get allocated using glide-path multipliers
      // 4. Any remainder goes to additional savings

      const goalDeposits: GoalDeposit[] = [];
      let totalGoalDeposits = 0;
      let savingsDeposit = 0;

      const canFundExtras = !hasUnpayableBills && budgetRemaining >= minCashOnHand;
      const availableSurplus = canFundExtras
        ? Math.max(0, budgetRemaining - minCashOnHand)
        : 0;

      if (availableSurplus <= 0) {
        // No surplus - nothing to allocate to savings or goals
        savingsDeposit = 0;
      } else if (availableSurplus <= minSavingsPerPaycheck) {
        // Not enough for minimum savings - all surplus goes to savings, no goals
        savingsDeposit = availableSurplus;
        budgetRemaining = minCashOnHand;
        totalSavings += savingsDeposit;
      } else {
        // Enough for both minimum savings and potentially goals
        // Step 1: Minimum savings deposit first
        savingsDeposit = minSavingsPerPaycheck;
        
        // Step 2: Calculate pool available for goals
        let poolForGoals = availableSurplus - minSavingsPerPaycheck;
        
        // Step 3: Allocate to goals using glide-path targets (priority order for pool competition)
        const sortedGoals = [...goals].sort((a, b) => a.priority - b.priority);

        for (const goal of sortedGoals) {
          if (poolForGoals <= 0) break;

          const paycheckDate = parseISO(paycheckDateStr);
          const goalDate = parseISO(goal.targetDate);
          
          if (!isBefore(paycheckDate, goalDate) && !isEqual(paycheckDate, goalDate)) {
            continue;
          }

          const glidePath = goalGlidePaths.get(goal.id);
          const idealCumulative = glidePath?.get(paycheckDateStr);
          if (idealCumulative === undefined) {
            continue;
          }

          const currentProgress = goalProgress.get(goal.id) || goal.alreadySaved;
          const remaining = goal.targetAmount - currentProgress;
          if (remaining <= 0) continue;

          const idealDeposit = Math.max(0, idealCumulative - currentProgress);
          const allocation = Math.min(idealDeposit, remaining, poolForGoals);
          if (allocation > 0) {
            goalDeposits.push({
              goalId: goal.id,
              goalName: goal.name,
              amount: Math.round(allocation * 100) / 100,
            });
            totalGoalDeposits += allocation;
            poolForGoals -= allocation;
            goalProgress.set(goal.id, currentProgress + allocation);
          }
        }

        // Step 4: Any remainder after goals goes to additional savings
        if (poolForGoals > 0) {
          savingsDeposit += poolForGoals;
        }

        // Update budget remaining (keep minCashOnHand)
        budgetRemaining = minCashOnHand;
        totalSavings += savingsDeposit;
      }

      const isShortfall = budgetRemaining < 0;

      const paycheck: PaycheckEntry = {
        date: paycheckDateStr,
        incomeSources: assignment.incomes.map(inc => ({
          id: inc.sourceId,
          name: inc.sourceName,
          amount: inc.amount,
        })),
        totalIncome,
        bills: uniqueBills.map(bill => ({
          billId: bill.billId,
          creditorName: bill.creditorName,
          amount: bill.amount,
          dueDay: bill.dueDay,
          priority: bill.priority,
          category: bill.category,
          billDate: format(bill.date, 'yyyy-MM-dd'),
          isIncomeAttached: bill.isIncomeAttached,
          isUnpayable: bill.isUnpayable,
          unfundableReason: bill.unfundableReason,
        })),
        totalBills: Math.round(totalBillsAmount * 100) / 100,
        goalDeposits,
        totalGoalDeposits: Math.round(totalGoalDeposits * 100) / 100,
        budgetRemaining: Math.round(budgetRemaining * 100) / 100,
        savingsDeposit: Math.round(savingsDeposit * 100) / 100,
        totalSavings: Math.round(totalSavings * 100) / 100,
        isShortfall,
      };

      paychecks.push(paycheck);
    }

    return paychecks;
  }

  private calculateGoalRequirementsPerPaycheck(
    goals: SavingsGoal[],
    assignments: { date: Date; incomes: ProjectedIncome[]; bills: ProjectedBill[] }[]
  ): Map<string, number> {
    const requirements = new Map<string, number>();

    for (const goal of goals) {
      const goalDate = parseISO(goal.targetDate);
      const remainingAmount = goal.targetAmount - goal.alreadySaved;

      if (remainingAmount <= 0) {
        requirements.set(goal.id, 0);
        continue;
      }

      // Count paychecks before or on the goal date
      const relevantPaychecks = assignments.filter(a => 
        isBefore(a.date, goalDate) || isEqual(a.date, goalDate)
      );

      if (relevantPaychecks.length === 0) {
        requirements.set(goal.id, 0);
        continue;
      }

      const requiredPerPaycheck = remainingAmount / relevantPaychecks.length;
      requirements.set(goal.id, Math.round(requiredPerPaycheck * 100) / 100);
    }

    return requirements;
  }

  private buildScheduleHealth(paychecks: PaycheckEntry[]): GoalScheduleHealth {
    const nonShortfall = paychecks.filter(p => !p.isShortfall);
    const tightPaycheckCount = nonShortfall.filter(
      p => p.totalBills > p.totalIncome * 0.9 && p.savingsDeposit === 0
    ).length;
    const shortfallCount = paychecks.filter(p => p.isShortfall).length;
    const savingsTotal = paychecks.length > 0
      ? paychecks[paychecks.length - 1].totalSavings
      : 0;

    return {
      tightPaycheckCount,
      shortfallCount,
      savingsTotal: roundCurrency(savingsTotal),
    };
  }

  private computeGoalFundingTimeline(
    goalId: string,
    remainingAmount: number,
    paychecks: PaycheckEntry[],
    goalDate: Date
  ): {
    paychecksToFullyFund: number | null;
    estimatedFundedDate: string | null;
    beatsDeadlineByPaychecks: number | null;
    missesDeadlineByPaychecks: number | null;
    depositPaycheckCount: number;
  } {
    const ordered = paychecks
      .filter(p => !p.isShortfall)
      .sort((a, b) => parseISO(a.date).getTime() - parseISO(b.date).getTime());

    let cumulative = 0;
    let depositPaycheckCount = 0;
    let paychecksToFullyFund: number | null = null;
    let estimatedFundedDate: string | null = null;

    for (let i = 0; i < ordered.length; i++) {
      const paycheck = ordered[i];
      const deposit = paycheck.goalDeposits.find(d => d.goalId === goalId);
      if (!deposit || deposit.amount <= 0) continue;

      depositPaycheckCount++;
      cumulative += deposit.amount;

      if (cumulative >= remainingAmount && estimatedFundedDate === null) {
        paychecksToFullyFund = depositPaycheckCount;
        estimatedFundedDate = paycheck.date;
      }
    }

    let beatsDeadlineByPaychecks: number | null = null;
    let missesDeadlineByPaychecks: number | null = null;

    if (estimatedFundedDate) {
      const fundedDate = parseISO(estimatedFundedDate);
      const deadlinePaychecks = ordered.filter(p => {
        const pDate = parseISO(p.date);
        return isBefore(pDate, goalDate) || isEqual(pDate, goalDate);
      });
      const completionIndex = ordered.findIndex(p => p.date === estimatedFundedDate);
      const deadlineIndex = deadlinePaychecks.length > 0
        ? ordered.findIndex(p => p.date === deadlinePaychecks[deadlinePaychecks.length - 1].date)
        : -1;

      if (isBefore(fundedDate, goalDate)) {
        if (deadlineIndex >= 0 && completionIndex >= 0) {
          beatsDeadlineByPaychecks = deadlineIndex - completionIndex;
        } else {
          beatsDeadlineByPaychecks = Math.max(
            1,
            Math.ceil(differenceInDays(goalDate, fundedDate) / 7)
          );
        }
      } else if (isAfter(fundedDate, goalDate)) {
        if (deadlineIndex >= 0 && completionIndex >= 0) {
          missesDeadlineByPaychecks = completionIndex - deadlineIndex;
        } else {
          missesDeadlineByPaychecks = Math.max(
            1,
            Math.ceil(differenceInDays(fundedDate, goalDate) / 7)
          );
        }
      }
    }

    return {
      paychecksToFullyFund,
      estimatedFundedDate,
      beatsDeadlineByPaychecks,
      missesDeadlineByPaychecks,
      depositPaycheckCount,
    };
  }

  private buildGoalProjectionMetrics(
    goalId: string,
    remainingAmount: number,
    actualAllocation: number,
    requiredPerPaycheck: number,
    paychecks: PaycheckEntry[],
    goalDate: Date,
    scheduleHealth: GoalScheduleHealth
  ): Pick<
    GoalProjection,
    | 'avgAllocationPerPaycheck'
    | 'marginPerPaycheck'
    | 'paychecksToFullyFund'
    | 'estimatedFundedDate'
    | 'beatsDeadlineByPaychecks'
    | 'missesDeadlineByPaychecks'
    | 'scheduleHealth'
  > {
    const timeline = this.computeGoalFundingTimeline(goalId, remainingAmount, paychecks, goalDate);
    const avgAllocationPerPaycheck = timeline.depositPaycheckCount > 0
      ? actualAllocation / timeline.depositPaycheckCount
      : 0;
    const marginPerPaycheck = avgAllocationPerPaycheck - requiredPerPaycheck;

    return {
      avgAllocationPerPaycheck: roundCurrency(avgAllocationPerPaycheck),
      marginPerPaycheck: roundCurrency(marginPerPaycheck),
      paychecksToFullyFund: timeline.paychecksToFullyFund,
      estimatedFundedDate: timeline.estimatedFundedDate,
      beatsDeadlineByPaychecks: timeline.beatsDeadlineByPaychecks,
      missesDeadlineByPaychecks: timeline.missesDeadlineByPaychecks,
      scheduleHealth,
    };
  }

  calculateGoalProjections(
    goals: SavingsGoal[],
    paychecks: PaycheckEntry[],
    scheduleEndDate: string,
    _minCashOnHand: number = DEFAULT_MIN_CASH_ON_HAND,
    _minSavingsPerPaycheck: number = 0
  ): GoalProjection[] {
    const projections: GoalProjection[] = [];
    const scheduleEnd = parseISO(scheduleEndDate);
    const SCHEDULE_MONTHS = 12;

    // Sort goals by priority (ascending - 1 is highest priority)
    const sortedGoals = [...goals].sort((a, b) => a.priority - b.priority);

    // Sum ACTUAL allocations from paychecks
    const actualAllocations = new Map<string, number>();
    for (const paycheck of paychecks) {
      if (paycheck.isShortfall) continue;
      for (const deposit of paycheck.goalDeposits) {
        const current = actualAllocations.get(deposit.goalId) || 0;
        actualAllocations.set(deposit.goalId, current + deposit.amount);
      }
    }

    // Calculate the pool available for goals - this is ONLY goal deposits
    // Savings is savings, not available for goals
    const totalGoalDeposits = paychecks
      .filter(p => !p.isShortfall)
      .reduce((sum, p) => sum + p.totalGoalDeposits, 0);
    
    const monthlyGoalRate = totalGoalDeposits / SCHEDULE_MONTHS;

    const scheduleHealth = this.buildScheduleHealth(paychecks);

    // Build projections based on schedule data
    for (const goal of sortedGoals) {
      const remainingAmount = goal.targetAmount - goal.alreadySaved;
      const goalDate = parseISO(goal.targetDate);
      const isWithinSchedule = isBefore(goalDate, scheduleEnd) || isEqual(goalDate, scheduleEnd);

      // Get ACTUAL allocation from 12-month schedule
      const actualAllocation = actualAllocations.get(goal.id) || 0;

      // Count paychecks before goal deadline (within schedule window)
      const relevantPaychecks = paychecks.filter(p => {
        const pDate = parseISO(p.date);
        return (isBefore(pDate, goalDate) || isEqual(pDate, goalDate)) && !p.isShortfall;
      });
      const paycheckCount = relevantPaychecks.length;

      // Handle already achieved goals
      if (remainingAmount <= 0) {
        projections.push({
          goalId: goal.id,
          goalName: goal.name,
          targetAmount: goal.targetAmount,
          alreadySaved: goal.alreadySaved,
          remainingAmount: 0,
          targetDate: goal.targetDate,
          paycheckCount: 0,
          requiredPerPaycheck: 0,
          adjustedRequiredPerPaycheck: 0,
          availablePerPaycheck: 0,
          actualAllocation: 0,
          achievableAmount: goal.targetAmount,
          achievabilityPercent: 100,
          status: 'achievable',
          suggestions: [],
          isProjected: false,
          projectionNote: undefined,
          avgAllocationPerPaycheck: 0,
          marginPerPaycheck: 0,
          paychecksToFullyFund: null,
          estimatedFundedDate: null,
          beatsDeadlineByPaychecks: null,
          missesDeadlineByPaychecks: null,
          scheduleHealth,
        });
        continue;
      }

      let achievableAmount: number;
      let achievabilityPercent: number;
      let isProjected: boolean;
      let projectionNote: string | undefined;

      // First check: is the goal already fully funded by actual allocations?
      // If so, it's 100% achievable - no projection needed
      if (actualAllocation >= remainingAmount) {
        achievableAmount = goal.targetAmount;
        achievabilityPercent = 100;
        isProjected = false;
        projectionNote = undefined;
      } else if (isWithinSchedule) {
        // Goal is within 12-month schedule but not fully funded
        // Use actual allocation to show partial achievability
        achievableAmount = goal.alreadySaved + actualAllocation;
        achievabilityPercent = Math.min(100, Math.round((achievableAmount / goal.targetAmount) * 100));
        isProjected = false;
        projectionNote = undefined;
      } else {
        // Goal is beyond 12-month schedule AND not fully funded
        // Project based on monthly goal allocation rate
        const monthsToGoal = Math.ceil(differenceInDays(goalDate, new Date()) / 30);
        const projectedGoalPool = monthlyGoalRate * monthsToGoal;
        
        // For projection, estimate this goal's share based on priority
        const goalIndex = sortedGoals.indexOf(goal);
        let poolConsumedByHigherPriority = 0;
        for (let i = 0; i < goalIndex; i++) {
          const higherGoal = sortedGoals[i];
          const higherRemaining = higherGoal.targetAmount - higherGoal.alreadySaved;
          poolConsumedByHigherPriority += Math.max(0, higherRemaining);
        }
        
        // Pool available for this goal (projected)
        const poolAvailableForThisGoal = Math.max(0, projectedGoalPool - poolConsumedByHigherPriority);
        
        // Achievable is the minimum of what's needed and what's projected available
        const canAchieve = Math.min(remainingAmount, poolAvailableForThisGoal);
        achievableAmount = goal.alreadySaved + canAchieve;
        achievabilityPercent = Math.min(100, Math.round((achievableAmount / goal.targetAmount) * 100));
        isProjected = true;
        projectionNote = `Projected based on ${SCHEDULE_MONTHS}-month allocation rate`;
      }

      let status: 'achievable' | 'partial' | 'impossible';
      if (achievabilityPercent >= 100) {
        status = 'achievable';
      } else if (achievabilityPercent > 0) {
        status = 'partial';
      } else {
        status = 'impossible';
      }

      const requiredPerPaycheck = paycheckCount > 0 ? remainingAmount / paycheckCount : 0;
      // Calculate available per paycheck based on total goal deposits
      const totalPaychecksInSchedule = paychecks.filter(p => !p.isShortfall).length;
      const availablePerPaycheck = totalPaychecksInSchedule > 0 
        ? totalGoalDeposits / totalPaychecksInSchedule 
        : 0;

      const metrics = this.buildGoalProjectionMetrics(
        goal.id,
        remainingAmount,
        actualAllocation,
        requiredPerPaycheck,
        paychecks,
        goalDate,
        scheduleHealth
      );

      projections.push({
        goalId: goal.id,
        goalName: goal.name,
        targetAmount: goal.targetAmount,
        alreadySaved: goal.alreadySaved,
        remainingAmount,
        targetDate: goal.targetDate,
        paycheckCount,
        requiredPerPaycheck: roundCurrency(requiredPerPaycheck),
        adjustedRequiredPerPaycheck: roundCurrency(requiredPerPaycheck),
        availablePerPaycheck: roundCurrency(availablePerPaycheck),
        actualAllocation: roundCurrency(actualAllocation),
        achievableAmount: roundCurrency(achievableAmount),
        achievabilityPercent,
        status,
        suggestions: status !== 'achievable' 
          ? this.generateGoalSuggestions(goal, availablePerPaycheck, paychecks, scheduleEndDate)
          : [],
        isProjected,
        projectionNote,
        ...metrics,
      });
    }

    return projections;
  }

  private generateGoalSuggestions(
    goal: SavingsGoal,
    availablePerPaycheck: number,
    paychecks: PaycheckEntry[],
    scheduleEndDate: string
  ): GoalSuggestion[] {
    const suggestions: GoalSuggestion[] = [];
    const remainingAmount = goal.targetAmount - goal.alreadySaved;
    
    if (remainingAmount <= 0 || availablePerPaycheck <= 0) return suggestions;

    // Suggestion 1: Extend deadline
    const paycheckDates = paychecks
      .filter(p => !p.isShortfall)
      .map(p => parseISO(p.date))
      .sort((a, b) => a.getTime() - b.getTime());

    if (paycheckDates.length > 0) {
      const paychecksNeeded = Math.ceil(remainingAmount / availablePerPaycheck);
      
      if (paychecksNeeded <= paycheckDates.length) {
        const newDeadline = paycheckDates[Math.min(paychecksNeeded - 1, paycheckDates.length - 1)];
        const currentDeadline = parseISO(goal.targetDate);
        
        if (isAfter(newDeadline, currentDeadline)) {
          suggestions.push({
            type: 'extend_deadline',
            description: `Extend to ${format(newDeadline, 'MMM yyyy')} for 100% achievability`,
            newValue: format(newDeadline, 'yyyy-MM-dd'),
            resultPercent: 100,
          });
        }
      }
    }

    // Suggestion 2: Reduce target
    const goalDate = parseISO(goal.targetDate);
    const relevantPaychecks = paychecks.filter(p => {
      const pDate = parseISO(p.date);
      return (isBefore(pDate, goalDate) || isEqual(pDate, goalDate)) && !p.isShortfall;
    });

    if (relevantPaychecks.length > 0) {
      const achievableRemaining = availablePerPaycheck * relevantPaychecks.length;
      const achievableTotal = Math.round((goal.alreadySaved + achievableRemaining) * 100) / 100;

      if (achievableTotal < goal.targetAmount && achievableTotal > goal.alreadySaved) {
        suggestions.push({
          type: 'reduce_target',
          description: `Reduce target to $${formatCurrency(achievableTotal)} for 100% achievability`,
          newValue: achievableTotal,
          resultPercent: 100,
        });
      }
    }

    // Suggestion 3: Increase priority (if not already highest)
    if (goal.priority > 1) {
      suggestions.push({
        type: 'increase_priority',
        description: `Increase priority to get first access to surplus funds`,
        newValue: 1,
        resultPercent: Math.min(100, Math.round((availablePerPaycheck / (remainingAmount / Math.max(1, relevantPaychecks.length))) * 100) + 10),
      });
    }

    return suggestions;
  }

  private convertToLegacyEntries(paychecks: PaycheckEntry[], startingBalance: number): ScheduleEntry[] {
    const entries: ScheduleEntry[] = [];
    let runningBalance = startingBalance;

    for (const paycheck of paychecks) {
      for (const income of paycheck.incomeSources) {
        runningBalance += income.amount;
        entries.push({
          date: paycheck.date,
          type: 'income',
          description: income.name,
          amount: income.amount,
          runningBalance: Math.round(runningBalance * 100) / 100,
          isShortfall: runningBalance < 0,
        });
      }

      for (const bill of paycheck.bills) {
        runningBalance -= bill.amount;
        entries.push({
          date: paycheck.date,
          type: 'expense',
          description: bill.creditorName,
          amount: bill.amount,
          runningBalance: Math.round(runningBalance * 100) / 100,
          isShortfall: runningBalance < 0,
        });
      }

      // Add goal deposits
      for (const goalDeposit of paycheck.goalDeposits) {
        runningBalance -= goalDeposit.amount;
        entries.push({
          date: paycheck.date,
          type: 'savings',
          description: `Goal: ${goalDeposit.goalName}`,
          amount: goalDeposit.amount,
          runningBalance: Math.round(runningBalance * 100) / 100,
          isShortfall: false,
        });
      }

      if (paycheck.savingsDeposit > 0) {
        runningBalance -= paycheck.savingsDeposit;
        entries.push({
          date: paycheck.date,
          type: 'savings',
          description: 'Transfer to Savings',
          amount: paycheck.savingsDeposit,
          runningBalance: Math.round(runningBalance * 100) / 100,
          isShortfall: false,
        });
      }
    }

    return entries;
  }

  private calculateSummary(
    paychecks: PaycheckEntry[], 
    startingBalance: number,
    maxBudgetRemaining: number = DEFAULT_TARGET_CASH_ON_HAND
  ): ScheduleSummary {
    let totalIncome = 0;
    let totalExpenses = 0;
    let totalSavingsDeposits = 0;
    let shortfallCount = 0;
    let balanceSum = 0;
    let lowestBalance = startingBalance;
    let highestBalance = startingBalance;

    for (const paycheck of paychecks) {
      totalIncome += paycheck.totalIncome;
      totalExpenses += paycheck.totalBills;
      totalSavingsDeposits += paycheck.savingsDeposit;
      
      if (paycheck.isShortfall) shortfallCount++;
      
      balanceSum += paycheck.budgetRemaining;
      lowestBalance = Math.min(lowestBalance, paycheck.budgetRemaining);
      highestBalance = Math.min(maxBudgetRemaining, Math.max(highestBalance, paycheck.budgetRemaining));
    }

    const finalSavingsBalance = paychecks.length > 0 
      ? paychecks[paychecks.length - 1].totalSavings 
      : 0;

    return {
      totalIncome: Math.round(totalIncome * 100) / 100,
      totalExpenses: Math.round(totalExpenses * 100) / 100,
      totalSavingsDeposits: Math.round(totalSavingsDeposits * 100) / 100,
      finalSavingsBalance: Math.round(finalSavingsBalance * 100) / 100,
      netBalance: Math.round((totalIncome - totalExpenses) * 100) / 100,
      shortfallCount,
      averageBalance: paychecks.length > 0 
        ? Math.round((balanceSum / paychecks.length) * 100) / 100 
        : startingBalance,
      lowestBalance: Math.round(lowestBalance * 100) / 100,
      highestBalance: Math.round(highestBalance * 100) / 100,
    };
  }

  private generateRecommendations(
    paychecks: PaycheckEntry[], 
    bills: Bill[],
    startingBalance: number
  ): string[] {
    const recommendations: string[] = [];

    // Check for any remaining shortfalls (couldn't be fixed by rebalancing)
    const shortfallPaychecks = paychecks.filter(p => p.isShortfall);
    if (shortfallPaychecks.length > 0) {
      const firstShortfall = shortfallPaychecks[0];
      const deficit = Math.abs(firstShortfall.budgetRemaining);
      recommendations.push(
        `Budget shortfall of $${deficit.toFixed(2)} remains on ${format(parseISO(firstShortfall.date), 'MMM d, yyyy')} paycheck. ` +
        `This couldn't be resolved by prepaying bills. Consider reducing expenses or increasing income.`
      );
    } else {
      // Check if we had to rebalance (bills paid before their natural due date)
      // This is indicated by paychecks where totalBills > totalIncome but no shortfall
      const rebalancedPaychecks = paychecks.filter(p => 
        p.totalBills > p.totalIncome && !p.isShortfall && p.budgetRemaining >= 0
      );
      if (rebalancedPaychecks.length > 0) {
        recommendations.push(
          `Budget optimized! Some bills were scheduled to be paid early to avoid deficits in later paychecks.`
        );
      }
    }

    const criticalBills = bills.filter(b => b.priority === 'critical');
    if (criticalBills.length > 0) {
      const criticalTotal = criticalBills.reduce((sum, b) => sum + b.budgetedAmount, 0);
      recommendations.push(
        `You have ${criticalBills.length} critical bill(s) totaling $${criticalTotal.toFixed(2)}/month. ` +
        `These are always funded first and may be prepaid up to 14 days early when needed to avoid shortfalls.`
      );
    }

    const totalSavings = paychecks.length > 0 ? paychecks[paychecks.length - 1].totalSavings : 0;
    if (totalSavings > 0) {
      recommendations.push(
        `Great job! You'll save $${formatCurrency(totalSavings)} over this period by staying under budget and depositing excess funds into savings.`
      );
    }

    const heavyPaychecks = paychecks.filter(p => p.totalBills > p.totalIncome * 0.9 && p.savingsDeposit === 0);
    if (heavyPaychecks.length > 0) {
      recommendations.push(
        `${heavyPaychecks.length} paycheck(s) have bills consuming over 90% of income with no savings possible.`
      );
    }

    if (recommendations.length === 0) {
      recommendations.push(
        'Your budget looks balanced! Bills are well-distributed across paychecks.'
      );
    }

    return recommendations;
  }

  analyzeAndProposeFixes(schedule: ScheduleData): ReconciliationReport {
    const shortfallPaychecks = schedule.paychecks.filter(p => p.isShortfall);
    
    if (shortfallPaychecks.length === 0) {
      return {
        needsReconciliation: false,
        shortfalls: [],
        proposedFixes: [],
        canBeFullyResolved: true,
        totalDeficit: 0,
        estimatedResolution: 0,
      };
    }

    const shortfalls: ShortfallDetail[] = shortfallPaychecks.map(p => ({
      paycheckDate: p.date,
      deficit: Math.abs(p.budgetRemaining),
      bills: [...p.bills],
    }));

    const totalDeficit = shortfalls.reduce((sum, s) => sum + s.deficit, 0);
    const proposedFixes: ProposedFix[] = [];
    let fixIdCounter = 1;

    // Build a map of paycheck surpluses (non-shortfall paychecks)
    const paycheckSurplus = new Map<string, number>();
    for (const paycheck of schedule.paychecks) {
      if (!paycheck.isShortfall && paycheck.budgetRemaining > MIN_BREATHING_ROOM) {
        paycheckSurplus.set(paycheck.date, paycheck.budgetRemaining - MIN_BREATHING_ROOM);
      }
    }

    // Track which bills we've already proposed fixes for
    const proposedBillMoves = new Set<string>();

    // For each shortfall paycheck, try to find fixes
    for (const shortfall of shortfalls) {
      const shortfallPaycheck = schedule.paychecks.find(p => p.date === shortfall.paycheckDate);
      if (!shortfallPaycheck) continue;

      // Sort bills by priority for moves: Low → Normal → High → Critical last
      const movableBills = [...shortfallPaycheck.bills]
        .filter(b => !b.isIncomeAttached && !b.isUnpayable)
        .sort((a, b) => PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority]);

      for (const bill of movableBills) {
        const billKey = `${bill.billId}-${bill.billDate}`;
        if (proposedBillMoves.has(billKey)) continue;

        // Find earlier paychecks with enough surplus
        const earlierPaychecks = schedule.paychecks
          .filter(p => {
            const pDate = parseISO(p.date);
            const sDate = parseISO(shortfall.paycheckDate);
            return isBefore(pDate, sDate) && !p.isShortfall;
          })
          .sort((a, b) => {
            // Sort by date descending (closest to shortfall first)
            return parseISO(b.date).getTime() - parseISO(a.date).getTime();
          });

        for (const targetPaycheck of earlierPaychecks) {
          const availableSurplus = paycheckSurplus.get(targetPaycheck.date) || 0;
          
          if (availableSurplus >= bill.amount) {
            // Check prepay limit
            const billDueDate = parseISO(bill.billDate);
            const targetDate = parseISO(targetPaycheck.date);
            const daysEarly = differenceInDays(billDueDate, targetDate);
            
            if (daysEarly <= MAX_PREPAY_DAYS) {
              proposedFixes.push({
                id: `fix-${fixIdCounter++}`,
                type: 'move_bill',
                billId: bill.billId,
                billName: bill.creditorName,
                billAmount: bill.amount,
                fromPaycheckDate: shortfall.paycheckDate,
                toPaycheckDate: targetPaycheck.date,
                billDueDate: bill.billDate,
                reason: `Move to ${format(targetDate, 'MMM d')} paycheck which has surplus capacity`,
                impact: bill.amount,
              });

              // Update surplus tracking
              paycheckSurplus.set(targetPaycheck.date, availableSurplus - bill.amount);
              proposedBillMoves.add(billKey);
              break;
            }
          }
        }
      }

      // If we still have deficit after move suggestions, suggest skipping low-priority bills
      const remainingDeficit = shortfall.deficit - 
        proposedFixes
          .filter(f => f.fromPaycheckDate === shortfall.paycheckDate && f.type === 'move_bill')
          .reduce((sum, f) => sum + f.impact, 0);

      if (remainingDeficit > 0) {
        const skippableBills = shortfallPaycheck.bills
          .filter(b => !b.isIncomeAttached && !b.isUnpayable)
          .filter(b => b.priority === 'low' || b.priority === 'normal' || b.priority === 'high')
          .filter(b => !proposedBillMoves.has(`${b.billId}-${b.billDate}`))
          .sort((a, b) => PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority]);

        let deficitCovered = 0;
        for (const bill of skippableBills) {
          if (deficitCovered >= remainingDeficit) break;

          const billKey = `${bill.billId}-${bill.billDate}`;
          if (proposedBillMoves.has(billKey)) continue;

          proposedFixes.push({
            id: `fix-${fixIdCounter++}`,
            type: 'skip_bill',
            billId: bill.billId,
            billName: bill.creditorName,
            billAmount: bill.amount,
            fromPaycheckDate: shortfall.paycheckDate,
            billDueDate: bill.billDate,
            reason: `Skip this ${bill.priority}-priority bill for this cycle`,
            impact: bill.amount,
            reasonCode: bill.unfundableReason,
          });

          proposedBillMoves.add(billKey);
          deficitCovered += bill.amount;
        }
      }
    }

    const estimatedResolution = proposedFixes.reduce((sum, f) => sum + f.impact, 0);
    const canBeFullyResolved = estimatedResolution >= totalDeficit;

    return {
      needsReconciliation: true,
      shortfalls,
      proposedFixes,
      canBeFullyResolved,
      totalDeficit,
      estimatedResolution,
    };
  }

}
