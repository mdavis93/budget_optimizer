import { dayNumberOfIsoDate } from '@shared/billEligibility';
import { DEFAULT_MIN_SAVINGS_PER_PAYCHECK } from '@shared/constants';
import { isSavingsSqueezed } from '@shared/paycheckFlags';
import { CENTS_PER_DOLLAR, fromCents, toCents } from './money';
import { SAVINGS_TARGET_FALLBACK, SAVINGS_TARGET_PRIMARY } from './types';

/** A partial dip that still covers this share of the full target is worth taking. */
const NEARLY_FUNDED_TARGET_SHARE = 0.8;

/**
 * Forward cash-flow allocator: protected goals, ALAP savings dips, greedy
 * deposits in priority order. A slack guard only reserves capacity for
 * higher-priority protected goals. Open-ended goals have no deadline: they
 * take surplus only when every protected goal can still finish on time, and
 * they share that surplus instead of waiting until dated goals are paid off
 * early. Dollars enter at the boundary; the engine works in integer cents.
 * Goal deposits are whole dollars; savings takes leftover cents. No
 * module-level buffers — each run owns its typed arrays.
 */

export interface AllocatorPaycheck {
  /** Paycheck date as an ISO date string (yyyy-MM-dd). */
  date: string;
  /** Funds available above minimum cash-on-hand, to split between goals/savings. */
  surplus: number;
}

export interface AllocatorGoal {
  id: string;
  name: string;
  targetAmount: number;
  alreadySaved: number;
  /** Lower number = higher priority. Ignored for ordering when `openEnded` is set. */
  priority: number;
  /** Goal deadline as an ISO date string (yyyy-MM-dd). Unused when `openEnded` is set. */
  targetDate: string;
  /** No due date. Funded from surplus that dated goals do not need for their deadlines. */
  openEnded?: boolean;
}

export interface AllocatorOptions {
  /** Hard minimum savings per paycheck; never dipped below. Default 0. */
  minSavingsPerPaycheck?: number;
  /** Comfortable savings target protected before any goal funding. Default 150. */
  savingsTargetPrimary?: number;
  /** Lower savings target goals may dip into before the hard floor. Default 100. */
  savingsTargetFallback?: number;
  /**
   * Last calendar day of the funding horizon (yyyy-MM-dd). A goal whose deadline
   * falls after the last paycheck but on or before this day is still due inside
   * the horizon. Paycheck dates can stop short of the horizon end.
   */
  horizonEndDate?: string;
}

export interface AllocatedGoalDeposit {
  goalId: string;
  goalName: string;
  amount: number;
}

export interface PaycheckAllocation {
  goalDeposits: AllocatedGoalDeposit[];
  totalGoalDeposits: number;
  savingsDeposit: number;
  /** True when goal funding pushed this paycheck's savings below the fallback target. */
  savingsSqueezed: boolean;
}

export interface GoalOutcome {
  goalId: string;
  /** Total allocated to this goal across the horizon. */
  totalAllocated: number;
  /** alreadySaved + totalAllocated. */
  projectedTotal: number;
  /** Whether the goal reaches its target within its deadline window. */
  funded: boolean;
  /** Whether the goal falls short within the horizon (i.e. !funded). */
  atRisk: boolean;
  /** Remaining amount needed to fully fund (0 when funded). */
  shortfall: number;
}

export interface AllocationResult {
  /** Per-paycheck allocation, index-aligned with the input paychecks. */
  paychecks: PaycheckAllocation[];
  /** Per-goal funding outcome, ordered by input priority. */
  goals: GoalOutcome[];
}

interface SnapshotGoal {
  id: string;
  name: string;
  inputIndex: number;
  priority: number;
  openEnded: boolean;
  deadlineDay: number;
  targetAmount: number;
  remainingDollars: number;
  /**
   * Dollars reserved when this goal is in the protected set. Equal to
   * `remainingDollars` when it can finish, a smaller feasible cap when the
   * dip still funds the goal or leaves it at least 80% funded, otherwise 0.
   */
  reserveDollars: number;
  lastPaycheckIndex: number;
}

export interface CashFlowSnapshot {
  readonly paycheckCount: number;
  readonly surplusCents: Int32Array;
  readonly paycheckDays: Int32Array;
  readonly abovePrimary: Int32Array;
  readonly bandToFallback: Int32Array;
  readonly bandToFloor: Int32Array;
  readonly floorCents: number;
  readonly fallbackCents: number;
  readonly primaryReserveCents: number;
  readonly fallbackReserveCents: number;
  readonly goals: readonly SnapshotGoal[];
  readonly protectedIndices: readonly number[];
}

