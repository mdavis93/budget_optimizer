import {
  format,
  parseISO,
} from 'date-fns';
import { Bill, SavingsGoal } from '../database.service';
import { formatCurrency } from '../../utils/constants';
import {
  DEFAULT_TARGET_CASH_ON_HAND,
  DEFAULT_MIN_CASH_ON_HAND,
  PaycheckEntry,
  PaycheckAssignment,
  GoalDeposit,
  ScheduleEntry,
  ScheduleSummary,
  billOccurrenceKey,
} from './types';
import { allocateGoalsAndSavings } from './goalSavingsAllocator';

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

  // Pre-pass: dedupe bills and compute each paycheck's surplus above minimum
  // cash-on-hand (the pool the allocator splits between goals and savings).
  // Each paycheck is standalone: income - funded bills. The starting checking
  // balance only boosts the first paycheck (cash on hand at schedule start).
  const meta = assignments.map((assignment, i) => {
    const seenBills = new Set<string>();
    const uniqueBills = assignment.bills.filter(bill => {
      const key = billOccurrenceKey(bill.billId, bill.date);
      if (seenBills.has(key)) return false;
      seenBills.add(key);
      return true;
    });

    const totalIncome = assignment.incomes.reduce((sum, inc) => sum + inc.amount, 0);
    const totalBillsAmount = uniqueBills
      .filter(bill => !bill.isUnpayable)
      .reduce((sum, bill) => sum + bill.amount, 0);
    const unpayableBillsAmount = uniqueBills
      .filter(bill => bill.isUnpayable)
      .reduce((sum, bill) => sum + bill.amount, 0);
    const hasUnpayableBills = unpayableBillsAmount > 0;
    const ledgerBoost = i === 0 ? startingBalance : 0;

    // Bills always outrank goals, savings, and cash-on-hand. When a paycheck has
    // unpayable bills it is genuinely under-funded, so the unpaid obligation must
    // consume the whole pool: nothing goes to goals/savings (surplus = 0) and the
    // budget remainder counts the unpaid bills, surfacing as a negative figure
    // equal to how much more income is needed to meet the obligation.
    const grossRemaining = hasUnpayableBills
      ? totalIncome - totalBillsAmount - unpayableBillsAmount + ledgerBoost
      : totalIncome - totalBillsAmount + ledgerBoost;

    const surplus = hasUnpayableBills
      ? 0
      : grossRemaining >= minCashOnHand
        ? Math.max(0, grossRemaining - minCashOnHand)
        : 0;

    return { assignment, uniqueBills, totalIncome, totalBillsAmount, grossRemaining, surplus };
  });

  // ALLOCATION ALGORITHM: a single capacity-proportional, deadline-windowed,
  // tiered-floor pass over the whole horizon (see goalSavingsAllocator). Goals
  // are funded across the paychecks that can contribute, biased toward richer
  // paychecks, while protecting tiered savings targets; the remainder is savings.
  const allocation = allocateGoalsAndSavings(
    meta.map(m => ({ date: format(m.assignment.date, 'yyyy-MM-dd'), surplus: m.surplus })),
    goals.map(goal => ({
      id: goal.id,
      name: goal.name,
      targetAmount: goal.targetAmount,
      alreadySaved: goal.alreadySaved,
      priority: goal.priority,
      targetDate: goal.targetDate,
    })),
    { minSavingsPerPaycheck }
  );

  for (let assignmentIndex = 0; assignmentIndex < meta.length; assignmentIndex++) {
    const { assignment, uniqueBills, totalIncome, totalBillsAmount, grossRemaining, surplus } =
      meta[assignmentIndex];
    const alloc = allocation.paychecks[assignmentIndex];
    const paycheckDateStr = format(assignment.date, 'yyyy-MM-dd');

    const goalDeposits: GoalDeposit[] = alloc.goalDeposits.map(deposit => ({
      goalId: deposit.goalId,
      goalName: deposit.goalName,
      amount: Math.round(deposit.amount),
    }));
    const totalGoalDeposits = alloc.totalGoalDeposits;
    const savingsDeposit = alloc.savingsDeposit;
    const savingsSqueezed = alloc.savingsSqueezed;

    // When surplus was allocated, the paycheck lands at minCashOnHand and savings
    // accrues; otherwise the (possibly negative) gross remainder stands.
    let budgetRemaining = grossRemaining;
    if (surplus > 0) {
      budgetRemaining = minCashOnHand;
      totalSavings += savingsDeposit;
    }

    const isShortfall = budgetRemaining < 0;

    const unpayableCount = uniqueBills.filter(bill => bill.isUnpayable).length;
    const hasUnpayableBills = unpayableCount > 0;

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
      unpayableCount,
      hasUnpayableBills,
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
  startingBalance: number,
  savingsSqueezedCount?: number
): string[] {
  const recommendations: string[] = [];

  // Check for any remaining shortfalls (couldn't be fixed by rebalancing)
  const shortfallPaychecks = paychecks.filter(p => p.isShortfall);
  if (shortfallPaychecks.length > 0) {
    const firstShortfall = shortfallPaychecks[0];
    const deficit = Math.abs(firstShortfall.budgetRemaining);
    recommendations.push(
      `Budget shortfall of $${deficit.toFixed(2)} remains on ${format(parseISO(firstShortfall.date), 'MMM d, yyyy')} paycheck. ` +
      `Consider reducing expenses or increasing income.`
    );
  } else {
    const earlyPaychecks = paychecks.filter(p =>
      p.totalBills > p.totalIncome && !p.isShortfall && p.budgetRemaining >= 0
    );
    if (earlyPaychecks.length > 0) {
      recommendations.push(
        `Budget optimized! Some bills were scheduled to be paid early to balance paychecks across the schedule.`
      );
    }
  }

  // Squeeze count defaults to the full horizon when supplied so the warning
  // persists regardless of the viewport currently being rendered.
  const squeezedCount =
    savingsSqueezedCount ?? paychecks.filter(p => p.savingsSqueezed && !p.isShortfall).length;
  if (squeezedCount > 0) {
    recommendations.push(
      `Low or no savings on ${squeezedCount} paycheck(s) because your goals are consuming the available surplus after bills and cash-on-hand. ` +
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
