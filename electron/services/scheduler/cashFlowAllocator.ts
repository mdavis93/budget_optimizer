import { dayNumberOfIsoDate } from '@shared/billEligibility';
import { fromCents, toCents } from './money';
import { SAVINGS_TARGET_FALLBACK, SAVINGS_TARGET_PRIMARY } from './types';

/**
 * Forward cash-flow allocator: protected goals, ALAP savings dips, greedy
 * deposits with a slack guard. Dollars enter at the boundary; the engine
 * works in integer cents. Goal deposits are whole dollars; savings takes
 * leftover cents. No module-level buffers — each run owns its typed arrays.
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
  /** Lower number = higher priority. */
  priority: number;
  /** Goal deadline as an ISO date string (yyyy-MM-dd). */
  targetDate: string;
}

export interface AllocatorOptions {
  /** Hard minimum savings per paycheck; never dipped below. Default 0. */
  minSavingsPerPaycheck?: number;
  /** Comfortable savings target protected before any goal funding. Default 150. */
  savingsTargetPrimary?: number;
  /** Lower savings target goals may dip into before the hard floor. Default 100. */
  savingsTargetFallback?: number;
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

const CENTS_PER_DOLLAR = 100;

interface SnapshotGoal {
  id: string;
  name: string;
  inputIndex: number;
  priority: number;
  deadlineDay: number;
  remainingDollars: number;
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
  readonly leftoverIndices: readonly number[];
  readonly unadmittedIndices: readonly number[];
}

function wholeDollarsAbove(surplusCents: number, reserveCents: number): number {
  return Math.max(0, Math.floor((surplusCents - reserveCents) / CENTS_PER_DOLLAR));
}

function compareGoals(a: SnapshotGoal, b: SnapshotGoal): number {
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

function protectedSetFeasible(
  candidate: readonly number[],
  goals: readonly SnapshotGoal[],
  paycheckDays: Int32Array,
  capacityDollars: Int32Array
): boolean {
  const deadlines = [...new Set(candidate.map((index) => goals[index].deadlineDay))].sort(
    (a, b) => a - b
  );
  for (const deadline of deadlines) {
    let need = 0;
    for (const index of candidate) {
      if (goals[index].deadlineDay <= deadline) need += goals[index].remainingDollars;
    }
    let capacity = 0;
    for (let i = 0; i < paycheckDays.length; i++) {
      if (paycheckDays[i] <= deadline) capacity += capacityDollars[i];
    }
    if (need > capacity) return false;
  }
  return true;
}

function admitProtectedSet(
  goals: readonly SnapshotGoal[],
  paycheckDays: Int32Array,
  floorCapacity: Int32Array,
  lastPaycheckDay: number
): { protectedIndices: number[]; leftoverIndices: number[]; unadmittedIndices: number[] } {
  const inHorizon: number[] = [];
  const leftoverIndices: number[] = [];
  const unadmittedIndices: number[] = [];
  const order = goals.map((_, index) => index).sort((a, b) => compareGoals(goals[a], goals[b]));
  for (const index of order) {
    const goal = goals[index];
    if (goal.remainingDollars <= 0) {
      leftoverIndices.push(index);
      continue;
    }
    if (goal.lastPaycheckIndex < 0 || goal.deadlineDay > lastPaycheckDay) {
      leftoverIndices.push(index);
      continue;
    }
    inHorizon.push(index);
  }

  const protectedIndices: number[] = [];
  for (const index of inHorizon) {
    const candidate = [...protectedIndices, index];
    if (protectedSetFeasible(candidate, goals, paycheckDays, floorCapacity)) {
      protectedIndices.push(index);
    } else {
      unadmittedIndices.push(index);
    }
  }
  leftoverIndices.sort((a, b) => compareGoals(goals[a], goals[b]));
  unadmittedIndices.sort((a, b) => compareGoals(goals[a], goals[b]));
  return { protectedIndices, leftoverIndices, unadmittedIndices };
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
  const remainingDeficit = new Int32Array(deadlines.length);
  for (let d = 0; d < deadlines.length; d++) {
    const deadline = deadlines[d];
    let need = 0;
    for (const index of protectedIndices) {
      if (goals[index].deadlineDay <= deadline) need += goals[index].remainingDollars;
    }
    let capacity = 0;
    for (let i = 0; i < n; i++) {
      if (paycheckDays[i] <= deadline) capacity += abovePrimary[i];
    }
    remainingDeficit[d] = Math.max(0, need - capacity);
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

function protectedFeasibleAfterTake(
  goalIndex: number,
  paycheckIndex: number,
  take: number,
  protectedIndices: readonly number[],
  goals: readonly SnapshotGoal[],
  remainingNeed: Int32Array,
  remainingAllocable: Int32Array,
  paycheckDays: Int32Array
): boolean {
  for (const protectedIndex of protectedIndices) {
    const residualNeed =
      remainingNeed[protectedIndex] - (protectedIndex === goalIndex ? take : 0);
    if (residualNeed <= 0) continue;
    let residualCap = 0;
    const deadline = goals[protectedIndex].deadlineDay;
    for (let i = 0; i < remainingAllocable.length; i++) {
      if (paycheckDays[i] > deadline) continue;
      residualCap += remainingAllocable[i];
      if (i === paycheckIndex) residualCap -= take;
    }
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
  paycheckDays: Int32Array
): number {
  const hardMax = Math.min(remainingNeed[goalIndex], remainingAllocable[paycheckIndex]);
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
        paycheckDays
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

export function createCashFlowSnapshot(
  paychecks: AllocatorPaycheck[],
  goals: AllocatorGoal[],
  options: AllocatorOptions = {}
): CashFlowSnapshot {
  const n = paychecks.length;
  const floorCents = Math.max(0, toCents(options.minSavingsPerPaycheck ?? 0));
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
  const snapshotGoals: SnapshotGoal[] = goals.map((goal, inputIndex) => {
    const remainingDollars = Math.max(0, Math.round(goal.targetAmount - goal.alreadySaved));
    const deadlineDay = dayNumberOfIsoDate(goal.targetDate);
    return {
      id: goal.id,
      name: goal.name,
      inputIndex,
      priority: goal.priority,
      deadlineDay,
      remainingDollars,
      lastPaycheckIndex: lastPaycheckOnOrBefore(paycheckDays, deadlineDay),
    };
  });

  const floorCapacity = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    floorCapacity[i] = wholeDollarsAbove(surplusCents[i], floorCents);
  }
  const { protectedIndices, leftoverIndices, unadmittedIndices } = admitProtectedSet(
    snapshotGoals,
    paycheckDays,
    floorCapacity,
    lastPaycheckDay
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
    leftoverIndices,
    unadmittedIndices,
  };
}

export function allocateFromSnapshot(snapshot: CashFlowSnapshot): AllocationResult {
  const n = snapshot.paycheckCount;
  const remainingNeed = new Int32Array(snapshot.goals.length);
  for (let g = 0; g < snapshot.goals.length; g++) {
    remainingNeed[g] = snapshot.goals[g].remainingDollars;
  }

  const dips = planAlapDips(
    snapshot.protectedIndices,
    snapshot.goals,
    snapshot.paycheckDays,
    snapshot.abovePrimary,
    snapshot.bandToFallback,
    snapshot.bandToFloor
  );
  const remainingAllocable = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    remainingAllocable[i] = snapshot.abovePrimary[i] + dips[i];
  }

  const allocByGoal = snapshot.goals.map(() => new Int32Array(n));

  const deposit = (goalIndex: number, paycheckIndex: number, amount: number) => {
    if (amount <= 0) return;
    remainingNeed[goalIndex] -= amount;
    remainingAllocable[paycheckIndex] -= amount;
    allocByGoal[goalIndex][paycheckIndex] += amount;
  };

  for (let i = 0; i < n; i++) {
    for (const goalIndex of snapshot.protectedIndices) {
      if (snapshot.paycheckDays[i] > snapshot.goals[goalIndex].deadlineDay) continue;
      const take = maxFeasibleTake(
        goalIndex,
        i,
        snapshot.protectedIndices,
        snapshot.goals,
        remainingNeed,
        remainingAllocable,
        snapshot.paycheckDays
      );
      deposit(goalIndex, i, take);
    }
  }

  const depositLeftover = (goalIndex: number, paycheckIndex: number) => {
    if (snapshot.paycheckDays[paycheckIndex] > snapshot.goals[goalIndex].deadlineDay) return;
    const take = maxFeasibleTake(
      goalIndex,
      paycheckIndex,
      snapshot.protectedIndices,
      snapshot.goals,
      remainingNeed,
      remainingAllocable,
      snapshot.paycheckDays
    );
    deposit(goalIndex, paycheckIndex, take);
  };

  for (let i = 0; i < n; i++) {
    for (const goalIndex of snapshot.unadmittedIndices) depositLeftover(goalIndex, i);
    for (const goalIndex of snapshot.leftoverIndices) depositLeftover(goalIndex, i);
  }

  for (let i = 0; i < n; i++) {
    const aboveFloor = wholeDollarsAbove(snapshot.surplusCents[i], snapshot.floorCents);
    const reserved = snapshot.abovePrimary[i] + dips[i];
    remainingAllocable[i] += Math.max(0, aboveFloor - reserved);
  }

  for (let i = 0; i < n; i++) {
    for (const goalIndex of snapshot.unadmittedIndices) depositLeftover(goalIndex, i);
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
      savingsSqueezed: totalGoalDeposits > 0 && savingsDeposit < fallbackDollars,
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
