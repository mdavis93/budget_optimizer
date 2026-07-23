import {
  addMonths,
  startOfDay,
  parseISO,
  format,
  isAfter,
} from 'date-fns';
import { Income, Bill, SavingsGoal } from './database.service';
import type { Leave } from './database.service';
import { projectIncome, projectBills } from './scheduler/projection';
import { applyProjectedIncomeAdjustments } from './scheduler/incomeAdjustments';
import { resolvePaycheckCashOnHand } from './scheduler/cashOnHandOverrides';
import { assignBillsToPaychecks, getUniquePaycheckDates, findPreferredPaycheck } from './scheduler/assignment';
import {
  convertToLegacyEntries,
  calculateSummary,
  generateRecommendations,
} from './scheduler/paychecks';
import {
  rebuildBreakGlassAdvisorForViewport,
  rebuildReconciliationForViewport,
} from '@shared/scheduleViewportSlice';
import { calculateGoalProjections, generateGoalProjections, computeGoalFundingTimeline } from './scheduler/goals';
import { analyzeAndProposeFixes } from './scheduler/reconciliation';
import { proposeBreakGlassPlans } from './scheduler/breakGlassAdvisor';
import {
  DEFAULT_TARGET_CASH_ON_HAND,
  DEFAULT_MIN_CASH_ON_HAND,
  SCHEDULE_CALCULATION_MONTHS,
  resolveCalculationMonths,
  billOccurrenceKey,
} from './scheduler/types';
import type { DebtPayoffInfo, ScheduleData } from './scheduler/types';

export {
  SCHEDULE_CALCULATION_MONTHS,
  SCHEDULE_MAX_CALCULATION_MONTHS,
  resolveCalculationMonths,
} from './scheduler/types';

export type {
  DebtPayoffInfo,
  PaycheckBill,
  GoalDeposit,
  PaycheckEntry,
  ScheduleEntry,
  ScheduleSummary,
  ProposedFix,
  ShortfallDetail,
  ReconciliationReport,
  BreakGlassAdvisorReport,
  BreakGlassPlan,
  BreakGlassPlanStep,
  GoalSuggestion,
  GoalScheduleHealth,
  GoalProjection,
  ScheduleData,
  UnfundableReason,
} from './scheduler/types';

