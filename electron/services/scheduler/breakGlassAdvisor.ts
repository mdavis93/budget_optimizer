import { format, parseISO, startOfDay } from 'date-fns';
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
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface ProposeBreakGlassOptions {
  scheduleStartDate?: string;
  maxEarlyDays?: number;
  targetCashOnHand?: number;
  minCashOnHand?: number;
  /** Manual-locked occurrence keys (`billId-yyyy-MM-dd`); treated as fixed sources. */
  lockedBillKeys?: Set<string>;
  /** Called once per original Break-Glass target considered (1-based). */
  onTarget?: (current: number, total: number) => void;
}

interface SimPaycheck {
  date: string;
  budgetRemaining: number;
  bills: PaycheckBill[];
  targetCashOnHand: number;
  minCashOnHand: number;
}

type BillSort = 'amount-desc' | 'amount-asc' | 'priority-desc';

const PRIORITY_RANK: Record<PaycheckBill['priority'], number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

interface LegalSlot {
  index: number;
  daysEarly: number;
}

interface AppliedMove {
  fromIndex: number;
  toIndex: number;
  bill: PaycheckBill;
}

interface SearchCtx {
  paycheckMs: number[];
  startMs: number;
  maxEarlyDays: number;
  /** Legal paycheck slots per bill due date (date-only; sort uses live balances). */
  legalSlotsByBillDate: Map<string, LegalSlot[]>;
}

let advisorSearchVisits = 0;

/** Test-only: reset DFS visit counter. */
export function resetAdvisorSearchVisits(): void {
  advisorSearchVisits = 0;
}

/** Test-only: nodes entered in `ensureReceiveRoom*`. */
export function getAdvisorSearchVisits(): number {
  return advisorSearchVisits;
}

function dayMs(isoDate: string): number {
  return startOfDay(parseISO(isoDate)).getTime();
}

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

function listBreakGlassDates(
  sim: SimPaycheck[]
): Array<{ date: string; budgetRemaining: number }> {
  return sim
    .filter((paycheck) =>
      isBreakGlassRemaining(
        paycheck.budgetRemaining,
        paycheck.targetCashOnHand,
        paycheck.minCashOnHand
      )
    )
    .map((paycheck) => ({
      date: paycheck.date,
      budgetRemaining: paycheck.budgetRemaining,
    }));
}

function horizonPaychecks(schedule: ScheduleData): PaycheckEntry[] {
  return schedule.fullPaychecks?.length ? schedule.fullPaychecks : schedule.paychecks;
}

/** Dates currently in the Break-Glass band on the assigned schedule (no search). */
export function listBreakGlassPaycheckDates(
  schedule: ScheduleData,
  options: ProposeBreakGlassOptions = {}
): string[] {
  const paychecks = horizonPaychecks(schedule);
  if (!paychecks.length) return [];
  const targetCashOnHand =
    options.targetCashOnHand ?? schedule.maxBudgetRemaining ?? DEFAULT_TARGET_CASH_ON_HAND;
  const minCashOnHand =
    options.minCashOnHand ?? schedule.minCashOnHand ?? DEFAULT_MIN_CASH_ON_HAND;
  return listBreakGlassDates(cloneSim(paychecks, targetCashOnHand, minCashOnHand)).map(
    (paycheck) => paycheck.date
  );
}

function cloneSim(
  paychecks: PaycheckEntry[],
  budgetTarget: number,
  budgetMin: number
): SimPaycheck[] {
  return paychecks.map((paycheck) => ({
    date: paycheck.date,
    budgetRemaining: paycheck.budgetRemaining,
    bills: paycheck.bills.map((bill) => ({ ...bill })),
    targetCashOnHand: paycheck.targetCashOnHand ?? budgetTarget,
    minCashOnHand: paycheck.minCashOnHand ?? budgetMin,
  }));
}

function spareAbove(budgetRemaining: number, floor: number): number {
  return Math.max(0, budgetRemaining - floor);
}

/**
 * Room a landing can give without widening Break-Glass: keep healthy paychecks
 * at/above target; already-BG paychecks may only dip to min (not shortfall).
 */
function receiveRoom(paycheck: SimPaycheck): number {
  const floor =
    paycheck.budgetRemaining >= paycheck.targetCashOnHand
      ? paycheck.targetCashOnHand
      : paycheck.minCashOnHand;
  return spareAbove(paycheck.budgetRemaining, floor);
}

