import { parseISO } from 'date-fns';
import { SAVINGS_TARGET_PRIMARY, SAVINGS_TARGET_FALLBACK } from './types';

/**
 * Capacity-proportional, deadline-windowed, tiered-floor goal/savings allocator.
 *
 * Given each paycheck's surplus (already above minimum cash-on-hand) and the set
 * of goals, decide how much of every paycheck goes to each goal vs. savings over
 * the full horizon. The design fixes the failures of the old per-paycheck
 * on-pace loop:
 *
 *  - Deadline-windowed: a goal can only draw from paychecks on or before its
 *    target date.
 *  - Tiered savings floor: goals first draw only from capacity *above* the
 *    primary savings target ($150). If a goal still can't be met by its
 *    deadline, it dips into the band down to the fallback target ($100), then
 *    down to the hard savings floor (minSavingsPerPaycheck, default $0). Savings
 *    is never pushed below the hard floor.
 *  - Capacity-proportional: within a tier, a goal's funding is spread across its
 *    window proportional to each paycheck's free capacity, so richer paychecks
 *    contribute more (instead of every paycheck paying the same flat amount).
 *  - Priority order: goals are funded highest-priority-first within each tier.
 *  - Whole-dollar: goal allocations are integers (largest-remainder rounding);
 *    savings receives the residual.
 *
 * Pure and deterministic: no dates beyond the supplied strings, no I/O.
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

/**
 * Distribute an integer `amount` across `capacities` proportional to each entry's
 * capacity, never exceeding capacity, in whole dollars. Uses iterative
 * water-filling so overflow from capped entries is redistributed to the rest.
 */
export function fillProportional(amount: number, capacities: number[]): number[] {
  const n = capacities.length;
  const result = new Array<number>(n).fill(0);
  const totalCapacity = capacities.reduce((sum, c) => sum + Math.max(0, c), 0);
  let remaining = Math.min(Math.max(0, Math.round(amount)), totalCapacity);
  if (remaining <= 0) return result;

  let guard = 0;
  while (remaining > 0 && guard++ < 10000) {
    const active: number[] = [];
    let activeFree = 0;
    for (let i = 0; i < n; i++) {
      const free = capacities[i] - result[i];
      if (free > 0) {
        active.push(i);
        activeFree += free;
      }
    }
    if (active.length === 0) break;

    // Everything left fits within remaining free capacity: fill to the brim.
    if (remaining >= activeFree) {
      for (const i of active) result[i] = capacities[i];
      remaining -= activeFree;
      break;
    }

    // Proportional whole-dollar split among active entries by free capacity.
    const shares = active.map((i) => {
      const free = capacities[i] - result[i];
      const exact = (remaining * free) / activeFree;
      const base = Math.min(free, Math.floor(exact));
      return { i, free, base, frac: exact - Math.floor(exact) };
    });

    let assigned = shares.reduce((sum, s) => sum + s.base, 0);
    let leftover = remaining - assigned;
    shares.sort((a, b) => b.frac - a.frac || a.i - b.i);
    for (const s of shares) {
      if (leftover <= 0) break;
      if (s.base < s.free) {
        s.base++;
        leftover--;
      }
    }

    let applied = 0;
    for (const s of shares) {
      result[s.i] += s.base;
      applied += s.base;
    }
    remaining -= applied;

    // Safety valve: guarantee forward progress even if rounding stalls.
    if (applied === 0) {
      for (const i of active) {
        if (capacities[i] - result[i] > 0) {
          result[i] += 1;
          remaining -= 1;
          break;
        }
      }
    }
  }

  return result;
}

