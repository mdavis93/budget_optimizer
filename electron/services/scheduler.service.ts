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

const DEFAULT_TARGET_CASH_ON_HAND = 250;
const DEFAULT_MIN_CASH_ON_HAND = 100;
const MIN_BREATHING_ROOM = 50; // Minimum balance to maintain after bills
const MAX_PREPAY_DAYS = 14; // Bills cannot be paid more than 14 days early

const formatCurrency = (amount: number) =>
  amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
      currentDate = this.getNextIncomeDate(currentDate, income.cadence);
    }

    while (isBefore(currentDate, endDate) || isEqual(currentDate, endDate)) {
      events.push({
        date: currentDate,
        sourceId: income.id,
        sourceName: income.sourceName,
        amount: income.amount,
      });
      currentDate = this.getNextIncomeDate(currentDate, income.cadence);
    }

    return events;
  }

  private getNextIncomeDate(current: Date, cadence: Income['cadence']): Date {
    switch (cadence) {
      case 'weekly':
        return addWeeks(current, 1);
      case 'biweekly':
        return addWeeks(current, 2);
      case 'semimonthly':
        const day = getDate(current);
        if (day === 1) {
          return setDate(current, 15);
        } else if (day === 15) {
          return setDate(addMonths(current, 1), 1);
        } else if (day < 15) {
          return setDate(current, 15);
        } else {
          return setDate(addMonths(current, 1), 1);
        }
      case 'monthly':
        return addMonths(current, 1);
      default:
        return addMonths(current, 1);
    }
  }

  projectBills(bill: Bill, startDate: Date, endDate: Date): ProjectedBill[] {
    const events: ProjectedBill[] = [];
    
    let currentMonth = startOfMonth(startDate);
    const end = endOfMonth(endDate);

    while (isBefore(currentMonth, end) || isEqual(currentMonth, end)) {
      const daysInMonth = getDaysInMonth(currentMonth);
      const dueDay = Math.min(bill.dueDay, daysInMonth);
      const dueDate = setDate(currentMonth, dueDay);

      if (
        (isAfter(dueDate, startDate) || isEqual(dueDate, startDate)) &&
        (isBefore(dueDate, endDate) || isEqual(dueDate, endDate))
      ) {
        events.push({
          date: dueDate,
          billId: bill.id,
          creditorName: bill.creditorName,
          amount: bill.budgetedAmount,
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
    minCashOnHand: number = DEFAULT_MIN_CASH_ON_HAND
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
      allBills.push(...this.projectBills(bill, startDate, endDate));
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
      minCashOnHand
    );

    // Calculate goal projections
    const goalProjections = this.calculateGoalProjections(
      goals,
      paychecks,
      format(endDate, 'yyyy-MM-dd'),
      minCashOnHand
    );

    const entries = this.convertToLegacyEntries(paychecks, startingBalance);

    const summary = this.calculateSummary(paychecks, startingBalance, maxBudgetRemaining);
    const recommendations = this.generateRecommendations(paychecks, bills, startingBalance);

    return {
      startDate: format(startDate, 'yyyy-MM-dd'),
      endDate: format(endDate, 'yyyy-MM-dd'),
      paychecks,
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
    minCashOnHand: number = DEFAULT_MIN_CASH_ON_HAND
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
        const priorityOrder = { critical: 0, high: 1, normal: 2, low: 3 };
        return priorityOrder[a.priority] - priorityOrder[b.priority];
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
    return this.buildPaycheckEntries(paycheckAssignments, startingBalance, maxBudgetRemaining, goals, minCashOnHand);
  }

  private rebalanceBills(
    assignments: { date: Date; incomes: ProjectedIncome[]; bills: ProjectedBill[] }[],
    startingBalance: number
  ): void {
    // Each paycheck is SELF-SUFFICIENT: income must cover bills
    
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

    const getTotalSurplus = (): number => {
      return assignments.reduce((sum, _, i) => sum + getSurplus(i), 0);
    };

    const getTotalDeficit = (): number => {
      return assignments.reduce((sum, _, i) => sum + getDeficit(i), 0);
    };

    // Helper to move a bill between paychecks (with duplicate prevention and prepay limit)
    const moveBill = (fromIdx: number, toIdx: number, bill: ProjectedBill): boolean => {
      // Check prepay limit: bill cannot be paid more than MAX_PREPAY_DAYS before due date
      const targetPaycheckDate = assignments[toIdx].date;
      const billDueDate = bill.date;
      const daysEarly = differenceInDays(billDueDate, targetPaycheckDate);
      
      if (daysEarly > MAX_PREPAY_DAYS) {
        return false; // Would be paying too early
      }
      
      // Find the bill in the source paycheck
      const billIndex = assignments[fromIdx].bills.findIndex(b => 
        b.billId === bill.billId && 
        b.date.getTime() === bill.date.getTime() &&
        b.amount === bill.amount
      );
      
      if (billIndex === -1) {
        return false; // Bill not found in source
      }
      
      // Check if bill already exists in target (prevent duplicates)
      const alreadyInTarget = assignments[toIdx].bills.some(b =>
        b.billId === bill.billId && 
        b.date.getTime() === bill.date.getTime() &&
        b.amount === bill.amount
      );
      
      if (alreadyInTarget) {
        // Bill already in target - just remove from source
        assignments[fromIdx].bills.splice(billIndex, 1);
        return true;
      }
      
      // Move the bill
      const [movedBill] = assignments[fromIdx].bills.splice(billIndex, 1);
      assignments[toIdx].bills.push(movedBill);
      return true;
    };

    // Get movable bills from a paycheck (non-critical, sorted by priority then amount)
    const getMovableBills = (index: number): ProjectedBill[] => {
      return [...assignments[index].bills]
        .filter(b => b.priority !== 'critical')
        .sort((a, b) => {
          const priorityOrder = { critical: 0, high: 1, normal: 2, low: 3 };
          const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
          if (priorityDiff !== 0) return priorityDiff;
          return b.amount - a.amount;
        });
    };

    // PHASE 1: Direct moves - move bills from deficit to surplus paychecks
    let maxPasses = 200;
    let madeProgress = true;

    while (madeProgress && maxPasses > 0 && getTotalDeficit() > 0) {
      madeProgress = false;
      maxPasses--;

      // Work backwards from last paycheck to first
      for (let i = assignments.length - 1; i >= 0; i--) {
        if (getDeficit(i) > 0) {
          const movableBills = getMovableBills(i);

          for (const bill of movableBills) {
            // Find ANY earlier paycheck with surplus capacity
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

    // PHASE 2: Cascade moves - create capacity by moving bills between non-deficit paychecks
    // This enables multi-hop rebalancing
    maxPasses = 200;
    madeProgress = true;

    while (madeProgress && maxPasses > 0 && getTotalDeficit() > 0) {
      madeProgress = false;
      maxPasses--;

      // Find paychecks that still have deficits
      for (let deficitIdx = assignments.length - 1; deficitIdx >= 0; deficitIdx--) {
        if (getDeficit(deficitIdx) === 0) continue;

        // For each paycheck between the deficit and the beginning
        // Try to create capacity by moving its bills further back
        for (let midIdx = deficitIdx - 1; midIdx >= 1; midIdx--) {
          // Can we move something from midIdx to an earlier paycheck?
          const midMovable = getMovableBills(midIdx);
          
          for (const midBill of midMovable) {
            // Look for surplus earlier
            for (let earlyIdx = midIdx - 1; earlyIdx >= 0; earlyIdx--) {
              if (getSurplus(earlyIdx) >= midBill.amount) {
                // This move creates capacity at midIdx
                if (moveBill(midIdx, earlyIdx, midBill)) {
                  madeProgress = true;
                  
                  // Now try to use the new capacity
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

    // PHASE 3: Deep cascade - try moving smaller bills to create room for larger ones
    maxPasses = 100;
    madeProgress = true;

    while (madeProgress && maxPasses > 0 && getTotalDeficit() > 0) {
      madeProgress = false;
      maxPasses--;

      for (let deficitIdx = assignments.length - 1; deficitIdx >= 0; deficitIdx--) {
        const deficit = getDeficit(deficitIdx);
        if (deficit === 0) continue;

        // Get the smallest bill that would resolve or reduce the deficit
        const deficitBills = getMovableBills(deficitIdx);
        
        for (const targetBill of deficitBills) {
          // For each intermediate paycheck, try to make room for this specific bill
          for (let midIdx = deficitIdx - 1; midIdx >= 0; midIdx--) {
            const currentCapacity = getSurplus(midIdx);
            const needed = targetBill.amount - currentCapacity;
            
            if (needed <= 0) {
              // Already has capacity
              if (moveBill(deficitIdx, midIdx, targetBill)) {
                madeProgress = true;
                break;
              }
            } else if (midIdx > 0) {
              // Need to free up 'needed' amount from midIdx
              const midBills = getMovableBills(midIdx)
                .filter(b => b.amount <= needed + 50); // Small buffer
              
              let freedAmount = 0;
              const billsToMove: { bill: ProjectedBill; to: number }[] = [];
              
              for (const midBill of midBills) {
                // Can we move this bill further back?
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
                // Execute the cascade
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

    // PHASE 4: Even out paychecks for better breathing room
    maxPasses = 50;
    madeProgress = true;

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

    // Deduplicate bills across all paychecks (safety check)
    const seenBills = new Set<string>();
    for (const assignment of assignments) {
      assignment.bills = assignment.bills.filter(bill => {
        const key = `${bill.billId}-${bill.date.getTime()}-${bill.amount}`;
        if (seenBills.has(key)) {
          return false; // Duplicate, remove it
        }
        seenBills.add(key);
        return true;
      });
    }

    // Re-sort bills by priority
    for (const assignment of assignments) {
      assignment.bills.sort((a, b) => {
        const priorityOrder = { critical: 0, high: 1, normal: 2, low: 3 };
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      });
    }
  }

  private buildPaycheckEntries(
    assignments: { date: Date; incomes: ProjectedIncome[]; bills: ProjectedBill[] }[],
    startingBalance: number,
    maxBudgetRemaining: number = DEFAULT_TARGET_CASH_ON_HAND,
    goals: SavingsGoal[] = [],
    minCashOnHand: number = DEFAULT_MIN_CASH_ON_HAND
  ): PaycheckEntry[] {
    const paychecks: PaycheckEntry[] = [];
    let totalSavings = 0;

    // Calculate how much each goal needs per paycheck (for goals that end within the schedule)
    const goalRequirements = this.calculateGoalRequirementsPerPaycheck(goals, assignments);

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

      // First allocate to savings (above target cash on hand)
      let savingsDeposit = 0;
      if (budgetRemaining > maxBudgetRemaining) {
        savingsDeposit = budgetRemaining - maxBudgetRemaining;
        budgetRemaining = maxBudgetRemaining;
        totalSavings += savingsDeposit;
      }

      // Then allocate to goals from the surplus (between minCashOnHand and maxBudgetRemaining)
      // Goals can only consume surplus down to minCashOnHand
      const goalDeposits: GoalDeposit[] = [];
      let totalGoalDeposits = 0;
      const paycheckDateStr = format(assignment.date, 'yyyy-MM-dd');

      // Get available surplus for goals
      const availableForGoals = Math.max(0, budgetRemaining - minCashOnHand);
      let remainingForGoals = availableForGoals;

      // Allocate to goals by priority (sorted ascending - priority 1 is highest)
      const sortedGoals = [...goals].sort((a, b) => a.priority - b.priority);

      for (const goal of sortedGoals) {
        if (remainingForGoals <= 0) break;

        // Check if this paycheck is before the goal's target date
        const paycheckDate = parseISO(paycheckDateStr);
        const goalDate = parseISO(goal.targetDate);
        
        if (!isBefore(paycheckDate, goalDate) && !isEqual(paycheckDate, goalDate)) {
          continue; // Skip goals whose deadline has passed
        }

        const required = goalRequirements.get(goal.id) || 0;
        if (required <= 0) continue;

        const allocation = Math.min(required, remainingForGoals);
        if (allocation > 0) {
          goalDeposits.push({
            goalId: goal.id,
            goalName: goal.name,
            amount: Math.round(allocation * 100) / 100,
          });
          totalGoalDeposits += allocation;
          remainingForGoals -= allocation;
          budgetRemaining -= allocation;
        }
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
    minCashOnHand: number = DEFAULT_MIN_CASH_ON_HAND
  ): GoalProjection[] {
    const projections: GoalProjection[] = [];

    // Sort goals by priority (ascending - 1 is highest priority)
    const sortedGoals = [...goals].sort((a, b) => a.priority - b.priority);

    // Track remaining surplus after higher-priority goals consume it
    const paycheckSurplus = new Map<string, number>();
    for (const paycheck of paychecks) {
      if (!paycheck.isShortfall) {
        // Surplus available = budgetRemaining above minCashOnHand + savings deposit
        // But we need to recalculate from scratch for projection purposes
        const surplus = Math.max(0, paycheck.budgetRemaining - minCashOnHand) + paycheck.savingsDeposit;
        paycheckSurplus.set(paycheck.date, surplus);
      }
    }

    for (const goal of sortedGoals) {
      const remainingAmount = goal.targetAmount - goal.alreadySaved;
      const goalDate = parseISO(goal.targetDate);

      // Count paychecks before the goal deadline
      const relevantPaycheckDates = paychecks
        .filter(p => {
          const pDate = parseISO(p.date);
          return (isBefore(pDate, goalDate) || isEqual(pDate, goalDate)) && !p.isShortfall;
        })
        .map(p => p.date);

      const paycheckCount = relevantPaycheckDates.length;

      if (paycheckCount === 0 || remainingAmount <= 0) {
        projections.push({
          goalId: goal.id,
          goalName: goal.name,
          targetAmount: goal.targetAmount,
          alreadySaved: goal.alreadySaved,
          remainingAmount: Math.max(0, remainingAmount),
          targetDate: goal.targetDate,
          paycheckCount: 0,
          requiredPerPaycheck: 0,
          availablePerPaycheck: 0,
          achievableAmount: goal.alreadySaved,
          achievabilityPercent: remainingAmount <= 0 ? 100 : 0,
          status: remainingAmount <= 0 ? 'achievable' : 'impossible',
          suggestions: remainingAmount <= 0 ? [] : this.generateGoalSuggestions(goal, 0, paychecks, scheduleEndDate),
        });
        continue;
      }

      const requiredPerPaycheck = remainingAmount / paycheckCount;

      // Calculate total available surplus across relevant paychecks
      let totalAvailableSurplus = 0;
      for (const dateStr of relevantPaycheckDates) {
        totalAvailableSurplus += paycheckSurplus.get(dateStr) || 0;
      }

      const availablePerPaycheck = totalAvailableSurplus / paycheckCount;
      const achievableAmount = Math.min(remainingAmount, totalAvailableSurplus) + goal.alreadySaved;
      const achievabilityPercent = Math.min(100, Math.round((achievableAmount / goal.targetAmount) * 100));

      let status: 'achievable' | 'partial' | 'impossible';
      if (achievabilityPercent >= 100) {
        status = 'achievable';
      } else if (achievabilityPercent > 0) {
        status = 'partial';
      } else {
        status = 'impossible';
      }

      // Update surplus tracking - deduct what this goal will consume
      const consumptionPerPaycheck = Math.min(requiredPerPaycheck, availablePerPaycheck);
      for (const dateStr of relevantPaycheckDates) {
        const current = paycheckSurplus.get(dateStr) || 0;
        paycheckSurplus.set(dateStr, Math.max(0, current - consumptionPerPaycheck));
      }

      projections.push({
        goalId: goal.id,
        goalName: goal.name,
        targetAmount: goal.targetAmount,
        alreadySaved: goal.alreadySaved,
        remainingAmount,
        targetDate: goal.targetDate,
        paycheckCount,
        requiredPerPaycheck: Math.round(requiredPerPaycheck * 100) / 100,
        availablePerPaycheck: Math.round(availablePerPaycheck * 100) / 100,
        achievableAmount: Math.round(achievableAmount * 100) / 100,
        achievabilityPercent,
        status,
        suggestions: status !== 'achievable' 
          ? this.generateGoalSuggestions(goal, availablePerPaycheck, paychecks, scheduleEndDate)
          : [],
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
    minCashOnHand: number = DEFAULT_MIN_CASH_ON_HAND
  ): ScheduleData {
    return this.generateSchedule(incomes, bills, startDateStr, months, startingBalance, new Set(), new Map(), maxBudgetRemaining, goals, minCashOnHand);
  }
}
