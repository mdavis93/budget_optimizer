import { addMonths, format, isAfter, parseISO, startOfDay } from 'date-fns';
import { Bill, PaycheckEntry, ScheduleData, ScheduleEntry, ScheduleSummary } from '../types';

export const SCHEDULE_CALCULATION_MONTHS = 12;

function calculateSummary(
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

function convertToLegacyEntries(paychecks: PaycheckEntry[], startingBalance: number): ScheduleEntry[] {
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

function generateRecommendations(
  paychecks: PaycheckEntry[],
  bills: Bill[],
  _startingBalance: number
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
      `Great job! You'll save $${totalSavings.toFixed(2)} over this period by staying under budget and depositing excess funds into savings.`
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

function filterPaychecksByViewport(
  fullPaychecks: PaycheckEntry[],
  startDate: string,
  viewportMonths: number,
  horizonMonths: number = SCHEDULE_CALCULATION_MONTHS
): PaycheckEntry[] {
  if (viewportMonths >= horizonMonths) {
    return fullPaychecks;
  }

  const viewportEndDate = startOfDay(addMonths(parseISO(startDate), viewportMonths));
  return fullPaychecks.filter((paycheck) => {
    const paycheckDate = startOfDay(parseISO(paycheck.date));
    return !isAfter(paycheckDate, viewportEndDate);
  });
}

/**
 * Slice a full 12-month schedule to the requested viewport without recalculating assignments.
 */
export function applyScheduleViewport(
  fullSchedule: ScheduleData,
  viewportMonths: number,
  bills: Bill[],
  startingBalance: number
): ScheduleData {
  const horizonMonths = fullSchedule.calculationMonths ?? SCHEDULE_CALCULATION_MONTHS;
  const viewportPaychecks = filterPaychecksByViewport(
    fullSchedule.fullPaychecks,
    fullSchedule.startDate,
    viewportMonths,
    horizonMonths
  );

  const viewportEndDate = viewportMonths >= horizonMonths
    ? fullSchedule.endDate
    : format(startOfDay(addMonths(parseISO(fullSchedule.startDate), viewportMonths)), 'yyyy-MM-dd');

  const reconciliation = fullSchedule.reconciliation
    ? {
        ...fullSchedule.reconciliation,
        shortfalls: fullSchedule.reconciliation.shortfalls.filter((shortfall) =>
          viewportPaychecks.some((paycheck) => paycheck.date === shortfall.paycheckDate)
        ),
        needsReconciliation: viewportPaychecks.some((paycheck) => paycheck.isShortfall),
        totalDeficit: viewportPaychecks
          .filter((paycheck) => paycheck.isShortfall)
          .reduce((sum, paycheck) => sum + Math.abs(paycheck.budgetRemaining), 0),
        proposedFixes: fullSchedule.reconciliation.proposedFixes.filter((fix) => {
          const fixDate = fix.fromPaycheckDate ?? fix.toPaycheckDate;
          return fixDate
            ? viewportPaychecks.some((paycheck) => paycheck.date === fixDate)
            : true;
        }),
      }
    : fullSchedule.reconciliation;

  return {
    ...fullSchedule,
    endDate: viewportEndDate,
    paychecks: viewportPaychecks,
    viewportMonths,
    entries: convertToLegacyEntries(viewportPaychecks, startingBalance),
    summary: calculateSummary(viewportPaychecks, startingBalance, fullSchedule.maxBudgetRemaining),
    recommendations: generateRecommendations(viewportPaychecks, bills, startingBalance),
    reconciliation,
  };
}