interface CapacityBreach {
  need: number;
  capacity: number;
}

function wholeDollarsAbove(surplusCents: number, reserveCents: number): number {
  return Math.max(0, Math.floor((surplusCents - reserveCents) / CENTS_PER_DOLLAR));
}

function compareGoals(a: SnapshotGoal, b: SnapshotGoal): number {
  if (a.openEnded !== b.openEnded) return a.openEnded ? 1 : -1;
  return a.priority - b.priority || a.deadlineDay - b.deadlineDay || a.id.localeCompare(b.id);
}

function lastPaycheckOnOrBefore(
  paycheckDays: Int32Array,
  deadlineDay: number
): number {
  let last = -1;
  for (let i = 0; i < paycheckDays.length; i++) {
    if (paycheckDays[i] <= deadlineDay) last = i;
  }
  return last;
}

function protectedCapacityBreach(
  candidate: readonly number[],
  goals: readonly SnapshotGoal[],
  paycheckDays: Int32Array,
  capacityDollars: Int32Array,
  trialIndex = -1,
  trialReserve = 0
): CapacityBreach | null {
  const deadlines = [...new Set(candidate.map((index) => goals[index].deadlineDay))].sort(
    (a, b) => a - b
  );
  let worst: CapacityBreach | null = null;
  for (const deadline of deadlines) {
    let need = 0;
    for (const index of candidate) {
      if (goals[index].deadlineDay <= deadline) {
        need += index === trialIndex ? trialReserve : goals[index].reserveDollars;
      }
    }
    let capacity = 0;
    for (let i = 0; i < paycheckDays.length; i++) {
      if (paycheckDays[i] <= deadline) capacity += capacityDollars[i];
    }
    const shortfall = need - capacity;
    if (shortfall > 0 && (worst === null || shortfall > worst.need - worst.capacity)) {
      worst = { need, capacity };
    }
  }
  return worst;
}

function protectedSetFeasible(
  candidate: readonly number[],
  goals: readonly SnapshotGoal[],
  paycheckDays: Int32Array,
  capacityDollars: Int32Array,
  trialIndex = -1,
  trialReserve = 0
): boolean {
  return (
    protectedCapacityBreach(
      candidate,
      goals,
      paycheckDays,
      capacityDollars,
      trialIndex,
      trialReserve
    ) === null
  );
}

function laterGoalNeedsThisCapacity(
  laterIndices: readonly number[],
  currentIndex: number,
  partialReserve: number,
  unavoidableReserve: number,
  protectedIndices: readonly number[],
  goals: SnapshotGoal[],
  paycheckDays: Int32Array,
  floorCapacity: Int32Array
): boolean {
  // Above-primary is spent even when this goal is not protected. A later goal
  // that still cannot finish after that unavoidable draw does not need the
  // extra dip withheld.
  const unavoidable = Math.max(0, Math.min(partialReserve, unavoidableReserve));
  for (const later of laterIndices) {
    goals[currentIndex].reserveDollars = unavoidable;
    const withoutExtraDip = protectedCapacityBreach(
      [...protectedIndices, currentIndex, later],
      goals,
      paycheckDays,
      floorCapacity,
      later,
      goals[later].remainingDollars
    );
    if (withoutExtraDip !== null) continue;
    goals[currentIndex].reserveDollars = partialReserve;
    const withPartial = protectedCapacityBreach(
      [...protectedIndices, currentIndex, later],
      goals,
      paycheckDays,
      floorCapacity,
      later,
      goals[later].remainingDollars
    );
    goals[currentIndex].reserveDollars = 0;
    if (withPartial !== null) return true;
  }
  goals[currentIndex].reserveDollars = 0;
  return false;
}

