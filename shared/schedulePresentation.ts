import { format, parseISO } from 'date-fns';
import type { Bill, PaycheckEntry, ScheduleEntry, ScheduleSummary } from './types';

export function calculateSummary(
  paychecks: PaycheckEntry[],
  startingBalance: number,
  maxBudgetRemaining: number
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

export function convertToLegacyEntries(
  paychecks: PaycheckEntry[],
  startingBalance: number
): ScheduleEntry[] {
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

export function generateRecommendations(
  paychecks: PaycheckEntry[],
  bills: Bill[],
  _startingBalance: number,
  savingsSqueezedCount?: number
): string[] {
  const recommendations: string[] = [];
  const shortfallPaychecks = paychecks.filter((p) => p.isShortfall);

  if (shortfallPaychecks.length > 0) {
    const firstShortfall = shortfallPaychecks[0];
    const deficit = Math.abs(firstShortfall.budgetRemaining);
    recommendations.push(
      `Budget shortfall of $${deficit.toFixed(2)} remains on ${format(parseISO(firstShortfall.date), 'MMM d, yyyy')} paycheck. ` +
      `This couldn't be resolved by prepaying bills. Consider reducing expenses or increasing income.`
    );
  } else {
    const rebalancedPaychecks = paychecks.filter(
      (p) => p.totalBills > p.totalIncome && !p.isShortfall && p.budgetRemaining >= 0
    );
    if (rebalancedPaychecks.length > 0) {
      recommendations.push(
        'Budget optimized! Some bills were scheduled to be paid early to avoid deficits in later paychecks.'
      );
    }
  }

  const squeezedCount =
    savingsSqueezedCount ?? paychecks.filter((p) => p.savingsSqueezed && !p.isShortfall).length;
  if (squeezedCount > 0) {
    recommendations.push(
      `Low or no savings on ${squeezedCount} paycheck(s) because your goals are consuming the available surplus after bills and cash-on-hand. ` +
      'Extend a goal deadline or reduce a goal target to free up room for savings.'
    );
  }

  const criticalBills = bills.filter((b) => b.priority === 'critical');
  if (criticalBills.length > 0) {
    const criticalTotal = criticalBills.reduce((sum, b) => sum + b.budgetedAmount, 0);
    recommendations.push(
      `You have ${criticalBills.length} critical bill(s) totaling $${criticalTotal.toFixed(2)}/month. ` +
      'These are always funded first and may be prepaid up to 14 days early when needed to avoid shortfalls.'
    );
  }

  const totalSavings = paychecks.length > 0 ? paychecks[paychecks.length - 1].totalSavings : 0;
  if (totalSavings > 0) {
    recommendations.push(
      `Great job! You'll save $${totalSavings.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} over this period by staying under budget and depositing excess funds into savings.`
    );
  }

  const heavyPaychecks = paychecks.filter(
    (p) => p.totalBills > p.totalIncome * 0.9 && p.savingsDeposit === 0
  );
  if (heavyPaychecks.length > 0) {
    recommendations.push(
      `${heavyPaychecks.length} paycheck(s) have bills consuming over 90% of income with no savings possible.`
    );
  }

  if (recommendations.length === 0) {
    recommendations.push('Your budget looks balanced! Bills are well-distributed across paychecks.');
  }

  return recommendations;
}
