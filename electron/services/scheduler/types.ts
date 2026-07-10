import {
  format,
  parseISO,
  startOfDay,
  addMonths,
  isBefore,
  differenceInCalendarMonths,
} from 'date-fns';
import type { UnfundableReason } from '@shared/types';

// Canonical schedule model lives in the shared module; re-export so existing
// `from './types'` consumers across the scheduler keep resolving unchanged.
export type {
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

export const DEFAULT_TARGET_CASH_ON_HAND = 250;
export const DEFAULT_MIN_CASH_ON_HAND = 100;
/** Preferred per-paycheck savings once goals are funded on-pace. */
export const SAVINGS_TARGET_PRIMARY = 150;
/** Fallback per-paycheck savings; below this (when goals consume the surplus) we warn. */
export const SAVINGS_TARGET_FALLBACK = 100;
export const MAX_PREPAY_DAYS = 14; // Bills cannot be paid more than 14 days early
/** Floor (and default) calculation horizon in months. */
export const SCHEDULE_CALCULATION_MONTHS = 12;
/** Cap on the calculation horizon; goals beyond this fall back to projection. */
export const SCHEDULE_MAX_CALCULATION_MONTHS = 60;

/**
 * Resolve how many months the schedule should span: enough to cover the
 * latest goal deadline, clamped to [SCHEDULE_CALCULATION_MONTHS,
 * SCHEDULE_MAX_CALCULATION_MONTHS]. With no goals (or only short goals) this
 * stays at the 12-month default; a longer goal extends the horizon so funding
 * is paced over its true timeline, and anything past the cap is left to the
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
      if (!isBefore(start, target)) continue; // deadline already passed / today
      // Whole months from start, rounded up so addMonths(start, m) >= target.
      let months = Math.max(0, differenceInCalendarMonths(target, start));
      while (isBefore(addMonths(start, months), target)) months++;
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
}

export interface ProjectedBill {
  date: Date;
  billId: string;
  creditorName: string;
  amount: number;
  dueDay: number;
  priority: 'critical' | 'high' | 'normal' | 'low';
  category?: string;
  preferredIncomeSourceId?: string;
  isIncomeAttached?: boolean;
  isUnpayable?: boolean;
  unfundableReason?: UnfundableReason;
}

export interface PaycheckAssignment {
  date: Date;
  incomes: ProjectedIncome[];
  bills: ProjectedBill[];
}

export function billOccurrenceKey(billId: string, date: Date): string {
  return `${billId}-${format(date, 'yyyy-MM-dd')}`;
}