function admitProtectedSet(
  goals: SnapshotGoal[],
  paycheckDays: Int32Array,
  floorCapacity: Int32Array,
  horizonEndDay: number,
  abovePrimary: Int32Array
): number[] {
  const inHorizon: number[] = [];
  const order = goals.map((_, index) => index).sort((a, b) => compareGoals(goals[a], goals[b]));
  for (const index of order) {
    const goal = goals[index];
    if (goal.openEnded || goal.remainingDollars <= 0) continue;
    // Deadline after the horizon end is not due yet. A deadline a few days after
    // the last paycheck is still due inside the horizon when that paycheck is
    // the last one the schedule generated before the horizon end.
    if (goal.lastPaycheckIndex < 0 || goal.deadlineDay > horizonEndDay) continue;
    inHorizon.push(index);
  }

  const uncovered = remainingAfterAbovePrimaryDraw(goals, paycheckDays, abovePrimary);
  const protectedIndices: number[] = [];
  for (let cursor = 0; cursor < inHorizon.length; cursor++) {
    const index = inHorizon[cursor];
    const goal = goals[index];
    const candidate = [...protectedIndices, index];
    if (
      protectedSetFeasible(candidate, goals, paycheckDays, floorCapacity, index, goal.remainingDollars)
    ) {
      goal.reserveDollars = goal.remainingDollars;
      protectedIndices.push(index);
      continue;
    }

    const breach = protectedCapacityBreach(
      candidate,
      goals,
      paycheckDays,
      floorCapacity,
      index,
      goal.remainingDollars
    );
    if (!breach) continue;
    const over = breach.need - breach.capacity;
    const partialReserve = goal.remainingDollars - over;
    const dipRoom = uncovered[index] - over;
    const aboveAssigned = goal.remainingDollars - uncovered[index];
    const projectedShare =
      goal.targetAmount <= 0
        ? 1
        : (goal.targetAmount - goal.remainingDollars + Math.max(0, partialReserve)) / goal.targetAmount;
    // A miss larger than the dip that still fits would spend the savings cushion
    // on a goal that stays mostly unfunded. A dip that still reaches 80% of the
    // target, including money already saved, is kept.
    const keepPartial =
      partialReserve > 0 &&
      dipRoom > 0 &&
      (dipRoom > over || projectedShare >= NEARLY_FUNDED_TARGET_SHARE) &&
      !laterGoalNeedsThisCapacity(
        inHorizon.slice(cursor + 1),
        index,
        partialReserve,
        aboveAssigned,
        protectedIndices,
        goals,
        paycheckDays,
        floorCapacity
      );
    if (!keepPartial) continue;
    goal.reserveDollars = partialReserve;
    protectedIndices.push(index);
  }
  return protectedIndices;
}

/**
 * What each goal still needs after a priority-order draw on above-primary
 * dollars only. Protected dips are not in this pool, so a goal that cannot
 * be fully funded must not be credited with them.
 */
function remainingAfterAbovePrimaryDraw(
  goals: readonly SnapshotGoal[],
  paycheckDays: Int32Array,
  abovePrimary: Int32Array
): Int32Array {
  const remaining = new Int32Array(goals.length);
  for (let g = 0; g < goals.length; g++) remaining[g] = goals[g].remainingDollars;
  const pool = new Int32Array(abovePrimary);
  const order = goals.map((_, index) => index).sort((a, b) => compareGoals(goals[a], goals[b]));
  for (let i = 0; i < paycheckDays.length; i++) {
    if (pool[i] <= 0) continue;
    for (const goalIndex of order) {
      if (remaining[goalIndex] <= 0) continue;
      if (paycheckDays[i] > goals[goalIndex].deadlineDay) continue;
      const take = Math.min(remaining[goalIndex], pool[i]);
      if (take <= 0) continue;
      remaining[goalIndex] -= take;
      pool[i] -= take;
      if (pool[i] <= 0) break;
    }
  }
  return remaining;
}

function planAlapDips(
  protectedIndices: readonly number[],
  goals: readonly SnapshotGoal[],
  paycheckDays: Int32Array,
  abovePrimary: Int32Array,
  bandToFallback: Int32Array,
  bandToFloor: Int32Array
): Int32Array {
  const n = paycheckDays.length;
  const dips = new Int32Array(n);
  if (protectedIndices.length === 0) return dips;

  const deadlines = [...new Set(protectedIndices.map((index) => goals[index].deadlineDay))].sort(
    (a, b) => a - b
  );
  const uncovered = remainingAfterAbovePrimaryDraw(goals, paycheckDays, abovePrimary);
  const remainingDeficit = new Int32Array(deadlines.length);
  for (let d = 0; d < deadlines.length; d++) {
    const deadline = deadlines[d];
    let need = 0;
    for (const index of protectedIndices) {
      if (goals[index].deadlineDay > deadline) continue;
      const aboveAssigned = goals[index].remainingDollars - uncovered[index];
      need += Math.min(
        uncovered[index],
        Math.max(0, goals[index].reserveDollars - aboveAssigned)
      );
    }
    remainingDeficit[d] = need;
  }

  const applyBand = (band: Int32Array) => {
    for (let i = n - 1; i >= 0; i--) {
      let needed = 0;
      for (let d = 0; d < deadlines.length; d++) {
        if (paycheckDays[i] <= deadlines[d]) {
          needed = Math.max(needed, remainingDeficit[d]);
        }
      }
      const take = Math.min(band[i], needed);
      if (take <= 0) continue;
      dips[i] += take;
      for (let d = 0; d < deadlines.length; d++) {
        if (paycheckDays[i] <= deadlines[d]) {
          remainingDeficit[d] = Math.max(0, remainingDeficit[d] - take);
        }
      }
    }
  };

  applyBand(bandToFallback);
  applyBand(bandToFloor);
  return dips;
}

