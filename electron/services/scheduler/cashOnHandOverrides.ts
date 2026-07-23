import type { Leave } from '../database.service';

export interface CashOnHandByDate {
  targetByDate: Map<string, number>;
  minByDate: Map<string, number>;
}

function hasCashOverride(leave: Leave): boolean {
  return leave.targetCashOnHand !== undefined || leave.minCashOnHand !== undefined;
}

function datesInRange(paycheckDates: string[], startDate: string, endDate: string): string[] {
  return paycheckDates.filter((date) => date >= startDate && date <= endDate);
}

/**
 * Dates where an unpaid leave's temporary cash overrides apply:
 * - paychecks in [start, end]
 * - if none exist in range (omission gap), also the last paycheck before start
 *   and the first paycheck after end
 */
export function leaveCashOverrideDates(
  paycheckDates: string[],
  leave: Leave
): string[] {
  const inRange = datesInRange(paycheckDates, leave.startDate, leave.endDate);
  if (inRange.length > 0) {
    return inRange;
  }

  const borders: string[] = [];
  for (let i = paycheckDates.length - 1; i >= 0; i--) {
    if (paycheckDates[i] < leave.startDate) {
      borders.push(paycheckDates[i]);
      break;
    }
  }
  for (let i = 0; i < paycheckDates.length; i++) {
    if (paycheckDates[i] > leave.endDate) {
      borders.push(paycheckDates[i]);
      break;
    }
  }
  return borders;
}

/**
 * Resolve effective target/min cash-on-hand per paycheck date.
 * Unpaid leaves with overrides take the minimum value among applicable leaves;
 * then clamp so min ≤ target for each date.
 */
export function resolvePaycheckCashOnHand(
  paycheckDates: string[],
  leaves: Leave[],
  budgetTarget: number,
  budgetMin: number
): CashOnHandByDate {
  const targetByDate = new Map<string, number>();
  const minByDate = new Map<string, number>();

  for (const date of paycheckDates) {
    targetByDate.set(date, budgetTarget);
    minByDate.set(date, budgetMin);
  }

  const unpaidWithOverrides = leaves.filter(
    (leave) => leave.type === 'unpaid' && hasCashOverride(leave)
  );

  for (const leave of unpaidWithOverrides) {
    const dates = leaveCashOverrideDates(paycheckDates, leave);
    for (const date of dates) {
      if (leave.targetCashOnHand !== undefined) {
        const current = targetByDate.get(date) ?? budgetTarget;
        targetByDate.set(date, Math.min(current, leave.targetCashOnHand));
      }
      if (leave.minCashOnHand !== undefined) {
        const current = minByDate.get(date) ?? budgetMin;
        minByDate.set(date, Math.min(current, leave.minCashOnHand));
      }
    }
  }

  for (const date of paycheckDates) {
    const target = targetByDate.get(date) ?? budgetTarget;
    const min = minByDate.get(date) ?? budgetMin;
    if (min > target) {
      minByDate.set(date, target);
    }
  }

  return { targetByDate, minByDate };
}

export function cashTargetForDate(
  cashByDate: CashOnHandByDate | undefined,
  date: string,
  budgetTarget: number
): number {
  return cashByDate?.targetByDate.get(date) ?? budgetTarget;
}

export function cashMinForDate(
  cashByDate: CashOnHandByDate | undefined,
  date: string,
  budgetMin: number
): number {
  return cashByDate?.minByDate.get(date) ?? budgetMin;
}