/** True when a paycheck that started at/above target would drop below it. */
function healthyPaychecksRegressed(
  base: SimPaycheck[],
  sim: SimPaycheck[],
  targetIndex: number
): boolean {
  for (let index = 0; index < sim.length; index++) {
    if (index === targetIndex) continue;
    const startedHealthy = base[index].budgetRemaining >= base[index].targetCashOnHand;
    if (startedHealthy && sim[index].budgetRemaining < sim[index].targetCashOnHand) {
      return true;
    }
  }
  return false;
}

function isMovable(
  bill: PaycheckBill,
  lockedBillKeys: Set<string>,
  options: { ignoreLocks?: boolean } = {}
): boolean {
  if (bill.isIncomeAttached || bill.isUnpayable || bill.isSkipped) return false;
  if (options.ignoreLocks) return true;
  return !lockedBillKeys.has(occurrenceKey(bill.billId, bill.billDate));
}

function targetMovableMass(paycheck: SimPaycheck, lockedBillKeys: Set<string>): number {
  let sum = 0;
  for (const bill of paycheck.bills) {
    if (isMovable(bill, lockedBillKeys, { ignoreLocks: true })) {
      sum += bill.amount;
    }
  }
  return sum;
}

/** Destination can absorb `amount` while staying at/above the target CoH. */
function leavesAtOrAboveTarget(
  rem: number,
  amount: number,
  targetCashOnHand: number
): boolean {
  return rem - amount >= targetCashOnHand;
}

function placementLegalityMs(
  dueMs: number,
  payMs: number,
  startMs: number,
  maxEarlyDays: number
): { ok: true; daysEarly: number } | { ok: false } {
  if (payMs < startMs) return { ok: false };
  if (payMs > dueMs) return { ok: false };
  const daysEarly = Math.round((dueMs - payMs) / MS_PER_DAY);
  if (daysEarly > maxEarlyDays) return { ok: false };
  return { ok: true, daysEarly };
}

function buildSearchCtx(
  sim: SimPaycheck[],
  scheduleStartDate: string,
  maxEarlyDays: number
): SearchCtx {
  const paycheckMs = sim.map((paycheck) => dayMs(paycheck.date));
  const startMs = dayMs(scheduleStartDate);
  const legalSlotsByBillDate = new Map<string, LegalSlot[]>();
  const billDates = new Set<string>();
  for (const paycheck of sim) {
    for (const bill of paycheck.bills) {
      billDates.add(bill.billDate);
    }
  }
  for (const billDate of billDates) {
    const dueMs = dayMs(billDate);
    const slots: LegalSlot[] = [];
    for (let index = 0; index < sim.length; index++) {
      const legality = placementLegalityMs(dueMs, paycheckMs[index], startMs, maxEarlyDays);
      if (legality.ok) {
        slots.push({ index, daysEarly: legality.daysEarly });
      }
    }
    legalSlotsByBillDate.set(billDate, slots);
  }
  return { paycheckMs, startMs, maxEarlyDays, legalSlotsByBillDate };
}