/** Higher-priority protected goals that may reserve capacity against `goalIndex`. */
function constrainingProtectedIndices(
  goalIndex: number,
  protectedIndices: readonly number[],
  goals: readonly SnapshotGoal[]
): number[] {
  return protectedIndices.filter(
    (protectedIndex) => compareGoals(goals[protectedIndex], goals[goalIndex]) < 0
  );
}

function windowCapacity(
  remainingAllocable: Int32Array,
  paycheckDays: Int32Array,
  deadline: number
): number {
  let capacity = 0;
  for (let i = 0; i < remainingAllocable.length; i++) {
    if (paycheckDays[i] <= deadline) capacity += remainingAllocable[i];
  }
  return capacity;
}

function protectedFeasibleAfterTake(
  goalIndex: number,
  paycheckIndex: number,
  take: number,
  protectedIndices: readonly number[],
  goals: readonly SnapshotGoal[],
  remainingNeed: Int32Array,
  remainingAllocable: Int32Array,
  paycheckDays: Int32Array,
  holdShortGoals: boolean
): boolean {
  for (const protectedIndex of protectedIndices) {
    if (protectedIndex === goalIndex) continue;
    const residualNeed = remainingNeed[protectedIndex];
    if (residualNeed <= 0) continue;
    const deadline = goals[protectedIndex].deadlineDay;
    const currentCap = windowCapacity(remainingAllocable, paycheckDays, deadline);
    // Already short of a full fill — do not block leftover deposits, unless this
    // take belongs to an open-ended goal that must not widen the shortfall.
    if (currentCap < residualNeed) {
      if (holdShortGoals && take > 0 && paycheckDays[paycheckIndex] <= deadline) return false;
      continue;
    }
    let residualCap = currentCap;
    if (paycheckDays[paycheckIndex] <= deadline) residualCap -= take;
    if (residualCap < residualNeed) return false;
  }
  return true;
}

