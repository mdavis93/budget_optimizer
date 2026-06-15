import { isAfter, isEqual, format, differenceInDays, parseISO } from 'date-fns';
import { Bill, SavingsGoal } from '../database.service';
import { PRIORITY_ORDER } from '../../utils/constants';
import { scoreEligiblePaycheck as scoreEligiblePaycheckUtil } from '../../utils/scheduleScoring';
import {
  DEFAULT_TARGET_CASH_ON_HAND,
  DEFAULT_MIN_CASH_ON_HAND,
  MAX_PREPAY_DAYS,
  REBALANCE_STRATEGIES,
  PaycheckEntry,
  PaycheckAssignment,
  ProjectedIncome,
  ProjectedBill,
  billOccurrenceKey,
} from './types';
import { buildGoalReservePerPaycheck } from './goalReserves';
import { rebalanceBills } from './rebalance';
import { applyFundingPriority, buildPaycheckEntries } from './paychecks';

export function getUniquePaycheckDates(incomes: ProjectedIncome[]): Date[] {
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

export function buildPaycheckPressureSnapshot(
  paycheck: PaycheckAssignment,
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

export function scoreEligiblePaycheck(
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

export function findScoredAutomaticPaycheck(
  bill: ProjectedBill,
  paycheckAssignments: PaycheckAssignment[],
  skippedBills: Set<string>,
  goals: SavingsGoal[],
  minCashOnHand: number,
  minSavingsPerPaycheck: number
): string | null {
  const goalReservePerPaycheck = buildGoalReservePerPaycheck(paycheckAssignments, goals);
  let bestPaycheck: PaycheckAssignment | null = null;
  let bestScore = -Infinity;

  for (let i = 0; i < paycheckAssignments.length; i++) {
    const paycheck = paycheckAssignments[i];
    const paycheckDateStr = format(paycheck.date, 'yyyy-MM-dd');

    const skipKey = `${bill.billId}-${paycheckDateStr}`;
    if (skippedBills.has(skipKey)) continue;

    if (isAfter(paycheck.date, bill.date)) continue;

    const daysEarly = differenceInDays(bill.date, paycheck.date);
    if (daysEarly > MAX_PREPAY_DAYS) continue;

    const pressure = buildPaycheckPressureSnapshot(paycheck, i, goalReservePerPaycheck);
    const score = scoreEligiblePaycheck(
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

export function findPreferredPaycheck(
  bill: ProjectedBill,
  paycheckAssignments: PaycheckAssignment[],
  skippedBills: Set<string>
): string | null {
  if (!bill.preferredIncomeSourceId) return null;

  // Find paychecks that have the preferred income source
  const matchingPaychecks = paycheckAssignments.filter(p =>
    p.incomes.some(inc => inc.sourceId === bill.preferredIncomeSourceId)
  );

  if (matchingPaychecks.length === 0) return null;

  // Find the best paycheck: closest to bill due date, but not more than MAX_PREPAY_DAYS early
  let bestPaycheck: PaycheckAssignment | null = null;
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

export function clonePaycheckAssignments(
  assignments: PaycheckAssignment[]
): PaycheckAssignment[] {
  return assignments.map((assignment) => ({
    date: assignment.date,
    incomes: [...assignment.incomes],
    bills: assignment.bills.map((bill) => ({
      ...bill,
      date: new Date(bill.date.getTime()),
    })),
  }));
}

export function dedupeAssignmentBills(assignments: PaycheckAssignment[]): void {
  for (const assignment of assignments) {
    const seen = new Set<string>();
    assignment.bills = assignment.bills.filter((bill) => {
      const key = billOccurrenceKey(bill.billId, bill.date);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }
}

export function calculateScheduleScore(paychecks: PaycheckEntry[], goals: SavingsGoal[]): number {
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

export function buildInitialPaycheckAssignments(
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
  paycheckAssignments: PaycheckAssignment[];
  manuallyAssignedBills: Set<string>;
} {
  const paycheckAssignments: PaycheckAssignment[] = [];

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
        manuallyAssignedBills.add(billOccurrenceKey(bill.billId, bill.date));
      }
    }
  }

  const remainingBills = allBills.filter(b =>
    !manuallyAssignedBills.has(billOccurrenceKey(b.billId, b.date))
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
    const paycheckDateStr = findPreferredPaycheck(
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
        assignedPreferenceBills.add(billOccurrenceKey(bill.billId, bill.date));
      }
    }
  }

  for (const bill of regularBills) {
    const billKey = billOccurrenceKey(bill.billId, bill.date);
    if (assignedPreferenceBills.has(billKey)) continue;

    const paycheckDateStr = findScoredAutomaticPaycheck(
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

export function assignBillsToPaychecks(
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
  const { paycheckAssignments, manuallyAssignedBills } = buildInitialPaycheckAssignments(
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

  const assignmentSnapshot = clonePaycheckAssignments(paycheckAssignments);
  let bestPaychecks: PaycheckEntry[] = [];
  let bestScore = -Infinity;

  for (const strategy of REBALANCE_STRATEGIES) {
    const trial = clonePaycheckAssignments(assignmentSnapshot);
    rebalanceBills(
      trial,
      manuallyAssignedBills,
      goals,
      minCashOnHand,
      minSavingsPerPaycheck,
      strategy
    );
    applyFundingPriority(
      trial,
      manuallyAssignedBills,
      goals,
      minCashOnHand,
      minSavingsPerPaycheck,
      strategy
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
    const score = calculateScheduleScore(paychecks, goals);
    if (score > bestScore) {
      bestScore = score;
      bestPaychecks = paychecks;
    }
  }

  return bestPaychecks;
}
