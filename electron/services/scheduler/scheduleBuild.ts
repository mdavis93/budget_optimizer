import { addMonths, format, parseISO, startOfDay } from 'date-fns';
import type { Bill, Income, Leave, SavingsGoal } from '../database.service';
import { projectIncome, projectBills } from './projection';
import { applyProjectedIncomeAdjustments } from './incomeAdjustments';
import {
  resolvePaycheckCashOnHand,
  type CashOnHandByDate,
} from './cashOnHandOverrides';
import {
  assignBillsToPaychecks,
  getUniquePaycheckDates,
  pruneManualAssignmentsToPaychecks,
} from './assignment';
import {
  calculateSummary,
  convertToLegacyEntries,
  generateRecommendations,
} from './paychecks';
import { calculateGoalProjections } from './goals';
import {
  DEFAULT_MIN_CASH_ON_HAND,
  DEFAULT_TARGET_CASH_ON_HAND,
  billOccurrenceKey,
  resolveCalculationMonths,
  type DebtPayoffInfo,
  type PaycheckEntry,
  type ProjectedBill,
  type ProjectedIncome,
  type ScheduleData,
} from './types';

export interface PreparedScheduleHorizon {
  startDateStr: string;
  startDate: Date;
  endDate: Date;
  calcMonths: number;
  startingBalance: number;
  maxBudgetRemaining: number;
  minCashOnHand: number;
  minSavingsPerPaycheck: number;
  bills: Bill[];
  goals: SavingsGoal[];
  skippedBills: Set<string>;
  allIncomes: ProjectedIncome[];
  uniqueBills: ProjectedBill[];
  skippedForDisplay: ProjectedBill[];
  paycheckDates: Date[];
  incomeAttachedBillsRaw: Bill[];
  cashOnHandByDate: CashOnHandByDate;
  effectiveManualAssignments: Map<string, string>;
}

export interface PrepareScheduleHorizonInput {
  incomes: Income[];
  bills: Bill[];
  startDateStr: string;
  startingBalance: number;
  skippedBills?: Set<string>;
  manualAssignments?: Map<string, string>;
  maxBudgetRemaining?: number;
  goals?: SavingsGoal[];
  minCashOnHand?: number;
  minSavingsPerPaycheck?: number;
  debtPayoffs?: Map<string, DebtPayoffInfo>;
  incomeOverrides?: Map<string, number>;
  leaves?: Leave[];
}

const EMPTY_SUMMARY: ScheduleData['summary'] = {
  totalIncome: 0,
  totalExpenses: 0,
  totalSavingsDeposits: 0,
  finalSavingsBalance: 0,
  netBalance: 0,
  shortfallCount: 0,
  averageBalance: 0,
  lowestBalance: 0,
  highestBalance: 0,
};

