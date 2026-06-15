import {
  isBefore,
  isEqual,
  format,
  parseISO,
} from 'date-fns';
import { Bill, SavingsGoal } from '../database.service';
import { formatCurrency } from '../../utils/constants';
import {
  DEFAULT_TARGET_CASH_ON_HAND,
  DEFAULT_MIN_CASH_ON_HAND,
  RebalanceStrategy,
  PaycheckEntry,
  PaycheckAssignment,
  PaycheckBill,
  GoalDeposit,
  ScheduleEntry,
  ScheduleSummary,
  billOccurrenceKey,
} from './types';
import { buildGoalReservePerPaycheck } from './goalReserves';
import { createRebalanceHelpers, diagnoseUnfundableReason } from './rebalance';

export function applyFundingPriority(
  assignments: PaycheckAssignment[],
  lockedBills: Set<string> = new Set(),
  goals: SavingsGoal[] = [],
  minCashOnHand: number = DEFAULT_MIN_CASH_ON_HAND,
  minSavingsPerPaycheck: number = 0,
  strategy: RebalanceStrategy = 'deficit_killer'
): void {
  const goalReservePerPaycheck = buildGoalReservePerPaycheck(assignments, goals);
  const poolOptions = { minCashOnHand, minSavingsPerPaycheck, goalReservePerPaycheck };
  const helpers = createRebalanceHelpers(assignments, lockedBills, poolOptions, strategy);
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
        billToDrop.unfundableReason = diagnoseUnfundableReason(
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

export function buildPaycheckEntries(
  assignments: PaycheckAssignment[],
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
      const key = billOccurrenceKey(bill.billId, bill.date);
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

export function convertToLegacyEntries(paychecks: PaycheckEntry[], startingBalance: number): ScheduleEntry[] {
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

export function calculateSummary(
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

export function generateRecommendations(
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