export function allocateGoalsAndSavings(
  paychecks: AllocatorPaycheck[],
  goals: AllocatorGoal[],
  options: AllocatorOptions = {}
): AllocationResult {
  const floor = Math.max(0, options.minSavingsPerPaycheck ?? 0);
  const primary = options.savingsTargetPrimary ?? SAVINGS_TARGET_PRIMARY;
  const fallback = options.savingsTargetFallback ?? SAVINGS_TARGET_FALLBACK;

  const n = paychecks.length;
  // Integer capacity (whole dollars) available for goals + savings per paycheck.
  const capacity = paychecks.map((p) => Math.max(0, Math.floor(p.surplus)));
  const goalUsed = new Array<number>(n).fill(0);
  const paycheckTimes = paychecks.map((p) => parseISO(p.date).getTime());

  const sortedGoals = [...goals].sort(
    (a, b) => a.priority - b.priority || a.targetDate.localeCompare(b.targetDate)
  );

  // Per goal: remaining need, contribution window (paycheck indices on/before
  // the deadline), and the running per-paycheck allocation.
  const need = new Map<string, number>();
  const windows = new Map<string, number[]>();
  const allocByGoal = new Map<string, number[]>();
  for (const goal of sortedGoals) {
    need.set(goal.id, Math.max(0, Math.round(goal.targetAmount - goal.alreadySaved)));
    const deadline = parseISO(goal.targetDate).getTime();
    const window: number[] = [];
    for (let i = 0; i < n; i++) {
      if (paycheckTimes[i] <= deadline) window.push(i);
    }
    windows.set(goal.id, window);
    allocByGoal.set(goal.id, new Array<number>(n).fill(0));
  }

  // Reserve tiers (savings amounts protected before goals may draw), highest
  // first, never below the hard floor. Goals dip through them only as needed.
  const reserveTiers = Array.from(
    new Set([Math.max(primary, floor), Math.max(fallback, floor), floor])
  ).sort((a, b) => b - a);

  for (const reserve of reserveTiers) {
    for (const goal of sortedGoals) {
      let remaining = need.get(goal.id) ?? 0;
      if (remaining <= 0) continue;
      const window = windows.get(goal.id) ?? [];
      if (window.length === 0) continue;

      const capacities = window.map((i) => Math.max(0, capacity[i] - goalUsed[i] - reserve));
      const allocated = fillProportional(remaining, capacities);

      const goalAlloc = allocByGoal.get(goal.id)!;
      let used = 0;
      for (let k = 0; k < window.length; k++) {
        const i = window[k];
        const amt = allocated[k];
        if (amt > 0) {
          goalUsed[i] += amt;
          goalAlloc[i] += amt;
          used += amt;
        }
      }
      need.set(goal.id, remaining - used);
    }
  }

  // Assemble per-paycheck allocations.
  const paycheckResults: PaycheckAllocation[] = paychecks.map((p, i) => {
    const goalDeposits: AllocatedGoalDeposit[] = [];
    for (const goal of sortedGoals) {
      const amt = allocByGoal.get(goal.id)![i];
      if (amt > 0) {
        goalDeposits.push({ goalId: goal.id, goalName: goal.name, amount: amt });
      }
    }
    const totalGoalDeposits = goalUsed[i];
    const savingsDeposit = Math.max(0, p.surplus - totalGoalDeposits);
    const savingsSqueezed = totalGoalDeposits > 0 && savingsDeposit < fallback;
    return { goalDeposits, totalGoalDeposits, savingsDeposit, savingsSqueezed };
  });

  // Assemble per-goal outcomes (preserve input order).
  const goalResults: GoalOutcome[] = goals.map((goal) => {
    const totalAllocated = (allocByGoal.get(goal.id) ?? []).reduce((s, a) => s + a, 0);
    const projectedTotal = goal.alreadySaved + totalAllocated;
    const shortfall = Math.max(0, goal.targetAmount - projectedTotal);
    const funded = shortfall <= 0;
    return {
      goalId: goal.id,
      totalAllocated,
      projectedTotal,
      funded,
      atRisk: !funded,
      shortfall,
    };
  });

  return { paychecks: paycheckResults, goals: goalResults };
}
