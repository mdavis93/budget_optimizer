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
import { findPreferredPaycheck } from './scheduler/assignment';
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
import {
  assembleAssignedSchedule,
  assignPreparedHorizon,
  prepareScheduleHorizon,
} from './scheduler/scheduleBuild';
import { analyzeAndProposeFixes } from './scheduler/reconciliation';
import { proposeBreakGlassPlans } from './scheduler/breakGlassAdvisor';
import {
  DEFAULT_TARGET_CASH_ON_HAND,
  DEFAULT_MIN_CASH_ON_HAND,
  SCHEDULE_CALCULATION_MONTHS,
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
    leaves: Leave[] = [],
    preferredAssignments: Map<string, string> = new Map(),
    now?: Date
  ): ScheduleData {
    const prepared = prepareScheduleHorizon({
      incomes,
      bills,
      startDateStr,
      startingBalance,
      skippedBills,
      manualAssignments,
      maxBudgetRemaining,
      goals,
      minCashOnHand,
      minSavingsPerPaycheck,
      debtPayoffs,
      incomeOverrides,
      leaves,
    });
    const paychecks = assignPreparedHorizon(prepared, preferredAssignments);
    const fullSchedule = assembleAssignedSchedule(prepared, paychecks, {
      includePresentation: true,
      now,
    });
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
