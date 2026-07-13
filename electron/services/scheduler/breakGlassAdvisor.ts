import { differenceInDays, format, isAfter, isBefore, parseISO, startOfDay } from 'date-fns';
import type {
  BreakGlassAdvisorReport,
  BreakGlassPlan,
  BreakGlassPlanStep,
  PaycheckBill,
  PaycheckEntry,
  ScheduleData,
} from './types';

import {
  DEFAULT_MIN_CASH_ON_HAND,
  DEFAULT_TARGET_CASH_ON_HAND,
  MAX_ADVISOR_EARLY_DAYS,
  MAX_PREPAY_DAYS,
} from './types';

const MAX_ADVISOR_PLANS = 5;
const MAX_ADVISOR_PLAN_STEPS = 12;
const MAX_ADVISOR_CASCADE_DEPTH = 8;

export interface ProposeBreakGlassOptions {
  scheduleStartDate?: string;
  maxEarlyDays?: number;
  targetCashOnHand?: number;
  minCashOnHand?: number;
  /** Manual-locked occurrence keys (`billId-yyyy-MM-dd`); treated as fixed sources. */
  lockedBillKeys?: Set<string>;
}

interface SimPaycheck {
  date: string;
  budgetRemaining: number;
  bills: PaycheckBill[];
}

type BillSort = 'amount-desc' | 'amount-asc' | 'priority-desc';

const PRIORITY_RANK: Record<PaycheckBill['priority'], number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

function occurrenceKey(billId: string, billDate: string): string {
  return `${billId}-${billDate}`;
}

function isBreakGlassRemaining(
  budgetRemaining: number,
  targetCashOnHand: number,
  minCashOnHand: number
): boolean {
  return budgetRemaining < targetCashOnHand && budgetRemaining >= minCashOnHand;
}

function cloneSim(paychecks: PaycheckEntry[]): SimPaycheck[] {
  return paychecks.map((paycheck) => ({
    date: paycheck.date,
    budgetRemaining: paycheck.budgetRemaining,
    bills: paycheck.bills.map((bill) => ({ ...bill })),
  }));
}

function receiveRoom(budgetRemaining: number, minCashOnHand: number): number {
  return Math.max(0, budgetRemaining - minCashOnHand);
}

function isMovable(
  bill: PaycheckBill,
  lockedBillKeys: Set<string>
): boolean {
  if (bill.isIncomeAttached || bill.isUnpayable || bill.isSkipped) return false;
  return !lockedBillKeys.has(occurrenceKey(bill.billId, bill.billDate));
}

function placementLegality(
  billDate: string,
  paycheckDate: string,
  scheduleStartDate: string,
  maxEarlyDays: number
): { ok: true; daysEarly: number } | { ok: false } {
  const due = startOfDay(parseISO(billDate));
  const pay = startOfDay(parseISO(paycheckDate));
  const start = startOfDay(parseISO(scheduleStartDate));

  if (isBefore(pay, start)) return { ok: false };
  if (isAfter(pay, due)) return { ok: false };

  const daysEarly = differenceInDays(due, pay);
  if (daysEarly > maxEarlyDays) return { ok: false };
  return { ok: true, daysEarly };
}

function sortMovable(bills: PaycheckBill[], sort: BillSort): PaycheckBill[] {
  const copy = [...bills];
  if (sort === 'amount-desc') {
    copy.sort((a, b) => b.amount - a.amount || a.creditorName.localeCompare(b.creditorName));
  } else if (sort === 'amount-asc') {
    copy.sort((a, b) => a.amount - b.amount || a.creditorName.localeCompare(b.creditorName));
  } else {
    copy.sort(
      (a, b) =>
        PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
        b.amount - a.amount ||
        a.creditorName.localeCompare(b.creditorName)
    );
  }
  return copy;
}

function applyMove(sim: SimPaycheck[], fromIndex: number, toIndex: number, bill: PaycheckBill): void {
  const from = sim[fromIndex];
  const to = sim[toIndex];
  const billIndex = from.bills.findIndex(
    (candidate) => candidate.billId === bill.billId && candidate.billDate === bill.billDate
  );
  if (billIndex < 0) return;
  from.bills.splice(billIndex, 1);
  to.bills.push({ ...bill });
  from.budgetRemaining += bill.amount;
  to.budgetRemaining -= bill.amount;
}

function makeStep(
  bill: PaycheckBill,
  fromPaycheckDate: string,
  toPaycheckDate: string,
  daysEarly: number
): BreakGlassPlanStep {
  return {
    billId: bill.billId,
    billName: bill.creditorName,
    billAmount: bill.amount,
    billDueDate: bill.billDate,
    fromPaycheckDate,
    toPaycheckDate,
    daysEarly,
    requiresConfirmation: daysEarly > MAX_PREPAY_DAYS,
  };
}

