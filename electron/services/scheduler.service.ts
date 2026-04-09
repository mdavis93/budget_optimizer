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

const DEFAULT_TARGET_CASH_ON_HAND = 250;
const DEFAULT_MIN_CASH_ON_HAND = 100;
const MIN_BREATHING_ROOM = 50; // Minimum balance to maintain after bills
const MAX_PREPAY_DAYS = 14; // Bills cannot be paid more than 14 days early

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
    debtPayoffs: Map<string, DebtPayoffInfo> = new Map()
  ): ScheduleData {
    const startDate = startOfDay(parseISO(startDateStr));
    const endDate = addMonths(startDate, months);

    const allIncomes: ProjectedIncome[] = [];
    for (const income of incomes) {
      allIncomes.push(...this.projectIncome(income, startDate, endDate));
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
      const dedupKey = `${bill.billId}-${bill.date.getTime()}`;
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

    const entries = this.convertToLegacyEntries(paychecks, startingBalance);

    const summary = this.calculateSummary(paychecks, startingBalance, maxBudgetRemaining);
    const recommendations = this.generateRecommendations(paychecks, bills, startingBalance);

    return {
      startDate: format(startDate, 'yyyy-MM-dd'),
      endDate: format(endDate, 'yyyy-MM-dd'),
      paychecks,
      fullPaychecks: paychecks,  // Will be same as paychecks when called directly
      viewportMonths: months,    // Will be updated by IPC handler for viewport filtering
      entries,
      summary,
      recommendations,
      maxBudgetRemaining,
      goalProjections,
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
    // Step 1: Initial assignment of bills to paychecks based on due dates
    const paycheckAssignments: {
      date: Date;
      incomes: ProjectedIncome[];
      bills: ProjectedBill[];
    }[] = [];

    // Track bills that have manual assignments
    const manuallyAssignedBills = new Set<string>();

    // Initialize paycheck assignments
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

    // STEP 1: Apply manual assignments first (highest priority) - only for date-based bills
    for (const bill of allBills) {
      const billDateStr = format(bill.date, 'yyyy-MM-dd');
      const assignmentKey = `${bill.billId}-${billDateStr}`;
      const targetPaycheckDate = manualAssignments.get(assignmentKey);
      
      if (targetPaycheckDate) {
        // Skip if this bill is skipped
        const skipKey = `${bill.billId}-${targetPaycheckDate}`;
        if (skippedBills.has(skipKey)) continue;

        const paycheckIdx = paycheckAssignments.findIndex(
          p => format(p.date, 'yyyy-MM-dd') === targetPaycheckDate
        );
        if (paycheckIdx !== -1) {
          paycheckAssignments[paycheckIdx].bills.push(bill);
          manuallyAssignedBills.add(`${bill.billId}-${bill.date.getTime()}`);
        }
      }
    }

    // Separate remaining date-based bills (not manually assigned)
    const remainingBills = allBills.filter(b => 
      !manuallyAssignedBills.has(`${b.billId}-${b.date.getTime()}`)
    );
    
    // Separate bills with preferred income sources from regular bills (all are date-based now)
    const billsWithPreference = remainingBills.filter(b => b.preferredIncomeSourceId);
    const regularBills = remainingBills.filter(b => !b.preferredIncomeSourceId);
    const assignedPreferenceBills = new Set<string>();

    // STEP 2A: Add income-attached bills to EVERY paycheck from their attached income source
    // These come from raw bill data, not projected bills, so they always work regardless of schedule dates
    for (const bill of incomeAttachedBillsRaw) {
      for (const paycheck of paycheckAssignments) {
        const hasMatchingIncome = paycheck.incomes.some(
          inc => inc.sourceId === bill.preferredIncomeSourceId
        );
        
        if (hasMatchingIncome) {
          const paycheckDateStr = format(paycheck.date, 'yyyy-MM-dd');
          const skipKey = `${bill.id}-${paycheckDateStr}`;
          
          if (!skippedBills.has(skipKey)) {
            // Create a projected bill entry for this paycheck
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

    // STEP 2B: Assign bills with preferred income sources to the nearest matching paycheck
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
          assignedPreferenceBills.add(`${bill.billId}-${bill.date.getTime()}`);
        }
      }
    }

    // Assign regular bills based on date range
    for (let i = 0; i < paycheckDates.length; i++) {
      const paycheckDate = paycheckDates[i];
      const nextPaycheckDate = paycheckDates[i + 1] || endDate;
      const paycheckDateStr = format(paycheckDate, 'yyyy-MM-dd');

      const billsForPaycheck = regularBills.filter(bill => {
        // Skip if already assigned via preference
        const billKey = `${bill.billId}-${bill.date.getTime()}`;
        if (assignedPreferenceBills.has(billKey)) {
          return false;
        }

        const billDate = bill.date;
        const isInDateRange = (
          (isAfter(billDate, paycheckDate) || isEqual(billDate, paycheckDate)) &&
          isBefore(billDate, nextPaycheckDate)
        );
        
        // Check if this bill is skipped for this paycheck
        const skipKey = `${bill.billId}-${paycheckDateStr}`;
        const isSkipped = skippedBills.has(skipKey);
        
        return isInDateRange && !isSkipped;
      });

      paycheckAssignments[i].bills.push(...billsForPaycheck);
    }

    // Sort all paycheck bills by priority
    for (const assignment of paycheckAssignments) {
      assignment.bills.sort((a, b) => {
        return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      });
    }

    // Step 2: Rebalance to eliminate deficits by prepaying bills
    this.rebalanceBills(paycheckAssignments, startingBalance);

    // FINAL DEDUPLICATION - ensure no duplicates in any paycheck
    for (const assignment of paycheckAssignments) {
      const seen = new Set<string>();
      assignment.bills = assignment.bills.filter(bill => {
        const key = `${bill.billId}-${bill.creditorName}-${bill.dueDay}`;
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
    }

    // Step 3: Build final paycheck entries with balances, savings, and goal deposits
    return this.buildPaycheckEntries(paycheckAssignments, startingBalance, maxBudgetRemaining, goals, minCashOnHand, minSavingsPerPaycheck);
  }

  // Type for rebalance helper functions (passed to phase methods)
  private createRebalanceHelpers(
    assignments: { date: Date; incomes: ProjectedIncome[]; bills: ProjectedBill[] }[]
  ) {
    const getBalance = (index: number): number => {
      const income = assignments[index].incomes.reduce((sum, inc) => sum + inc.amount, 0);
      const bills = assignments[index].bills.reduce((sum, bill) => sum + bill.amount, 0);
      return income - bills;
    };

    const getSurplus = (index: number): number => {
      return Math.max(0, getBalance(index) - MIN_BREATHING_ROOM);
    };

    const getDeficit = (index: number): number => {
      return Math.max(0, MIN_BREATHING_ROOM - getBalance(index));
    };

    const getTotalDeficit = (): number => {
      return assignments.reduce((sum, _, i) => sum + getDeficit(i), 0);
    };

    const moveBill = (fromIdx: number, toIdx: number, bill: ProjectedBill): boolean => {
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
      return [...assignments[index].bills]
        .filter(b => b.priority !== 'critical')
        .sort((a, b) => {
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
        if (getDeficit(i) > 0) {
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
        }
        if (madeProgress) break;
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
            for (let earlyIdx = midIdx - 1; earlyIdx >= 0; earlyIdx--) {
              if (getSurplus(earlyIdx) >= midBill.amount) {
                if (moveBill(midIdx, earlyIdx, midBill)) {
                  madeProgress = true;
                  
                  const newCapacity = getSurplus(midIdx);
                  const deficitBills = getMovableBills(deficitIdx);
                  
                  for (const defBill of deficitBills) {
                    if (newCapacity >= defBill.amount) {
                      moveBill(deficitIdx, midIdx, defBill);
                      break;
                    }
                  }
                  break;
                }
              }
            }
            if (madeProgress) break;
          }
          if (madeProgress) break;
        }
        if (madeProgress) break;
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
    helpers: ReturnType<typeof this.createRebalanceHelpers>
  ): void {
    const { getBalance, getSurplus, moveBill, getMovableBills } = helpers;
    let maxPasses = 50;
    let madeProgress = true;

    while (madeProgress && maxPasses > 0) {
      madeProgress = false;
      maxPasses--;

      for (let i = 1; i < assignments.length; i++) {
        const balance = getBalance(i);
        
        if (balance >= MIN_BREATHING_ROOM && balance < MIN_BREATHING_ROOM * 3) {
          const movableBills = getMovableBills(i);

          for (const bill of movableBills) {
            for (let j = i - 1; j >= 0; j--) {
              if (getSurplus(j) >= bill.amount + MIN_BREATHING_ROOM) {
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

  private rebalanceFinalCleanup(
    assignments: { date: Date; incomes: ProjectedIncome[]; bills: ProjectedBill[] }[]
  ): void {
    // Deduplicate bills across all paychecks
    const seenBills = new Set<string>();
    for (const assignment of assignments) {
      assignment.bills = assignment.bills.filter(bill => {
        const key = `${bill.billId}-${bill.date.getTime()}-${bill.amount}`;
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
    _startingBalance: number
  ): void {
    const helpers = this.createRebalanceHelpers(assignments);
    
    // Phase 1: Direct moves - move bills from deficit to surplus paychecks
    this.rebalancePhase1_DirectMoves(assignments, helpers);
    
    // Phase 2: Cascade moves - create capacity by moving bills between non-deficit paychecks
    this.rebalancePhase2_CascadeMoves(assignments, helpers);
    
    // Phase 3: Deep cascade - try moving smaller bills to create room for larger ones
    this.rebalancePhase3_DeepCascade(assignments, helpers);
    
    // Phase 4: Even out paychecks for better breathing room
    this.rebalancePhase4_EvenOut(assignments, helpers);
    
    // Final cleanup: deduplicate and sort
    this.rebalanceFinalCleanup(assignments);
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

    // Calculate how much each goal needs per paycheck (for goals that end within the schedule)
    const goalRequirements = this.calculateGoalRequirementsPerPaycheck(goals, assignments);

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
        // Expected total saved by this paycheck (including alreadySaved)
        glidePath.set(dateStr, goal.alreadySaved + (idealPerPaycheck * (i + 1)));
      }
      
      goalGlidePaths.set(goal.id, glidePath);
    }

    for (const assignment of assignments) {
      // Deduplicate bills by creditorName+dueDay (keep first occurrence)
      const seenBills = new Set<string>();
      const uniqueBills = assignment.bills.filter(bill => {
        const key = `${bill.creditorName}-${bill.dueDay}`;
        if (seenBills.has(key)) {
          return false;
        }
        seenBills.add(key);
        return true;
      });
      
      const totalIncome = assignment.incomes.reduce((sum, inc) => sum + inc.amount, 0);
      const totalBillsAmount = uniqueBills.reduce((sum, bill) => sum + bill.amount, 0);

      // Each paycheck is standalone: budget remaining = income - bills
      let budgetRemaining = totalIncome - totalBillsAmount;
      const paycheckDateStr = format(assignment.date, 'yyyy-MM-dd');

      // GLIDE-PATH ALLOCATION ALGORITHM:
      // 1. Calculate available surplus above minimum cash on hand
      // 2. Minimum savings gets first priority
      // 3. Goals get allocated using glide-path multipliers
      // 4. Any remainder goes to additional savings

      const goalDeposits: GoalDeposit[] = [];
      let totalGoalDeposits = 0;
      let savingsDeposit = 0;

      // Calculate available surplus above minimum cash on hand
      const availableSurplus = Math.max(0, budgetRemaining - minCashOnHand);

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
        
        // Step 3: Allocate to goals - fund aggressively by priority
        // Higher priority goals get fully funded before lower priority goals start
        const sortedGoals = [...goals].sort((a, b) => a.priority - b.priority);

        for (const goal of sortedGoals) {
          if (poolForGoals <= 0) break;

          // Check if this paycheck is before the goal's target date
          const paycheckDate = parseISO(paycheckDateStr);
          const goalDate = parseISO(goal.targetDate);
          
          if (!isBefore(paycheckDate, goalDate) && !isEqual(paycheckDate, goalDate)) {
            continue; // Skip goals whose deadline has passed
          }

          // Get current progress toward this goal
          const currentProgress = goalProgress.get(goal.id) || goal.alreadySaved;
          
          // How much is still needed to complete this goal?
          const remaining = goal.targetAmount - currentProgress;
          if (remaining <= 0) continue; // Goal already funded

          // Allocate as much as possible from the pool (up to what's needed)
          // This funds goals as fast as possible rather than spreading over time
          const allocation = Math.min(remaining, poolForGoals);
          if (allocation > 0) {
            goalDeposits.push({
              goalId: goal.id,
              goalName: goal.name,
              amount: Math.round(allocation * 100) / 100,
            });
            totalGoalDeposits += allocation;
            poolForGoals -= allocation;
            
            // Update goal progress for next iteration
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
        })),
        totalBills: totalBillsAmount,
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
        `These are prioritized first in each paycheck and are never moved to earlier pay periods.`
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

      // Sort bills by priority (low first, then normal, high, critical)
      // We want to move lower priority bills first
      const movableBills = [...shortfallPaycheck.bills]
        .filter(b => b.priority !== 'critical')
        .sort((a, b) => {
          const priorityOrder = { low: 0, normal: 1, high: 2, critical: 3 };
          return priorityOrder[a.priority] - priorityOrder[b.priority];
        });

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
        // Find low-priority bills that could be skipped
        const skippableBills = shortfallPaycheck.bills
          .filter(b => b.priority === 'low' || b.priority === 'normal')
          .filter(b => !proposedBillMoves.has(`${b.billId}-${b.billDate}`))
          .sort((a, b) => {
            const priorityOrder = { low: 0, normal: 1, high: 2, critical: 3 };
            return priorityOrder[a.priority] - priorityOrder[b.priority];
          });

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

  optimizeSchedule(
    incomes: Income[],
    bills: Bill[],
    startDateStr: string,
    months: number,
    startingBalance: number,
    maxBudgetRemaining: number = DEFAULT_TARGET_CASH_ON_HAND,
    goals: SavingsGoal[] = [],
    minCashOnHand: number = DEFAULT_MIN_CASH_ON_HAND,
    minSavingsPerPaycheck: number = 0
  ): ScheduleData {
    return this.generateSchedule(incomes, bills, startDateStr, months, startingBalance, new Set(), new Map(), maxBudgetRemaining, goals, minCashOnHand, minSavingsPerPaycheck);
  }
}