export function prepareScheduleHorizon(
  input: PrepareScheduleHorizonInput
): PreparedScheduleHorizon {
  const skippedBills = input.skippedBills ?? new Set<string>();
  const manualAssignments = input.manualAssignments ?? new Map<string, string>();
  const maxBudgetRemaining = input.maxBudgetRemaining ?? DEFAULT_TARGET_CASH_ON_HAND;
  const goals = input.goals ?? [];
  const minCashOnHand = input.minCashOnHand ?? DEFAULT_MIN_CASH_ON_HAND;
  const minSavingsPerPaycheck = input.minSavingsPerPaycheck ?? 0;
  const debtPayoffs = input.debtPayoffs ?? new Map<string, DebtPayoffInfo>();
  const incomeOverrides = input.incomeOverrides ?? new Map<string, number>();
  const leaves = input.leaves ?? [];

  const startDate = startOfDay(parseISO(input.startDateStr));
  const calcMonths = resolveCalculationMonths(input.startDateStr, goals);
  const endDate = addMonths(startDate, calcMonths);

  const allIncomes: ProjectedIncome[] = [];
  for (const income of input.incomes) {
    allIncomes.push(...projectIncome(income, startDate, endDate));
  }

  applyProjectedIncomeAdjustments(allIncomes, leaves, incomeOverrides);

  const incomeAttachedBillsRaw = input.bills.filter(
    (bill) => bill.isIncomeAttached && bill.preferredIncomeSourceId
  );
  const regularBills = input.bills.filter((bill) => !bill.isIncomeAttached);

  const allBills: ProjectedBill[] = [];
  for (const bill of regularBills) {
    const debtInfo = debtPayoffs.get(bill.id);
    allBills.push(...projectBills(bill, startDate, endDate, debtInfo));
  }

  allIncomes.sort((a, b) => a.date.getTime() - b.date.getTime());
  allBills.sort((a, b) => a.date.getTime() - b.date.getTime());

  const seenBillKeys = new Set<string>();
  const skippedForDisplay: ProjectedBill[] = [];
  const uniqueBills = allBills.filter((bill) => {
    const dateStr = format(bill.date, 'yyyy-MM-dd');
    const skipKey = `${bill.billId}-${dateStr}`;
    const dedupKey = billOccurrenceKey(bill.billId, bill.date);

    if (seenBillKeys.has(dedupKey)) {
      return false;
    }
    seenBillKeys.add(dedupKey);

    if (skippedBills.has(skipKey)) {
      skippedForDisplay.push(bill);
      return false;
    }
    return true;
  });

  const paycheckDates = getUniquePaycheckDates(allIncomes);
  const effectiveManualAssignments = pruneManualAssignmentsToPaychecks(
    manualAssignments,
    paycheckDates
  );
  const cashOnHandByDate = resolvePaycheckCashOnHand(
    paycheckDates.map((date) => format(date, 'yyyy-MM-dd')),
    leaves,
    maxBudgetRemaining,
    minCashOnHand
  );

  return {
    startDateStr: input.startDateStr,
    startDate,
    endDate,
    calcMonths,
    startingBalance: input.startingBalance,
    maxBudgetRemaining,
    minCashOnHand,
    minSavingsPerPaycheck,
    bills: input.bills,
    goals,
    skippedBills,
    allIncomes,
    uniqueBills,
    skippedForDisplay,
    paycheckDates,
    incomeAttachedBillsRaw,
    cashOnHandByDate,
    effectiveManualAssignments,
  };
}

export function assignPreparedHorizon(
  prepared: PreparedScheduleHorizon,
  preferredAssignments: Map<string, string> = new Map()
): PaycheckEntry[] {
  const effectivePreferredAssignments = pruneManualAssignmentsToPaychecks(
    preferredAssignments,
    prepared.paycheckDates
  );
  return assignBillsToPaychecks(
    prepared.paycheckDates,
    prepared.allIncomes,
    prepared.uniqueBills,
    prepared.startingBalance,
    prepared.skippedBills,
    prepared.effectiveManualAssignments,
    prepared.incomeAttachedBillsRaw,
    prepared.maxBudgetRemaining,
    prepared.goals,
    prepared.minCashOnHand,
    prepared.minSavingsPerPaycheck,
    prepared.skippedForDisplay,
    prepared.cashOnHandByDate,
    effectivePreferredAssignments
  );
}

export function assembleAssignedSchedule(
  prepared: PreparedScheduleHorizon,
  paychecks: PaycheckEntry[],
  options: { includePresentation: boolean; now?: Date }
): ScheduleData {
  const savingsSqueezedCount = paychecks.filter(
    (paycheck) => paycheck.savingsSqueezed && !paycheck.isShortfall
  ).length;
  const startDate = format(prepared.startDate, 'yyyy-MM-dd');
  const endDate = format(prepared.endDate, 'yyyy-MM-dd');

  if (!options.includePresentation) {
    return {
      startDate,
      endDate,
      paychecks,
      fullPaychecks: paychecks,
      calculationMonths: prepared.calcMonths,
      savingsSqueezedCount,
      viewportMonths: prepared.calcMonths,
      entries: [],
      summary: EMPTY_SUMMARY,
      recommendations: [],
      maxBudgetRemaining: prepared.maxBudgetRemaining,
      minCashOnHand: prepared.minCashOnHand,
    };
  }

  const goalProjections = calculateGoalProjections(
    prepared.goals,
    paychecks,
    endDate,
    options.now
  );

  return {
    startDate,
    endDate,
    paychecks,
    fullPaychecks: paychecks,
    calculationMonths: prepared.calcMonths,
    savingsSqueezedCount,
    viewportMonths: prepared.calcMonths,
    entries: convertToLegacyEntries(paychecks, prepared.startingBalance),
    summary: calculateSummary(
      paychecks,
      prepared.startingBalance,
      prepared.maxBudgetRemaining
    ),
    recommendations: generateRecommendations(
      paychecks,
      prepared.bills,
      prepared.startingBalance,
      savingsSqueezedCount
    ),
    maxBudgetRemaining: prepared.maxBudgetRemaining,
    minCashOnHand: prepared.minCashOnHand,
    goalProjections,
  };
}