function hasShortfall(sim: SimPaycheck[], minCashOnHand: number): boolean {
  return sim.some((paycheck) => paycheck.budgetRemaining < minCashOnHand);
}

/**
 * Free enough room on `index` to receive `amountNeeded` without going below min.
 * Appends cascade steps and mutates `sim`. Returns false if impossible within caps.
 */
function ensureReceiveRoom(
  sim: SimPaycheck[],
  index: number,
  amountNeeded: number,
  minCashOnHand: number,
  scheduleStartDate: string,
  maxEarlyDays: number,
  lockedBillKeys: Set<string>,
  sort: BillSort,
  steps: BreakGlassPlanStep[],
  depth: number
): boolean {
  if (amountNeeded <= 0) return true;
  if (receiveRoom(sim[index].budgetRemaining, minCashOnHand) >= amountNeeded) return true;
  if (depth >= MAX_ADVISOR_CASCADE_DEPTH || steps.length >= MAX_ADVISOR_PLAN_STEPS) {
    return false;
  }

  for (const bill of sortMovable(
    sim[index].bills.filter((candidate) => isMovable(candidate, lockedBillKeys)),
    sort
  )) {
    if (steps.length >= MAX_ADVISOR_PLAN_STEPS) break;

    const earlierCandidates: Array<{ index: number; daysEarly: number }> = [];
    for (let earlier = index - 1; earlier >= 0; earlier--) {
      const legality = placementLegality(
        bill.billDate,
        sim[earlier].date,
        scheduleStartDate,
        maxEarlyDays
      );
      if (legality.ok) earlierCandidates.push({ index: earlier, daysEarly: legality.daysEarly });
    }

    for (const { index: earlierIndex, daysEarly } of earlierCandidates) {
      const snapshotLength = steps.length;
      const snapshotSim = cloneSimAsSim(sim);

      if (
        !ensureReceiveRoom(
          sim,
          earlierIndex,
          bill.amount,
          minCashOnHand,
          scheduleStartDate,
          maxEarlyDays,
          lockedBillKeys,
          sort,
          steps,
          depth + 1
        )
      ) {
        restoreSim(sim, snapshotSim);
        steps.length = snapshotLength;
        continue;
      }

      applyMove(sim, index, earlierIndex, bill);
      steps.push(makeStep(bill, sim[index].date, sim[earlierIndex].date, daysEarly));

      if (receiveRoom(sim[index].budgetRemaining, minCashOnHand) >= amountNeeded) {
        return true;
      }
    }
  }

  return receiveRoom(sim[index].budgetRemaining, minCashOnHand) >= amountNeeded;
}

function cloneSimAsSim(sim: SimPaycheck[]): SimPaycheck[] {
  return sim.map((paycheck) => ({
    date: paycheck.date,
    budgetRemaining: paycheck.budgetRemaining,
    bills: paycheck.bills.map((bill) => ({ ...bill })),
  }));
}

function restoreSim(target: SimPaycheck[], source: SimPaycheck[]): void {
  for (let index = 0; index < target.length; index++) {
    target[index].budgetRemaining = source[index].budgetRemaining;
    target[index].bills = source[index].bills.map((bill) => ({ ...bill }));
  }
}

function tryClearBreakGlass(
  base: SimPaycheck[],
  targetIndex: number,
  targetCashOnHand: number,
  minCashOnHand: number,
  scheduleStartDate: string,
  maxEarlyDays: number,
  lockedBillKeys: Set<string>,
  sort: BillSort
): BreakGlassPlanStep[] | null {
  const sim = cloneSimAsSim(base);
  const steps: BreakGlassPlanStep[] = [];
  let guard = 0;

  while (sim[targetIndex].budgetRemaining < targetCashOnHand && guard++ < MAX_ADVISOR_PLAN_STEPS) {
    let moved = false;

    for (const bill of sortMovable(
      sim[targetIndex].bills.filter((candidate) => isMovable(candidate, lockedBillKeys)),
      sort
    )) {
      const earlierCandidates: Array<{ index: number; daysEarly: number }> = [];
      for (let earlier = targetIndex - 1; earlier >= 0; earlier--) {
        const legality = placementLegality(
          bill.billDate,
          sim[earlier].date,
          scheduleStartDate,
          maxEarlyDays
        );
        if (legality.ok) earlierCandidates.push({ index: earlier, daysEarly: legality.daysEarly });
      }

      for (const { index: earlierIndex, daysEarly } of earlierCandidates) {
        const snapshotLength = steps.length;
        const snapshotSim = cloneSimAsSim(sim);

        if (
          !ensureReceiveRoom(
            sim,
            earlierIndex,
            bill.amount,
            minCashOnHand,
            scheduleStartDate,
            maxEarlyDays,
            lockedBillKeys,
            sort,
            steps,
            0
          )
        ) {
          restoreSim(sim, snapshotSim);
          steps.length = snapshotLength;
          continue;
        }

        applyMove(sim, targetIndex, earlierIndex, bill);
        steps.push(makeStep(bill, sim[targetIndex].date, sim[earlierIndex].date, daysEarly));
        moved = true;
        break;
      }
      if (moved) break;
    }

    if (!moved) return null;
  }

  if (sim[targetIndex].budgetRemaining < targetCashOnHand) return null;
  if (hasShortfall(sim, minCashOnHand)) return null;
  if (steps.length === 0 || steps.length > MAX_ADVISOR_PLAN_STEPS) return null;
  return steps;
}