/** Test-only: trial order for a sort strategy. Locks amount-asc vs name-only. */
export function sortMovable(bills: PaycheckBill[], sort: BillSort): PaycheckBill[] {
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

function applyMoveTracked(
  sim: SimPaycheck[],
  fromIndex: number,
  toIndex: number,
  bill: PaycheckBill,
  moveStack: AppliedMove[]
): void {
  applyMove(sim, fromIndex, toIndex, bill);
  moveStack.push({ fromIndex, toIndex, bill });
}

function undoMovesTo(sim: SimPaycheck[], moveStack: AppliedMove[], snapshotLength: number): void {
  while (moveStack.length > snapshotLength) {
    const move = moveStack.pop()!;
    applyMove(sim, move.toIndex, move.fromIndex, move.bill);
  }
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

function hasShortfall(sim: SimPaycheck[]): boolean {
  return sim.some((paycheck) => paycheck.budgetRemaining < paycheck.minCashOnHand);
}

/**
 * Free enough room on `index` to receive `amountNeeded` without going below min.
 * Appends cascade steps and mutates `sim`. Returns false if impossible within caps.
 */
function ensureReceiveRoom(
  ctx: SearchCtx,
  sim: SimPaycheck[],
  index: number,
  amountNeeded: number,
  lockedBillKeys: Set<string>,
  sort: BillSort,
  steps: BreakGlassPlanStep[],
  moveStack: AppliedMove[],
  depth: number
): boolean {
  advisorSearchVisits += 1;
  if (amountNeeded <= 0) return true;
  if (receiveRoom(sim[index]) >= amountNeeded) {
    return true;
  }
  if (depth >= MAX_ADVISOR_CASCADE_DEPTH || steps.length >= MAX_ADVISOR_PLAN_STEPS) {
    return false;
  }

  for (const bill of sortMovable(
    sim[index].bills.filter((candidate) => isMovable(candidate, lockedBillKeys)),
    sort
  )) {
    if (steps.length >= MAX_ADVISOR_PLAN_STEPS) break;

    const earlierCandidates = (ctx.legalSlotsByBillDate.get(bill.billDate) ?? [])
      .filter((slot) => slot.index < index)
      .sort((a, b) => b.index - a.index);

    for (const { index: earlierIndex, daysEarly } of earlierCandidates) {
      const snapshotLength = steps.length;
      const snapshotMoves = moveStack.length;

      if (
        !ensureReceiveRoom(
          ctx,
          sim,
          earlierIndex,
          bill.amount,
          lockedBillKeys,
          sort,
          steps,
          moveStack,
          depth + 1
        )
      ) {
        undoMovesTo(sim, moveStack, snapshotMoves);
        steps.length = snapshotLength;
        continue;
      }

      applyMoveTracked(sim, index, earlierIndex, bill, moveStack);
      steps.push(makeStep(bill, sim[index].date, sim[earlierIndex].date, daysEarly));

      if (receiveRoom(sim[index]) >= amountNeeded) {
        return true;
      }
    }
  }

  return receiveRoom(sim[index]) >= amountNeeded;
}

/**
 * Free room on `index` by cascading bills onto later eligible paychecks (reverse trickle).
 * Used when unloading a Break-Glass paycheck onto a later paycheck that itself needs space.
 */
function ensureReceiveRoomLater(
  ctx: SearchCtx,
  sim: SimPaycheck[],
  index: number,
  amountNeeded: number,
  lockedBillKeys: Set<string>,
  sort: BillSort,
  steps: BreakGlassPlanStep[],
  moveStack: AppliedMove[],
  depth: number
): boolean {
  advisorSearchVisits += 1;
  if (amountNeeded <= 0) return true;
  if (receiveRoom(sim[index]) >= amountNeeded) {
    return true;
  }
  if (depth >= MAX_ADVISOR_CASCADE_DEPTH || steps.length >= MAX_ADVISOR_PLAN_STEPS) {
    return false;
  }

  for (const bill of sortMovable(
    sim[index].bills.filter((candidate) => isMovable(candidate, lockedBillKeys)),
    sort
  )) {
    if (steps.length >= MAX_ADVISOR_PLAN_STEPS) break;

    const laterCandidates = (ctx.legalSlotsByBillDate.get(bill.billDate) ?? [])
      .filter((slot) => slot.index > index)
      .sort((a, b) => a.index - b.index);

    for (const { index: laterIndex, daysEarly } of laterCandidates) {
      const snapshotLength = steps.length;
      const snapshotMoves = moveStack.length;

      if (
        !ensureReceiveRoomLater(
          ctx,
          sim,
          laterIndex,
          bill.amount,
          lockedBillKeys,
          sort,
          steps,
          moveStack,
          depth + 1
        )
      ) {
        undoMovesTo(sim, moveStack, snapshotMoves);
        steps.length = snapshotLength;
        continue;
      }

      applyMoveTracked(sim, index, laterIndex, bill, moveStack);
      steps.push(makeStep(bill, sim[index].date, sim[laterIndex].date, daysEarly));

      if (receiveRoom(sim[index]) >= amountNeeded) {
        return true;
      }
    }
  }

  return receiveRoom(sim[index]) >= amountNeeded;
}

type Landing = { index: number; daysEarly: number; direction: 'earlier' | 'later' };

function collectLandings(
  ctx: SearchCtx,
  sim: SimPaycheck[],
  targetIndex: number,
  bill: PaycheckBill
): Landing[] {
  const landings: Landing[] = [];
  for (const slot of ctx.legalSlotsByBillDate.get(bill.billDate) ?? []) {
    if (slot.index === targetIndex) continue;
    landings.push({
      index: slot.index,
      daysEarly: slot.daysEarly,
      direction: slot.index < targetIndex ? 'earlier' : 'later',
    });
  }
  // Prefer: (1) earlier before later, (2) landings that keep destination at/above
  // target CoH (avoid recreating Break-Glass for the next accept), (3) nearest.
  landings.sort((a, b) => {
    if (a.direction !== b.direction) return a.direction === 'earlier' ? -1 : 1;
    const safeA = leavesAtOrAboveTarget(
      sim[a.index].budgetRemaining,
      bill.amount,
      sim[a.index].targetCashOnHand
    )
      ? 0
      : 1;
    const safeB = leavesAtOrAboveTarget(
      sim[b.index].budgetRemaining,
      bill.amount,
      sim[b.index].targetCashOnHand
    )
      ? 0
      : 1;
    if (safeA !== safeB) return safeA - safeB;
    if (a.direction === 'earlier') return b.index - a.index;
    return a.index - b.index;
  });
  return landings;
}

function tryClearBreakGlass(
  ctx: SearchCtx,
  base: SimPaycheck[],
  targetIndex: number,
  lockedBillKeys: Set<string>,
  sort: BillSort
): BreakGlassPlanStep[] | null {
  const target = base[targetIndex];
  const deficit = target.targetCashOnHand - target.budgetRemaining;
  if (deficit > targetMovableMass(target, lockedBillKeys)) {
    return null;
  }

  const sim = base.map((paycheck) => ({
    date: paycheck.date,
    budgetRemaining: paycheck.budgetRemaining,
    bills: paycheck.bills.map((bill) => ({ ...bill })),
    targetCashOnHand: paycheck.targetCashOnHand,
    minCashOnHand: paycheck.minCashOnHand,
  }));
  const steps: BreakGlassPlanStep[] = [];
  const moveStack: AppliedMove[] = [];
  let guard = 0;
  const targetCashOnHand = sim[targetIndex].targetCashOnHand;

  while (sim[targetIndex].budgetRemaining < targetCashOnHand && guard++ < MAX_ADVISOR_PLAN_STEPS) {
    let moved = false;

    // Bills sitting on the Break-Glass paycheck may be relocated even if a prior
    // Accept locked them (e.g. Cap A locked onto Jan 29 by a later Feb plan).
    // Cascade on other paychecks still respects locks.
    for (const bill of sortMovable(
      sim[targetIndex].bills.filter((candidate) =>
        isMovable(candidate, lockedBillKeys, { ignoreLocks: true })
      ),
      sort
    )) {
      const landings = collectLandings(ctx, sim, targetIndex, bill);

      for (const { index: landingIndex, daysEarly, direction } of landings) {
        const snapshotLength = steps.length;
        const snapshotMoves = moveStack.length;
        const roomOk =
          direction === 'earlier'
            ? ensureReceiveRoom(
                ctx,
                sim,
                landingIndex,
                bill.amount,
                lockedBillKeys,
                sort,
                steps,
                moveStack,
                0
              )
            : ensureReceiveRoomLater(
                ctx,
                sim,
                landingIndex,
                bill.amount,
                lockedBillKeys,
                sort,
                steps,
                moveStack,
                0
              );

        if (!roomOk) {
          undoMovesTo(sim, moveStack, snapshotMoves);
          steps.length = snapshotLength;
          continue;
        }

        applyMoveTracked(sim, targetIndex, landingIndex, bill, moveStack);
        steps.push(makeStep(bill, sim[targetIndex].date, sim[landingIndex].date, daysEarly));
        moved = true;
        break;
      }
      if (moved) break;
    }

    if (!moved) return null;
  }

  if (sim[targetIndex].budgetRemaining < targetCashOnHand) return null;
  if (hasShortfall(sim)) return null;
  if (healthyPaychecksRegressed(base, sim, targetIndex)) return null;
  if (steps.length === 0 || steps.length > MAX_ADVISOR_PLAN_STEPS) return null;
  return steps;
}

function maxDaysEarly(steps: BreakGlassPlanStep[]): number {
  return steps.reduce((max, step) => Math.max(max, step.daysEarly), 0);
}

/**
 * Collapse multi-hop cascade hops for the same bill occurrence into one net move.
 * Search may record Cap A Jul 17→Jul 10 then Jul 10→Jul 3 while freeing room; the
 * advisor card should show a single Cap A Jul 17→Jul 3 step (same final assignment).
 */
function coalesceOccurrenceHops(steps: BreakGlassPlanStep[]): BreakGlassPlanStep[] {
  const order: string[] = [];
  const byKey = new Map<string, BreakGlassPlanStep>();
  for (const step of steps) {
    const key = occurrenceKey(step.billId, step.billDueDate);
    const existing = byKey.get(key);
    if (!existing) {
      order.push(key);
      byKey.set(key, { ...step });
      continue;
    }
    byKey.set(key, {
      ...existing,
      toPaycheckDate: step.toPaycheckDate,
      daysEarly: step.daysEarly,
      requiresConfirmation: existing.requiresConfirmation || step.requiresConfirmation,
    });
  }
  return order.map((key) => byKey.get(key)!);
}

/** Lower is better. Prefer earlier-month cascades over later reverse-trickle,
 * then lower max days-early, fewer moves, then earlier landings. */
function comparePlans(
  a: BreakGlassPlanStep[],
  b: BreakGlassPlanStep[],
  targetPaycheckDate: string
): number {
  const usesLater = (steps: BreakGlassPlanStep[]) =>
    steps.some((step) => step.toPaycheckDate > targetPaycheckDate) ? 1 : 0;
  const laterA = usesLater(a);
  const laterB = usesLater(b);
  if (laterA !== laterB) return laterA - laterB;

  const maxA = maxDaysEarly(a);
  const maxB = maxDaysEarly(b);
  if (maxA !== maxB) return maxA - maxB;
  if (a.length !== b.length) return a.length - b.length;

  const earliestLanding = (steps: BreakGlassPlanStep[]) =>
    Math.min(...steps.map((step) => parseISO(step.toPaycheckDate).getTime()));
  return earliestLanding(a) - earliestLanding(b);
}

function formatHeadline(targetPaycheckDate: string): string {
  const label = format(parseISO(targetPaycheckDate), 'MMM d, yyyy');
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
  const paychecks = horizonPaychecks(schedule);
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

  const sim = cloneSim(paychecks, targetCashOnHand, minCashOnHand);
  const ctx = buildSearchCtx(sim, scheduleStartDate, maxEarlyDays);
  const plans: BreakGlassPlan[] = [];
  const unsolvable = new Set<string>();
  const initialBreakGlass = listBreakGlassDates(sim);
  // Only advise on paychecks that are Break-Glass on the current schedule.
  // Cascade side-effects can shove earlier paychecks into the BG band; treating
  // those as separate plan targets stole slots from real BG events (e.g. July)
  // and produced cards for dates with no Break-Glass badge.
  const initialBgDates = new Set(initialBreakGlass.map((paycheck) => paycheck.date));
  const handledBgDates = new Set<string>();

  const sorts: BillSort[] = ['amount-desc', 'amount-asc', 'priority-desc'];
  let targetOrdinal = 0;

  while (plans.length < MAX_ADVISOR_PLANS) {
    const index = sim.findIndex(
      (paycheck) =>
        initialBgDates.has(paycheck.date) &&
        !handledBgDates.has(paycheck.date) &&
        !unsolvable.has(paycheck.date) &&
        isBreakGlassRemaining(
          paycheck.budgetRemaining,
          paycheck.targetCashOnHand,
          paycheck.minCashOnHand
        )
    );
    if (index < 0) break;

    const targetDate = sim[index].date;
    targetOrdinal += 1;
    options.onTarget?.(targetOrdinal, initialBreakGlass.length);
    let bestSteps: BreakGlassPlanStep[] | null = null;
    for (const sort of sorts) {
      const candidate = tryClearBreakGlass(ctx, sim, index, lockedBillKeys, sort);
      if (!candidate) continue;
      if (!bestSteps || comparePlans(candidate, bestSteps, targetDate) < 0) {
        bestSteps = candidate;
      }
    }

    if (!bestSteps) {
      unsolvable.add(targetDate);
      handledBgDates.add(targetDate);
      continue;
    }

    // Stable entity id (target paycheck date) — never reuse ordinal slots like
    // break-glass-1/2 across rebuilds; dismiss/accept must key off that entity.
    const planId = `break-glass-${targetDate}`;
    bestSteps = coalesceOccurrenceHops(bestSteps);

    replaySteps(sim, bestSteps);
    handledBgDates.add(targetDate);

    plans.push({
      id: planId,
      targetPaycheckDate: targetDate,
      headline: formatHeadline(targetDate),
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
