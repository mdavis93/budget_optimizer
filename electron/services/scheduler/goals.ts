import {
  isBefore,
  isAfter,
  isEqual,
  format,
  parseISO,
  differenceInDays,
  differenceInCalendarMonths,
  addMonths,
  startOfDay,
} from 'date-fns';
import { Income, Bill, SavingsGoal } from '../database.service';
import { formatCurrency, roundCurrency } from '../../utils/constants';
import {
  DEFAULT_MIN_CASH_ON_HAND,
  DEFAULT_TARGET_CASH_ON_HAND,
  resolveCalculationMonths,
  DebtPayoffInfo,
  PaycheckEntry,
  GoalProjection,
  GoalSuggestion,
  GoalScheduleHealth,
  billOccurrenceKey,
} from './types';
import { projectIncome, projectBills } from './projection';
import {
  getUniquePaycheckDates,
  buildInitialPaycheckAssignments,
  clonePaycheckAssignments,
  dedupeAssignmentBills,
} from './assignment';
import { applyFundingPriority, buildPaycheckEntries } from './paychecks';

export function buildScheduleHealth(paychecks: PaycheckEntry[]): GoalScheduleHealth {
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

export function computeGoalFundingTimeline(
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

export function buildGoalProjectionMetrics(
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
  const timeline = computeGoalFundingTimeline(goalId, remainingAmount, paychecks, goalDate);
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

export function generateGoalSuggestions(
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

export function calculateGoalProjections(
  goals: SavingsGoal[],
  paychecks: PaycheckEntry[],
  scheduleEndDate: string,
  _minCashOnHand: number = DEFAULT_MIN_CASH_ON_HAND,
  _minSavingsPerPaycheck: number = 0
): GoalProjection[] {
  const projections: GoalProjection[] = [];
  const scheduleEnd = parseISO(scheduleEndDate);
  // Derive the schedule horizon from the actual paycheck span so the monthly
  // goal-allocation rate isn't overstated when the horizon exceeds 12 months
  // (used only for goals that fall beyond the calculation cap).
  const firstPaycheckDate = paychecks.length > 0 ? parseISO(paychecks[0].date) : scheduleEnd;
  const horizonMonths = Math.max(1, differenceInCalendarMonths(scheduleEnd, firstPaycheckDate));

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

  const monthlyGoalRate = totalGoalDeposits / horizonMonths;

  const scheduleHealth = buildScheduleHealth(paychecks);

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
      projectionNote = `Projected based on your ${horizonMonths}-month allocation rate`;
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

    const metrics = buildGoalProjectionMetrics(
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
        ? generateGoalSuggestions(goal, availablePerPaycheck, paychecks, scheduleEndDate)
        : [],
      isProjected,
      projectionNote,
      ...metrics,
    });
  }

  return projections;
}

export function generateGoalProjections(
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
  // Match generateSchedule: span the latest goal deadline so projections cover
  // every goal rather than truncating at a fixed 12 months.
  const calcMonths = resolveCalculationMonths(startDateStr, goals);
  const endDate = addMonths(startDate, calcMonths);

  const allIncomes: ReturnType<typeof projectIncome> = [];
  for (const income of incomes) {
    allIncomes.push(...projectIncome(income, startDate, endDate));
  }

  for (const projected of allIncomes) {
    const key = `${projected.sourceId}-${format(projected.date, 'yyyy-MM-dd')}`;
    if (incomeOverrides.has(key)) {
      projected.amount = incomeOverrides.get(key)!;
    }
  }

  const incomeAttachedBillsRaw = bills.filter(b => b.isIncomeAttached && b.preferredIncomeSourceId);
  const regularBills = bills.filter(b => !b.isIncomeAttached);

  const allBills: ReturnType<typeof projectBills> = [];
  for (const bill of regularBills) {
    const debtInfo = debtPayoffs.get(bill.id);
    allBills.push(...projectBills(bill, startDate, endDate, debtInfo));
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
    const dedupKey = billOccurrenceKey(bill.billId, bill.date);
    if (seenBillKeys.has(dedupKey)) {
      return false;
    }
    seenBillKeys.add(dedupKey);
    return true;
  });

  const paycheckDates = getUniquePaycheckDates(allIncomes);

  const { paycheckAssignments, manuallyAssignedBills } = buildInitialPaycheckAssignments(
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

  const trial = clonePaycheckAssignments(paycheckAssignments);
  applyFundingPriority(
    trial,
    manuallyAssignedBills,
    goals,
    minCashOnHand,
    minSavingsPerPaycheck,
    'deficit_killer'
  );
  dedupeAssignmentBills(trial);
  const paychecks = buildPaycheckEntries(
    trial,
    startingBalance,
    maxBudgetRemaining,
    goals,
    minCashOnHand,
    minSavingsPerPaycheck
  );

  return calculateGoalProjections(
    goals,
    paychecks,
    format(endDate, 'yyyy-MM-dd'),
    minCashOnHand,
    minSavingsPerPaycheck
  );
}

export { buildGoalReservePerPaycheck, calculateGoalRequirementsPerPaycheck } from './goalReserves';
