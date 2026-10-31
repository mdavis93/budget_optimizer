import {
  DEFAULT_MIN_CASH_ON_HAND,
  DEFAULT_TARGET_CASH_ON_HAND,
} from '@shared/constants';
import type { PaycheckEntry } from '@shared/types';
import { toCents } from '../money';

/**
 * Lexicographic schedule objective. The smaller vector wins.
 * T0 unpaid cents of pinned bills (manual locks and income-attached bills).
 * T1–T4 unpaid cents for critical, high, normal, and low bills.
 * T5 cents below the minimum cash floor.
 * T6 cents below the petty-cash target.
 * T7 whole-dollar-days paid before the due date.
 * Pinned unpaid cents stay in T0 and are not also counted in T1–T4.
 * Cash tiers skip reserved deposit paychecks.
 */
export const TIER_COUNT = 8;

export const UNPAID_PLACEMENT = -1;

const MS_PER_DAY = 86_400_000;

export type BillPriority = 'critical' | 'high' | 'normal' | 'low';

export type TierVector = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

const PRIORITY_TIER: Record<BillPriority, 1 | 2 | 3 | 4> = {
  critical: 1,
  high: 2,
  normal: 3,
  low: 4,
};

export interface ObjectiveBill {
  amountCents: number;
  priority: BillPriority;
  /** UTC day number of the due date. */
  dueDay: number;
  /** Unpaid cents count toward T0 instead of the priority tier. */
  isPinned?: boolean;
}

export interface ObjectivePaycheck {
  /** UTC day number of the paycheck date. */
  day: number;
  remainingCents: number;
  minCashCents: number;
  targetCashCents: number;
  /**
   * Reserved deposit paychecks do not contribute to T5 or T6.
   * Omitted paychecks are operating paychecks.
   */
  countsTowardCashFloors?: boolean;
}

export interface ObjectiveInput {
  bills: readonly ObjectiveBill[];
  paychecks: readonly ObjectivePaycheck[];
  /** Index-aligned with `bills`. `UNPAID_PLACEMENT` leaves the bill unpaid. */
  placement: readonly number[];
}

export function isoDateToDayNumber(isoDate: string): number {
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  const day = Number(isoDate.slice(8, 10));
  return Math.floor(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

function zeroTiers(): [number, number, number, number, number, number, number, number] {
  return [0, 0, 0, 0, 0, 0, 0, 0];
}

function assertPlacement(input: ObjectiveInput): void {
  if (input.placement.length !== input.bills.length) {
    throw new Error(
      `objective placement length ${input.placement.length} does not match ${input.bills.length} bills`
    );
  }

  for (const paycheckIndex of input.placement) {
    if (paycheckIndex === UNPAID_PLACEMENT) continue;
    if (
      !Number.isInteger(paycheckIndex) ||
      paycheckIndex < 0 ||
      paycheckIndex >= input.paychecks.length
    ) {
      throw new Error(`objective placement ${paycheckIndex} is outside the paycheck list`);
    }
  }
}

export function scoreObjective(input: ObjectiveInput): TierVector {
  assertPlacement(input);
  const tiers = zeroTiers();

  for (let index = 0; index < input.bills.length; index++) {
    const bill = input.bills[index];
    const paycheckIndex = input.placement[index];
    if (paycheckIndex === UNPAID_PLACEMENT) {
      const tier = bill.isPinned ? 0 : PRIORITY_TIER[bill.priority];
      tiers[tier] += bill.amountCents;
      continue;
    }

    const daysEarly = bill.dueDay - input.paychecks[paycheckIndex].day;
    if (daysEarly > 0) {
      tiers[7] += Math.round(bill.amountCents / 100) * daysEarly;
    }
  }

  for (const paycheck of input.paychecks) {
    if (paycheck.countsTowardCashFloors === false) continue;
    tiers[5] += Math.max(0, paycheck.minCashCents - paycheck.remainingCents);
    tiers[6] += Math.max(0, paycheck.targetCashCents - paycheck.remainingCents);
  }

  return tiers;
}

/**
 * Negative when `left` is the better (smaller) objective.
 */
export function compareTierVectors(left: TierVector, right: TierVector): number {
  for (let index = 0; index < TIER_COUNT; index++) {
    if (left[index] !== right[index]) {
      return left[index] < right[index] ? -1 : 1;
    }
  }
  return 0;
}

function occurrenceKey(billId: string, dueDate: string): string {
  return `${billId}-${dueDate}`;
}

/**
 * Score paychecks produced by the current engine.
 * `lockedOccurrenceKeys` are manual locks (`billId-dueDate`).
 * Income-attached bills are pinned from their own flag.
 * T5 and T6 use each paycheck's published `budgetRemaining` with its unpaid
 * bills added back. The engine deducts unpaid bills from `budgetRemaining`;
 * the objective counts only cash spent on paid bills.
 */
export function scoreSchedule(
  paychecks: readonly PaycheckEntry[],
  lockedOccurrenceKeys: ReadonlySet<string> = new Set()
): TierVector {
  const bills: ObjectiveBill[] = [];
  const placement: number[] = [];
  const unpaidCentsByPaycheck = paychecks.map(() => 0);

  paychecks.forEach((paycheck, paycheckIndex) => {
    for (const bill of paycheck.bills) {
      if (bill.isSkipped) continue;
      const key = occurrenceKey(bill.billId, bill.billDate);
      const amountCents = toCents(bill.amount);
      bills.push({
        amountCents,
        priority: bill.priority,
        dueDay: isoDateToDayNumber(bill.billDate),
        isPinned: bill.isIncomeAttached === true || lockedOccurrenceKeys.has(key),
      });
      if (bill.isUnpayable === true) {
        placement.push(UNPAID_PLACEMENT);
        unpaidCentsByPaycheck[paycheckIndex] += amountCents;
      } else {
        placement.push(paycheckIndex);
      }
    }
  });

  const objectivePaychecks: ObjectivePaycheck[] = paychecks.map((paycheck, paycheckIndex) => ({
    day: isoDateToDayNumber(paycheck.date),
    remainingCents: toCents(paycheck.budgetRemaining) + unpaidCentsByPaycheck[paycheckIndex],
    minCashCents: toCents(paycheck.minCashOnHand ?? DEFAULT_MIN_CASH_ON_HAND),
    targetCashCents: toCents(paycheck.targetCashOnHand ?? DEFAULT_TARGET_CASH_ON_HAND),
    countsTowardCashFloors: paycheck.purpose !== 'savingsAndGoals',
  }));

  return scoreObjective({
    bills,
    paychecks: objectivePaychecks,
    placement,
  });
}
