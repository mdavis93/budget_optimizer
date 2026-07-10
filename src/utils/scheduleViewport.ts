import { addMonths, format, isAfter, parseISO, startOfDay } from 'date-fns';
import {
  calculateSummary,
  convertToLegacyEntries,
  generateRecommendations,
} from '@shared/schedulePresentation';
import { rebuildReconciliationForViewport } from '@shared/scheduleViewportSlice';
import { Bill, PaycheckEntry, ScheduleData } from '../types';

export const SCHEDULE_CALCULATION_MONTHS = 12;

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

  const reconciliation = rebuildReconciliationForViewport(
    fullSchedule.reconciliation,
    viewportPaychecks
  );

  return {
    ...fullSchedule,
    endDate: viewportEndDate,
    paychecks: viewportPaychecks,
    viewportMonths,
    entries: convertToLegacyEntries(viewportPaychecks, startingBalance),
    summary: calculateSummary(viewportPaychecks, startingBalance, fullSchedule.maxBudgetRemaining),
    recommendations: generateRecommendations(
      viewportPaychecks,
      bills,
      startingBalance,
      fullSchedule.savingsSqueezedCount
    ),
    reconciliation,
  };
}