function maxFeasibleTake(
  goalIndex: number,
  paycheckIndex: number,
  protectedIndices: readonly number[],
  goals: readonly SnapshotGoal[],
  remainingNeed: Int32Array,
  remainingAllocable: Int32Array,
  paycheckDays: Int32Array,
  spendCap: number,
  holdShortGoals = false
): number {
  const hardMax = Math.min(remainingNeed[goalIndex], remainingAllocable[paycheckIndex], spendCap);
  if (hardMax <= 0) return 0;
  let lo = 0;
  let hi = hardMax;
  let best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (
      protectedFeasibleAfterTake(
        goalIndex,
        paycheckIndex,
        mid,
        protectedIndices,
        goals,
        remainingNeed,
        remainingAllocable,
        paycheckDays,
        holdShortGoals
      )
    ) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

/**
 * While an open-ended goal still needs money, a protected goal takes its
 * deadline pace (or more, when later paychecks cannot cover the rest) instead
 * of its entire balance.
 */
function tandemSpendCap(
  goalIndex: number,
  paycheckIndex: number,
  goals: readonly SnapshotGoal[],
  remainingNeed: Int32Array,
  aboveLeft: Int32Array,
  dipLeft: Int32Array,
  dipAllowance: Int32Array,
  paycheckDays: Int32Array,
  baseSpend: number
): { cap: number; mustTake: number } {
  const goal = goals[goalIndex];
  const need = remainingNeed[goalIndex];
  const paychecksLeft = paycheckIndex <= goal.lastPaycheckIndex
    ? goal.lastPaycheckIndex - paycheckIndex + 1
    : 0;
  if (need <= 0 || paychecksLeft <= 0 || baseSpend <= 0) return { cap: 0, mustTake: 0 };

  const pace = Math.ceil(need / paychecksLeft);
  // Future raw capacity counts dips and above-primary that a higher-priority
  // goal takes first. Spending only the even pace then leaves this goal short
  // by about a dollar per paycheck. Count only cash this goal can still spend.
  const higher = goals
    .map((_, index) => index)
    .filter(
      (other) =>
        other !== goalIndex &&
        !goals[other].openEnded &&
        compareGoals(goals[other], goal) < 0 &&
        remainingNeed[other] > 0
    )
    .sort((left, right) => compareGoals(goals[left], goals[right]));
  const virtualNeed = higher.map((other) => remainingNeed[other]);
  let spendable = 0;
  let dipBudget = Math.max(0, dipAllowance[goalIndex]);
  for (let index = paycheckIndex + 1; index < paycheckDays.length; index++) {
    if (paycheckDays[index] > goal.deadlineDay) continue;
    let above = aboveLeft[index];
    for (let cursor = 0; cursor < higher.length; cursor++) {
      const other = higher[cursor];
      if (virtualNeed[cursor] <= 0 || paycheckDays[index] > goals[other].deadlineDay) continue;
      const claim = Math.min(virtualNeed[cursor], above);
      virtualNeed[cursor] -= claim;
      above -= claim;
    }
    spendable += above;
    const dip = Math.min(dipBudget, dipLeft[index]);
    spendable += dip;
    dipBudget -= dip;
  }
  const mustTake = Math.min(baseSpend, Math.max(0, need - spendable));
  const cap = Math.min(need, baseSpend, Math.max(mustTake, pace));
  return { cap, mustTake };
}

export function createCashFlowSnapshot(
  paychecks: AllocatorPaycheck[],
  goals: AllocatorGoal[],
  options: AllocatorOptions = {}
): CashFlowSnapshot {
  const n = paychecks.length;
  const floorCents = Math.max(0, toCents(options.minSavingsPerPaycheck ?? DEFAULT_MIN_SAVINGS_PER_PAYCHECK));
  const primaryCents = toCents(options.savingsTargetPrimary ?? SAVINGS_TARGET_PRIMARY);
  const fallbackCents = toCents(options.savingsTargetFallback ?? SAVINGS_TARGET_FALLBACK);
  const primaryReserveCents = Math.max(primaryCents, floorCents);
  const fallbackReserveCents = Math.max(fallbackCents, floorCents);

  const surplusCents = new Int32Array(n);
  const paycheckDays = new Int32Array(n);
  const abovePrimary = new Int32Array(n);
  const bandToFallback = new Int32Array(n);
  const bandToFloor = new Int32Array(n);

  for (let i = 0; i < n; i++) {
    const cents = Math.max(0, toCents(paychecks[i].surplus));
    surplusCents[i] = cents;
    paycheckDays[i] = dayNumberOfIsoDate(paychecks[i].date);
    const abovePrimaryDollars = wholeDollarsAbove(cents, primaryReserveCents);
    const aboveFallbackDollars = wholeDollarsAbove(cents, fallbackReserveCents);
    const aboveFloorDollars = wholeDollarsAbove(cents, floorCents);
    abovePrimary[i] = abovePrimaryDollars;
    bandToFallback[i] = Math.max(0, aboveFallbackDollars - abovePrimaryDollars);
    bandToFloor[i] = Math.max(0, aboveFloorDollars - aboveFallbackDollars);
  }

  const lastPaycheckDay = n > 0 ? paycheckDays[n - 1] : 0;
  const horizonEndDay = options.horizonEndDate
    ? dayNumberOfIsoDate(options.horizonEndDate)
    : lastPaycheckDay;
  const snapshotGoals: SnapshotGoal[] = goals.map((goal, inputIndex) => {
    const remainingDollars = Math.max(0, Math.round(goal.targetAmount - goal.alreadySaved));
    const openEnded = goal.openEnded === true;
    const deadlineDay = openEnded ? Number.POSITIVE_INFINITY : dayNumberOfIsoDate(goal.targetDate);
    return {
      id: goal.id,
      name: goal.name,
      inputIndex,
      priority: goal.priority,
      openEnded,
      deadlineDay,
      targetAmount: goal.targetAmount,
      remainingDollars,
      reserveDollars: 0,
      lastPaycheckIndex: openEnded ? n - 1 : lastPaycheckOnOrBefore(paycheckDays, deadlineDay),
    };
  });

  const floorCapacity = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    floorCapacity[i] = wholeDollarsAbove(surplusCents[i], floorCents);
  }
  const protectedIndices = admitProtectedSet(
    snapshotGoals,
    paycheckDays,
    floorCapacity,
    horizonEndDay,
    abovePrimary
  );

  return {
    paycheckCount: n,
    surplusCents,
    paycheckDays,
    abovePrimary,
    bandToFallback,
    bandToFloor,
    floorCents,
    fallbackCents,
    primaryReserveCents,
    fallbackReserveCents,
    goals: snapshotGoals,
    protectedIndices,
  };
}

