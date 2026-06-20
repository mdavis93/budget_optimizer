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
  SAVINGS_TARGET_FALLBACK,
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

  // Track cumulative progress for each goal. Goals are funded on-pace (just enough
  // each paycheck to meet the deadline), leaving the remainder for savings.
  const goalProgress = new Map<string, number>();
  for (const goal of goals) {
    goalProgress.set(goal.id, goal.alreadySaved);
  }

  // Per-paycheck surplus above cash-on-hand, independent of goal allocation. Used
  // to pace goal funding across only the paychecks that can actually contribute.
  const surplusByIndex: number[] = assignments.map((a, i) => {
    const inc = a.incomes.reduce((s, x) => s + x.amount, 0);
    const billsAmt = a.bills
      .filter(b => !b.isUnpayable)
      .reduce((s, b) => s + b.amount, 0);
    const boost = i === 0 ? startingBalance : 0;
    return Math.max(0, inc - billsAmt + boost - minCashOnHand);
  });

  // Per goal: count of still-to-come contributing paychecks (surplus > 0, on/before
  // the deadline), inclusive of the current index. Drives the on-pace divisor.
  const goalContribRemaining = new Map<string, number[]>();
  for (const goal of goals) {
    const goalDate = parseISO(goal.targetDate);
    const counts = new Array<number>(assignments.length).fill(0);
    let fromHere = 0;
    for (let i = assignments.length - 1; i >= 0; i--) {
      const onOrBefore =
        isBefore(assignments[i].date, goalDate) || isEqual(assignments[i].date, goalDate);
      if (onOrBefore && surplusByIndex[i] > 0) {
        fromHere++;
      }
      counts[i] = fromHere;
    }
    goalContribRemaining.set(goal.id, counts);
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

    // Each paycheck is standalone: income - bills. Starting checking balance applies only
    // to the first paycheck (cash on hand at schedule start; no cross-paycheck carry).
    const ledgerBoost = assignmentIndex === 0 ? startingBalance : 0;
    let budgetRemaining = totalIncome - totalBillsAmount + ledgerBoost;
    const paycheckDateStr = format(assignment.date, 'yyyy-MM-dd');

    // ALLOCATION ALGORITHM (balanced goals vs savings):
    // Bills must be fully funded before any savings or goal deposits.
    // 1. Calculate available surplus above minimum cash on hand.
    // 2. Honor any configured hard minimum savings first.
    // 3. Fund goals ON-PACE (only what's needed this paycheck to hit the
    //    deadline using the contributing paychecks that remain), priority order.
    // 4. The remainder goes to savings (lands at >= $150 when there's room,
    //    falling back toward $100, then ~$0 with a warning when goals consume it).

    const goalDeposits: GoalDeposit[] = [];
    let totalGoalDeposits = 0;
    let savingsDeposit = 0;
    let savingsSqueezed = false;

    // Surplus is swept to goals/savings whenever it exists, even if some bills
    // were dropped as unpayable to protect a goal reserve. A genuinely
    // under-funded paycheck keeps budgetRemaining below minCashOnHand, so
    // availableSurplus stays 0 and nothing is allocated.
    const canFundExtras = budgetRemaining >= minCashOnHand;
    const availableSurplus = canFundExtras
      ? Math.max(0, budgetRemaining - minCashOnHand)
      : 0;

    if (availableSurplus <= 0) {
      // No surplus - nothing to allocate to savings or goals
      savingsDeposit = 0;
    } else {
      // Step 1: honor any configured hard minimum savings floor (default 0).
      const hardSavingsFloor = Math.min(minSavingsPerPaycheck, availableSurplus);
      savingsDeposit = hardSavingsFloor;
      let pool = availableSurplus - hardSavingsFloor;

      // Step 2: fund goals on-pace in priority order (highest priority first).
      const sortedGoals = [...goals].sort((a, b) => a.priority - b.priority);

      for (const goal of sortedGoals) {
        if (pool <= 0) break;

        const paycheckDate = parseISO(paycheckDateStr);
        const goalDate = parseISO(goal.targetDate);

        if (!isBefore(paycheckDate, goalDate) && !isEqual(paycheckDate, goalDate)) {
          continue;
        }

        const currentProgress = goalProgress.get(goal.id) || goal.alreadySaved;
        const remaining = goal.targetAmount - currentProgress;
        if (remaining <= 0) continue;

        const contribRemaining = goalContribRemaining.get(goal.id)?.[assignmentIndex] ?? 0;
        if (contribRemaining <= 0) continue;

        // On-pace need: spread the remaining balance over the contributing
        // paychecks left until the deadline. Whole dollars; ceil ensures the
        // deadline is actually met rather than landing a dollar short.
        const onPaceNeed = Math.ceil(remaining / contribRemaining);
        const allocation = Math.min(onPaceNeed, remaining, pool);

        if (allocation > 0) {
          goalDeposits.push({
            goalId: goal.id,
            goalName: goal.name,
            amount: Math.round(allocation * 100) / 100,
          });
          totalGoalDeposits += allocation;
          pool -= allocation;
          goalProgress.set(goal.id, currentProgress + allocation);
        }
      }

      // Step 3: the remainder is savings. It naturally lands at the highest
      // feasible amount (>= $150 when there's room), so the goal deadline keeps
      // priority while savings still happens every paycheck it can.
      savingsDeposit += pool;

      // Flag paychecks where goals pushed savings below the fallback target.
      if (totalGoalDeposits > 0 && savingsDeposit < SAVINGS_TARGET_FALLBACK) {
        savingsSqueezed = true;
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
      savingsSqueezed,
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

  const squeezedPaychecks = paychecks.filter(p => p.savingsSqueezed && !p.isShortfall);
  if (squeezedPaychecks.length > 0) {
    recommendations.push(
      `Low or no savings on ${squeezedPaychecks.length} paycheck(s) because your goals are consuming the available surplus after bills and cash-on-hand. ` +
      `Extend a goal deadline or reduce a goal target to free up room for savings.`
    );
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
