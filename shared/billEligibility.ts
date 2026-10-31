import { MAX_PREPAY_DAYS } from './constants';

/**
 * Longest stretch a bill may be prepaid when no paycheck falls inside the
 * MAX_PREPAY_DAYS window (monthly earners). Longer gaps (leave, job end) stay unpayable.
 */
export const MAX_FALLBACK_PREPAY_DAYS = 31;

const MS_PER_DAY = 86_400_000;

/** Calendar day number of a local date; uses UTC of the local Y/M/D so DST never shifts it. */
export function dayNumberOfDate(date: Date): number {
  return Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / MS_PER_DAY);
}

/** Calendar day number of a `yyyy-MM-dd` string. */
export function dayNumberOfIsoDate(isoDate: string): number {
  const [year, month, day] = isoDate.slice(0, 10).split('-').map(Number);
  return Math.round(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

/**
 * Indices of paychecks a bill due on `dueDay` may use. Usable paychecks
 * (`isUsable` applies skips, savings-only income and preferred-source filters)
 * dated in [due - MAX_PREPAY_DAYS, due] qualify. When none does, the latest usable
 * paycheck on or before the due date within MAX_FALLBACK_PREPAY_DAYS qualifies alone.
 * Returned indices are ascending.
 */
export function eligiblePaycheckIndices(
  dueDay: number,
  paycheckDays: readonly number[],
  isUsable: (index: number) => boolean = () => true
): number[] {
  const indices: number[] = [];
  let fallbackIndex = -1;
  let fallbackDaysEarly = Infinity;

  for (let index = 0; index < paycheckDays.length; index++) {
    const daysEarly = dueDay - paycheckDays[index];
    if (daysEarly < 0 || daysEarly > MAX_FALLBACK_PREPAY_DAYS) continue;
    if (!isUsable(index)) continue;
    if (daysEarly <= MAX_PREPAY_DAYS) {
      indices.push(index);
    } else if (daysEarly < fallbackDaysEarly) {
      fallbackIndex = index;
      fallbackDaysEarly = daysEarly;
    }
  }

  if (indices.length === 0 && fallbackIndex !== -1) indices.push(fallbackIndex);
  return indices;
}

/**
 * Shared usable-paycheck rule for engine, reconciliation, advisor, and drag.
 * Operating paychecks qualify. Savings-only and restored $0 leave slots do not.
 * When `preferredIncomeSourceId` is set and the paycheck publishes source ids,
 * that source must be present. A date-only paycheck (no source ids) stays usable
 * so callers that only have dates keep the "all operating" meaning.
 */
export function isFundingPaycheckUsable(
  paycheck: {
    purpose?: string;
    unusable?: boolean;
    incomeSourceIds?: readonly string[];
  },
  preferredIncomeSourceId?: string
): boolean {
  if (paycheck.unusable) return false;
  if (paycheck.purpose === 'savingsAndGoals') return false;
  if (!preferredIncomeSourceId || paycheck.incomeSourceIds == null) return true;
  return paycheck.incomeSourceIds.includes(preferredIncomeSourceId);
}