export function allocateFromSnapshot(snapshot: CashFlowSnapshot): AllocationResult {
  const n = snapshot.paycheckCount;
  const remainingNeed = new Int32Array(snapshot.goals.length);
  for (let g = 0; g < snapshot.goals.length; g++) {
    const goal = snapshot.goals[g];
    const partial = goal.reserveDollars > 0 && goal.reserveDollars < goal.remainingDollars;
    remainingNeed[g] = partial ? goal.reserveDollars : goal.remainingDollars;
  }

  const dips = planAlapDips(
    snapshot.protectedIndices,
    snapshot.goals,
    snapshot.paycheckDays,
    snapshot.abovePrimary,
    snapshot.bandToFallback,
    snapshot.bandToFloor
  );
  const uncoveredAfterAbove = remainingAfterAbovePrimaryDraw(
    snapshot.goals,
    snapshot.paycheckDays,
    snapshot.abovePrimary
  );
  const remainingAllocable = new Int32Array(n);
  const aboveLeft = new Int32Array(n);
  const dipLeft = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    aboveLeft[i] = snapshot.abovePrimary[i];
    dipLeft[i] = dips[i];
    remainingAllocable[i] = snapshot.abovePrimary[i] + dips[i];
  }

  const allocByGoal = snapshot.goals.map(() => new Int32Array(n));
  const protectedSet = new Set(snapshot.protectedIndices);
  // Each protected goal may spend only the dip it still needs after above-primary.
  // A shared dip purse lets an earlier goal replace its own above-primary with a
  // later goal's dip, and the freed above-primary then leaks to an unadmitted goal.
  const dipAllowance = new Int32Array(snapshot.goals.length);
  for (const index of snapshot.protectedIndices) {
    const uncoveredAmount = uncoveredAfterAbove[index];
    const aboveAssigned = snapshot.goals[index].remainingDollars - uncoveredAmount;
    dipAllowance[index] = Math.min(
      uncoveredAmount,
      Math.max(0, snapshot.goals[index].reserveDollars - aboveAssigned)
    );
  }
  const deposit = (goalIndex: number, paycheckIndex: number, amount: number) => {
    if (amount <= 0) return;
    const fromAbove = Math.min(aboveLeft[paycheckIndex], amount);
    const fromDip = amount - fromAbove;
    aboveLeft[paycheckIndex] -= fromAbove;
    dipLeft[paycheckIndex] -= fromDip;
    dipAllowance[goalIndex] -= fromDip;
    remainingNeed[goalIndex] -= amount;
    remainingAllocable[paycheckIndex] -= amount;
    allocByGoal[goalIndex][paycheckIndex] += amount;
  };

  const depositOrder = snapshot.goals
    .map((_, index) => index)
    .sort((a, b) => compareGoals(snapshot.goals[a], snapshot.goals[b]));
  const datedOrder = depositOrder.filter((index) => !snapshot.goals[index].openEnded);
  const openEndedOrder = depositOrder.filter((index) => snapshot.goals[index].openEnded);
  const constrainingByGoal = snapshot.goals.map((_, goalIndex) =>
    constrainingProtectedIndices(goalIndex, snapshot.protectedIndices, snapshot.goals)
  );
  const higherGoalStillNeeds = (goalIndex: number, paycheckIndex: number) => {
    const day = snapshot.paycheckDays[paycheckIndex];
    for (let other = 0; other < snapshot.goals.length; other++) {
      if (other === goalIndex || remainingNeed[other] <= 0) continue;
      if (compareGoals(snapshot.goals[other], snapshot.goals[goalIndex]) >= 0) continue;
      if (day <= snapshot.goals[other].deadlineDay) return true;
    }
    return false;
  };
  const spendRoom = (goalIndex: number, paycheckIndex: number) => {
    if (!protectedSet.has(goalIndex)) return aboveLeft[paycheckIndex];
    const goal = snapshot.goals[goalIndex];
    const partial = goal.reserveDollars > 0 && goal.reserveDollars < goal.remainingDollars;
    // A partial dip can use savings the higher goal is not allowed to touch,
    // but not while that higher goal is still funding inside this paycheck.
    if (partial && higherGoalStillNeeds(goalIndex, paycheckIndex)) return aboveLeft[paycheckIndex];
    return aboveLeft[paycheckIndex] + Math.min(dipAllowance[goalIndex], dipLeft[paycheckIndex]);
  };

  const depositDated = (goalIndex: number, paycheckIndex: number, spendCap: number) => {
    if (snapshot.paycheckDays[paycheckIndex] > snapshot.goals[goalIndex].deadlineDay) return;
    const take = maxFeasibleTake(
      goalIndex,
      paycheckIndex,
      constrainingByGoal[goalIndex],
      snapshot.goals,
      remainingNeed,
      remainingAllocable,
      snapshot.paycheckDays,
      spendCap
    );
    deposit(goalIndex, paycheckIndex, take);
  };

  for (let i = 0; i < n; i++) {
    const tandem = openEndedOrder.some((index) => remainingNeed[index] > 0);
    if (!tandem) {
      for (const goalIndex of depositOrder) {
        depositDated(goalIndex, i, spendRoom(goalIndex, i));
      }
      continue;
    }

    for (const goalIndex of datedOrder) {
      if (snapshot.paycheckDays[i] > snapshot.goals[goalIndex].deadlineDay) continue;
      const room = spendRoom(goalIndex, i);
      if (!protectedSet.has(goalIndex)) {
        depositDated(goalIndex, i, room);
        continue;
      }
      const { cap, mustTake } = tandemSpendCap(
        goalIndex,
        i,
        snapshot.goals,
        remainingNeed,
        aboveLeft,
        dipLeft,
        dipAllowance,
        snapshot.paycheckDays,
        room
      );
      const peerIndices = snapshot.protectedIndices.filter((index) => index !== goalIndex);
      let take = maxFeasibleTake(
        goalIndex,
        i,
        peerIndices,
        snapshot.goals,
        remainingNeed,
        remainingAllocable,
        snapshot.paycheckDays,
        cap
      );
      if (take < mustTake) {
        take = Math.max(
          take,
          maxFeasibleTake(
            goalIndex,
            i,
            constrainingByGoal[goalIndex],
            snapshot.goals,
            remainingNeed,
            remainingAllocable,
            snapshot.paycheckDays,
            Math.min(room, mustTake)
          )
        );
      }
      deposit(goalIndex, i, take);
    }

    for (const goalIndex of openEndedOrder) {
      const take = maxFeasibleTake(
        goalIndex,
        i,
        constrainingByGoal[goalIndex],
        snapshot.goals,
        remainingNeed,
        remainingAllocable,
        snapshot.paycheckDays,
        aboveLeft[i],
        true
      );
      deposit(goalIndex, i, take);
    }

    if (!openEndedOrder.some((index) => remainingNeed[index] > 0)) {
      for (const goalIndex of datedOrder) {
        depositDated(goalIndex, i, spendRoom(goalIndex, i));
      }
    }
  }

  // Pace fills itself from above-primary and counts later dips as if they will
  // be spent. Those dips are skipped once above-primary covers the pace, so a
  // protected goal can finish short of the reserve that justified the dip.
  // Give each protected goal its remaining dip allowance, latest paycheck first.
  const depositDip = (goalIndex: number, paycheckIndex: number, amount: number) => {
    if (amount <= 0) return;
    const fromDip = Math.min(dipLeft[paycheckIndex], amount);
    if (fromDip <= 0) return;
    dipLeft[paycheckIndex] -= fromDip;
    dipAllowance[goalIndex] -= fromDip;
    remainingNeed[goalIndex] -= fromDip;
    remainingAllocable[paycheckIndex] -= fromDip;
    allocByGoal[goalIndex][paycheckIndex] += fromDip;
  };
  for (const goalIndex of datedOrder) {
    if (!protectedSet.has(goalIndex) || remainingNeed[goalIndex] <= 0 || dipAllowance[goalIndex] <= 0) {
      continue;
    }
    const peers = snapshot.protectedIndices.filter((index) => index !== goalIndex);
    const last = Math.min(n - 1, snapshot.goals[goalIndex].lastPaycheckIndex);
    const higherStillFunding = (paycheckIndex: number) => {
      const day = snapshot.paycheckDays[paycheckIndex];
      for (let other = 0; other < snapshot.goals.length; other++) {
        if (other === goalIndex) continue;
        if (compareGoals(snapshot.goals[other], snapshot.goals[goalIndex]) >= 0) continue;
        if (day > snapshot.goals[other].deadlineDay) continue;
        // An unadmitted higher goal may take above-primary cash on this paycheck.
        // That deposit does not own the savings dip band. Only a higher protected
        // goal that still has dip allowance left can reserve those dollars.
        if (protectedSet.has(other) && dipAllowance[other] > 0) return true;
      }
      return false;
    };
    for (let i = last; i >= 0 && remainingNeed[goalIndex] > 0 && dipAllowance[goalIndex] > 0; i--) {
      if (higherStillFunding(i)) continue;
      const available = Math.min(
        dipLeft[i],
        dipAllowance[goalIndex],
        remainingNeed[goalIndex],
        remainingAllocable[i]
      );
      if (available <= 0) continue;
      let take = available;
      if (
        !protectedFeasibleAfterTake(
          goalIndex,
          i,
          take,
          peers,
          snapshot.goals,
          remainingNeed,
          remainingAllocable,
          snapshot.paycheckDays,
          false
        )
      ) {
        let lo = 0;
        let hi = available;
        take = 0;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if (
            protectedFeasibleAfterTake(
              goalIndex,
              i,
              mid,
              peers,
              snapshot.goals,
              remainingNeed,
              remainingAllocable,
              snapshot.paycheckDays,
              false
            )
          ) {
            take = mid;
            lo = mid + 1;
          } else {
            hi = mid - 1;
          }
        }
      }
      depositDip(goalIndex, i, take);
    }
  }

  const fallbackDollars = snapshot.fallbackCents / CENTS_PER_DOLLAR;
  const paycheckResults: PaycheckAllocation[] = [];
  for (let i = 0; i < n; i++) {
    const goalDeposits: AllocatedGoalDeposit[] = [];
    let totalGoalDeposits = 0;
    const ordered = snapshot.goals.map((_, index) => index).sort((a, b) =>
      compareGoals(snapshot.goals[a], snapshot.goals[b])
    );
    for (const goalIndex of ordered) {
      const amount = allocByGoal[goalIndex][i];
      if (amount > 0) {
        goalDeposits.push({
          goalId: snapshot.goals[goalIndex].id,
          goalName: snapshot.goals[goalIndex].name,
          amount,
        });
        totalGoalDeposits += amount;
      }
    }
    const savingsDeposit = Math.max(
      0,
      fromCents(snapshot.surplusCents[i] - totalGoalDeposits * CENTS_PER_DOLLAR)
    );
    paycheckResults.push({
      goalDeposits,
      totalGoalDeposits,
      savingsDeposit,
      savingsSqueezed: isSavingsSqueezed(totalGoalDeposits, savingsDeposit, fallbackDollars),
    });
  }

  const goalResults: GoalOutcome[] = snapshot.goals.map((goal, index) => {
    let totalAllocated = 0;
    const row = allocByGoal[index];
    for (let i = 0; i < n; i++) totalAllocated += row[i];
    const shortfall = remainingNeed[index];
    const funded = shortfall <= 0;
    return {
      goalId: goal.id,
      totalAllocated,
      projectedTotal: totalAllocated,
      funded,
      atRisk: !funded,
      shortfall,
    };
  });

  return { paychecks: paycheckResults, goals: goalResults };
}

/**
 * Allocate surplus to goals then savings. Each call builds an immutable snapshot
 * and writes into freshly allocated typed arrays.
 */
export function allocateGoalsAndSavings(
  paychecks: AllocatorPaycheck[],
  goals: AllocatorGoal[],
  options: AllocatorOptions = {}
): AllocationResult {
  const snapshot = createCashFlowSnapshot(paychecks, goals, options);
  const result = allocateFromSnapshot(snapshot);
  const goalResults: GoalOutcome[] = goals.map((goal, index) => {
    const allocated = result.goals[index];
    const projectedTotal = goal.alreadySaved + allocated.totalAllocated;
    const shortfall = Math.max(0, Math.round(goal.targetAmount - projectedTotal));
    const funded = shortfall <= 0;
    return {
      goalId: goal.id,
      totalAllocated: allocated.totalAllocated,
      projectedTotal,
      funded,
      atRisk: !funded,
      shortfall,
    };
  });
  return { paychecks: result.paychecks, goals: goalResults };
}