export class SchedulerService {
  projectIncome = projectIncome;
  projectBills = projectBills;
  generateGoalProjections = generateGoalProjections;
  calculateGoalProjections = calculateGoalProjections;
  analyzeAndProposeFixes = analyzeAndProposeFixes;
  proposeBreakGlassPlans = proposeBreakGlassPlans;
  findPreferredPaycheck = findPreferredPaycheck;
  computeGoalFundingTimeline = computeGoalFundingTimeline;

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
    debtPayoffs: Map<string, DebtPayoffInfo> = new Map(),
    incomeOverrides: Map<string, number> = new Map(),
    leaves: Leave[] = []
  ): ScheduleData {
    const startDate = startOfDay(parseISO(startDateStr));
    // Horizon spans the latest goal deadline (clamped to [12, 60] months) so
    // goals of any length are paced over their real timeline.
    const calcMonths = resolveCalculationMonths(startDateStr, goals);
    const endDate = addMonths(startDate, calcMonths);

    const allIncomes: ReturnType<typeof projectIncome> = [];
    for (const income of incomes) {
      allIncomes.push(...projectIncome(income, startDate, endDate));
    }

    applyProjectedIncomeAdjustments(allIncomes, leaves, incomeOverrides);

    // Separate income-attached bills from regular bills BEFORE projection
    // Income-attached bills don't use date-based projection - they attach to every matching paycheck
    const incomeAttachedBillsRaw = bills.filter(b => b.isIncomeAttached && b.preferredIncomeSourceId);
    const regularBills = bills.filter(b => !b.isIncomeAttached);

    const allBills: ReturnType<typeof projectBills> = [];
    for (const bill of regularBills) {
      const debtInfo = debtPayoffs.get(bill.id);
      allBills.push(...projectBills(bill, startDate, endDate, debtInfo));
    }

    allIncomes.sort((a, b) => a.date.getTime() - b.date.getTime());
    allBills.sort((a, b) => a.date.getTime() - b.date.getTime());

    // Split skipped occurrences (still shown in UI) from bills that need funding
    const seenBillKeys = new Set<string>();
    const skippedForDisplay: typeof allBills = [];
    const uniqueBills = allBills.filter(bill => {
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
    const cashOnHandByDate = resolvePaycheckCashOnHand(
      paycheckDates.map((d) => format(d, 'yyyy-MM-dd')),
      leaves,
      maxBudgetRemaining,
      minCashOnHand
    );

    const paychecks = assignBillsToPaychecks(
      paycheckDates,
      allIncomes,
      uniqueBills,
      startingBalance,
      skippedBills,
      manualAssignments,
      incomeAttachedBillsRaw,
      maxBudgetRemaining,
      goals,
      minCashOnHand,
      minSavingsPerPaycheck,
      skippedForDisplay,
      cashOnHandByDate
    );

    const goalProjections = calculateGoalProjections(
      goals,
      paychecks,
      format(endDate, 'yyyy-MM-dd')
    );

    // Full-horizon squeeze indicator, carried so viewport slicing can keep the
    // warning even when the squeezed paycheck falls outside the visible window.
    const savingsSqueezedCount = paychecks.filter(
      (p) => p.savingsSqueezed && !p.isShortfall
    ).length;

    const fullSchedule: ScheduleData = {
      startDate: format(startDate, 'yyyy-MM-dd'),
      endDate: format(endDate, 'yyyy-MM-dd'),
      paychecks,
      fullPaychecks: paychecks,
      calculationMonths: calcMonths,
      savingsSqueezedCount,
      viewportMonths: calcMonths,
      entries: convertToLegacyEntries(paychecks, startingBalance),
      summary: calculateSummary(paychecks, startingBalance, maxBudgetRemaining),
      recommendations: generateRecommendations(paychecks, bills, startingBalance, savingsSqueezedCount),
      maxBudgetRemaining,
      minCashOnHand,
      goalProjections,
    };

    return this.applyViewportFilter(fullSchedule, months, bills, startingBalance);
  }

  /**
   * Slice a full 12-month schedule to the requested viewport without recalculating assignments.
   */
  applyViewportFilter(
    fullSchedule: ScheduleData,
    viewportMonths: number,
    bills: Bill[],
    startingBalance: number
  ): ScheduleData {
    const horizonMonths = fullSchedule.calculationMonths ?? SCHEDULE_CALCULATION_MONTHS;
    if (viewportMonths >= horizonMonths) {
      const paychecks = fullSchedule.fullPaychecks;
      return {
        ...fullSchedule,
        paychecks,
        viewportMonths,
        entries: convertToLegacyEntries(paychecks, startingBalance),
        summary: calculateSummary(
          paychecks,
          startingBalance,
          fullSchedule.maxBudgetRemaining
        ),
        recommendations: generateRecommendations(
          paychecks,
          bills,
          startingBalance,
          fullSchedule.savingsSqueezedCount
        ),
        reconciliation: rebuildReconciliationForViewport(fullSchedule.reconciliation, paychecks),
        breakGlassAdvisor: rebuildBreakGlassAdvisorForViewport(
          fullSchedule.breakGlassAdvisor,
          paychecks
        ),
      };
    }

    const viewportEndDate = startOfDay(
      addMonths(parseISO(fullSchedule.startDate), viewportMonths)
    );
    const viewportPaychecks = fullSchedule.fullPaychecks.filter((paycheck) => {
      const paycheckDate = startOfDay(parseISO(paycheck.date));
      return !isAfter(paycheckDate, viewportEndDate);
    });

    const viewportEnd = format(viewportEndDate, 'yyyy-MM-dd');

    return {
      ...fullSchedule,
      endDate: viewportEnd,
      paychecks: viewportPaychecks,
      viewportMonths,
      entries: convertToLegacyEntries(viewportPaychecks, startingBalance),
      summary: calculateSummary(
        viewportPaychecks,
        startingBalance,
        fullSchedule.maxBudgetRemaining
      ),
      recommendations: generateRecommendations(
        viewportPaychecks,
        bills,
        startingBalance,
        fullSchedule.savingsSqueezedCount
      ),
      reconciliation: rebuildReconciliationForViewport(
        fullSchedule.reconciliation,
        viewportPaychecks
      ),
      breakGlassAdvisor: rebuildBreakGlassAdvisorForViewport(
        fullSchedule.breakGlassAdvisor,
        viewportPaychecks
      ),
    };
  }
}