function maxDaysEarly(steps: BreakGlassPlanStep[]): number {
  return steps.reduce((max, step) => Math.max(max, step.daysEarly), 0);
}

/** Lower is better. Prefer lower max early days, then fewer moves, then earlier landings. */
function comparePlans(a: BreakGlassPlanStep[], b: BreakGlassPlanStep[]): number {
  const maxA = maxDaysEarly(a);
  const maxB = maxDaysEarly(b);
  if (maxA !== maxB) return maxA - maxB;
  if (a.length !== b.length) return a.length - b.length;

  const earliestLanding = (steps: BreakGlassPlanStep[]) =>
    Math.min(...steps.map((step) => parseISO(step.toPaycheckDate).getTime()));
  return earliestLanding(a) - earliestLanding(b);
}

function formatHeadline(targetPaycheckDate: string): string {
  const label = format(parseISO(targetPaycheckDate), 'MMM d');
  return `Clear Break-Glass on ${label}`;
}

/**
 * Propose human-confirmed cascades for residual Break-Glass paychecks after
 * auto rebalance. May use up to `maxEarlyDays` (default 21); never auto-applied.
 */
export function proposeBreakGlassPlans(
  schedule: ScheduleData,
  options: ProposeBreakGlassOptions = {}
): BreakGlassAdvisorReport {
  const paychecks = schedule.fullPaychecks?.length
    ? schedule.fullPaychecks
    : schedule.paychecks;
  if (!paychecks.length) {
    return { plans: [] };
  }

  const targetCashOnHand =
    options.targetCashOnHand ?? schedule.maxBudgetRemaining ?? DEFAULT_TARGET_CASH_ON_HAND;
  const minCashOnHand =
    options.minCashOnHand ?? schedule.minCashOnHand ?? DEFAULT_MIN_CASH_ON_HAND;
  const maxEarlyDays = options.maxEarlyDays ?? MAX_ADVISOR_EARLY_DAYS;
  const scheduleStartDate = options.scheduleStartDate ?? schedule.startDate;
  const lockedBillKeys = options.lockedBillKeys ?? new Set<string>();

  const sim = cloneSim(paychecks);
  const plans: BreakGlassPlan[] = [];
  let planId = 1;
  const unsolvable = new Set<string>();

  const sorts: BillSort[] = ['amount-desc', 'amount-asc', 'priority-desc'];

  while (plans.length < MAX_ADVISOR_PLANS) {
    const index = sim.findIndex(
      (paycheck) =>
        !unsolvable.has(paycheck.date) &&
        isBreakGlassRemaining(paycheck.budgetRemaining, targetCashOnHand, minCashOnHand)
    );
    if (index < 0) break;

    let bestSteps: BreakGlassPlanStep[] | null = null;
    for (const sort of sorts) {
      const candidate = tryClearBreakGlass(
        sim,
        index,
        targetCashOnHand,
        minCashOnHand,
        scheduleStartDate,
        maxEarlyDays,
        lockedBillKeys,
        sort
      );
      if (!candidate) continue;
      if (!bestSteps || comparePlans(candidate, bestSteps) < 0) {
        bestSteps = candidate;
      }
    }

    if (!bestSteps) {
      unsolvable.add(sim[index].date);
      continue;
    }

    replaySteps(sim, bestSteps);

    plans.push({
      id: `break-glass-${planId++}`,
      targetPaycheckDate: sim[index].date,
      headline: formatHeadline(sim[index].date),
      steps: bestSteps,
      maxDaysEarly: maxDaysEarly(bestSteps),
      clearsBreakGlass: true,
    });
  }

  return { plans };
}

function replaySteps(sim: SimPaycheck[], steps: BreakGlassPlanStep[]): void {
  for (const step of steps) {
    const fromIndex = sim.findIndex((paycheck) => paycheck.date === step.fromPaycheckDate);
    const toIndex = sim.findIndex((paycheck) => paycheck.date === step.toPaycheckDate);
    if (fromIndex < 0 || toIndex < 0) continue;
    const bill = sim[fromIndex].bills.find(
      (candidate) =>
        candidate.billId === step.billId && candidate.billDate === step.billDueDate
    );
    if (!bill) continue;
    applyMove(sim, fromIndex, toIndex, bill);
  }
}
