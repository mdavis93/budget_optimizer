import { parseISO, startOfDay } from 'date-fns';
import { monthsCoveringDate } from '@shared/monthsCoveringDate';
import type { BillPriority } from '@shared/billPriority';
import type { IncomePurpose, UnfundableReason } from '@shared/types';
import {
  DEFAULT_TARGET_CASH_ON_HAND,
  DEFAULT_MIN_CASH_ON_HAND,
  DEFAULT_MIN_SAVINGS_PER_PAYCHECK,
  MAX_PREPAY_DAYS,
  MAX_ADVISOR_EARLY_DAYS,
  SCHEDULE_CALCULATION_MONTHS,
  SCHEDULE_MAX_CALCULATION_MONTHS,
} from '@shared/constants';

// Canonical schedule model lives in the shared module; re-export so existing
// `from './types'` consumers across the scheduler keep resolving unchanged.
export type {
  BreakGlassAdvisorReport,
  BreakGlassPlan,
  BreakGlassPlanStep,
  GoalDeposit,
  GoalProjection,
  GoalScheduleHealth,
  GoalSuggestion,
  PaycheckBill,
  PaycheckEntry,
  ProposedFix,
  ReconciliationReport,
  ScheduleData,
  ScheduleEntry,
  ScheduleSummary,
  ShortfallDetail,
  UnfundableReason,
} from '@shared/types';

export {
  DEFAULT_TARGET_CASH_ON_HAND,
  DEFAULT_MIN_CASH_ON_HAND,
  DEFAULT_MIN_SAVINGS_PER_PAYCHECK,
  MAX_PREPAY_DAYS,
  MAX_ADVISOR_EARLY_DAYS,
  SCHEDULE_CALCULATION_MONTHS,
  SCHEDULE_MAX_CALCULATION_MONTHS,
};
export const SAVINGS_TARGET_PRIMARY = 150;
/** Fallback per-paycheck savings; below this (when goals consume the surplus) we warn. */
export const SAVINGS_TARGET_FALLBACK = 100;

/**
 * Resolve how many months the schedule should span: enough to cover the
 * latest goal deadline, clamped to [SCHEDULE_CALCULATION_MONTHS,
 * SCHEDULE_MAX_CALCULATION_MONTHS]. With no goals (or only short goals) this
 * stays at the 12-month default; a longer goal extends the horizon to the
 * deadline, and anything past the cap is left to the
 * projection/extrapolation path.
 */
export function resolveCalculationMonths(
  startDateStr: string,
  goals: ReadonlyArray<{ targetDate: string }> = []
): number {
  let maxMonths = SCHEDULE_CALCULATION_MONTHS;
  if (goals.length > 0) {
    const start = startOfDay(parseISO(startDateStr));
    for (const goal of goals) {
      if (!goal.targetDate) continue;
      const target = startOfDay(parseISO(goal.targetDate));
      const months = monthsCoveringDate(start, target);
      if (months > maxMonths) maxMonths = months;
    }
  }
  return Math.min(maxMonths, SCHEDULE_MAX_CALCULATION_MONTHS);
}

export interface DebtPayoffInfo {
  billId: string;
  payoffDate: Date;
  finalPaymentAmount: number;
}

export interface ProjectedIncome {
  date: Date;
  sourceId: string;
  sourceName: string;
  amount: number;
  purpose?: IncomePurpose;
  /** Restored leading-leave slot: exists so a bill can attach, never funds. */
  unusable?: boolean;
}

export interface ProjectedBill {
  date: Date;
  billId: string;
  creditorName: string;
  amount: number;
  dueDay: number;
  priority: BillPriority;
  category?: string;
  preferredIncomeSourceId?: string;
  isIncomeAttached?: boolean;
  isUnpayable?: boolean;
  isSkipped?: boolean;
  unfundableReason?: UnfundableReason;
}

export interface PaycheckAssignment {
  date: Date;
  incomes: ProjectedIncome[];
  bills: ProjectedBill[];
  purpose?: IncomePurpose;
  /** Restored leading-leave $0 slot. */
  unusable?: boolean;
}

export { billOccurrenceKey, billOccurrenceKeyFromIso } from '@shared/billOccurrence';
