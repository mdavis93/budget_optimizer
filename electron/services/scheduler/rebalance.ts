import { PRIORITY_ORDER } from '../../utils/constants';
import { getEligiblePaycheckIndices } from './eligibility';
import {
  DEFAULT_MIN_CASH_ON_HAND,
  DEFAULT_TARGET_CASH_ON_HAND,
  PaycheckAssignment,
  ProjectedBill,
  billOccurrenceKey,
} from './types';

export interface RebalanceOptions {
  skippedBills?: Set<string>;
  lockedBillKeys?: Set<string>;
  /** Preferred cash-on-hand reserve while placing bills (default: target). */
  targetCashOnHand?: number;
  /** Break-glass floor — only accept going this low when target cannot be met. */
  minCashOnHand?: number;
  maxPasses?: number;
  maxCascadeDepth?: number;
}

function paycheckCapacity(
  assignments: PaycheckAssignment[],
  startingBalance: number,
  cashOnHandReserve: number
): number[] {
  return assignments.map((assignment, index) => {
    const income = assignment.incomes.reduce((sum, inc) => sum + inc.amount, 0);
    const ledgerBoost = index === 0 ? startingBalance : 0;
    return Math.max(0, income + ledgerBoost - cashOnHandReserve);
  });
}

function paycheckLoad(assignments: PaycheckAssignment[]): number[] {
  return assignments.map((assignment) =>
    assignment.bills
      .filter((bill) => !bill.isUnpayable)
      .reduce((sum, bill) => sum + bill.amount, 0)
  );
}

function isMovableBill(bill: ProjectedBill, lockedBillKeys: Set<string>): boolean {
  if (bill.isIncomeAttached) return false;
  if (bill.isUnpayable) return false;
  return !lockedBillKeys.has(billOccurrenceKey(bill.billId, bill.date));
}

/** Capacity-failed bills that may still fit within the eligibility window. */
function isRescuableUnpayable(bill: ProjectedBill, lockedBillKeys: Set<string>): boolean {
  if (!bill.isUnpayable) return false;
  if (bill.isIncomeAttached) return false;
  if (bill.unfundableReason === 'no_eligible_paycheck_in_window') return false;
  return !lockedBillKeys.has(billOccurrenceKey(bill.billId, bill.date));
}

function movableBillsOnPaycheck(
  assignment: PaycheckAssignment,
  lockedBillKeys: Set<string>
): ProjectedBill[] {
  return assignment.bills
    .filter((bill) => isMovableBill(bill, lockedBillKeys))
    .sort((a, b) => PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority]);
}

function rescuableUnpayablesOnPaycheck(
  assignment: PaycheckAssignment,
  lockedBillKeys: Set<string>
): ProjectedBill[] {
  return assignment.bills
    .filter((bill) => isRescuableUnpayable(bill, lockedBillKeys))
    .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
}

function removeBillAt(
  assignments: PaycheckAssignment[],
  paycheckIndex: number,
  bill: ProjectedBill
): void {
  const key = billOccurrenceKey(bill.billId, bill.date);
  assignments[paycheckIndex].bills = assignments[paycheckIndex].bills.filter(
    (candidate) => billOccurrenceKey(candidate.billId, candidate.date) !== key
  );
}

function addBillAt(
  assignments: PaycheckAssignment[],
  paycheckIndex: number,
  bill: ProjectedBill
): void {
  assignments[paycheckIndex].bills.push({
    ...bill,
    isUnpayable: false,
    unfundableReason: undefined,
  });
}

function moveBill(
  assignments: PaycheckAssignment[],
  bill: ProjectedBill,
  fromIndex: number,
  toIndex: number,
  load: number[]
): void {
  const countedInLoad = !bill.isUnpayable;
  removeBillAt(assignments, fromIndex, bill);
  addBillAt(assignments, toIndex, bill);
  if (countedInLoad) {
    load[fromIndex] -= bill.amount;
  }
  load[toIndex] += bill.amount;
}

function fundUnpayableInPlace(
  assignments: PaycheckAssignment[],
  paycheckIndex: number,
  bill: ProjectedBill,
  load: number[]
): void {
  const key = billOccurrenceKey(bill.billId, bill.date);
  assignments[paycheckIndex].bills = assignments[paycheckIndex].bills.map((candidate) =>
    billOccurrenceKey(candidate.billId, candidate.date) === key
      ? { ...candidate, isUnpayable: false, unfundableReason: undefined }
      : candidate
  );
  load[paycheckIndex] += bill.amount;
}

function tryPlaceBillOnEarlier(
  assignments: PaycheckAssignment[],
  load: number[],
  capacity: number[],
  bill: ProjectedBill,
  fromIndex: number,
  skippedBills: Set<string>,
  lockedBillKeys: Set<string>,
  maxCascadeDepth: number
): boolean {
  const earlierCandidates = getEligiblePaycheckIndices(bill, assignments, skippedBills)
    .filter((index) => index < fromIndex)
    .sort((a, b) => b - a);

  for (const targetIndex of earlierCandidates) {
    if (spareCapacity(load, capacity, targetIndex) >= bill.amount) {
      moveBill(assignments, bill, fromIndex, targetIndex, load);
      return true;
    }

    // Pass the full amount needed as spare — not (amount - currentSpare).
    // freeCapacity treats amountNeeded as a total spare target; passing the gap
    // caused a false early-return whenever spare > gap (spare roughly in
    // [bill/2, bill)).
    if (
      freeCapacityOnPaycheck(
        assignments,
        load,
        capacity,
        targetIndex,
        bill.amount,
        skippedBills,
        lockedBillKeys,
        0,
        maxCascadeDepth
      ) &&
      spareCapacity(load, capacity, targetIndex) >= bill.amount
    ) {
      moveBill(assignments, bill, fromIndex, targetIndex, load);
      return true;
    }
  }

  return false;
}

/**
 * After target/min relief, fund solver-marked unpayables in place at the min
 * floor when possible, otherwise move them earlier using break-glass spare.
 */
function rescueUnpayableBills(
  assignments: PaycheckAssignment[],
  load: number[],
  targetCapacity: number[],
  minCapacity: number[],
  skippedBills: Set<string>,
  lockedBillKeys: Set<string>,
  maxCascadeDepth: number
): number {
  let rescued = 0;

  for (let index = 0; index < assignments.length; index++) {
    for (const bill of rescuableUnpayablesOnPaycheck(assignments[index], lockedBillKeys)) {
      if (spareCapacity(load, targetCapacity, index) >= bill.amount) {
        fundUnpayableInPlace(assignments, index, bill, load);
        rescued += 1;
        continue;
      }

      if (spareCapacity(load, minCapacity, index) >= bill.amount) {
        fundUnpayableInPlace(assignments, index, bill, load);
        rescued += 1;
        continue;
      }

      if (
        tryPlaceBillOnEarlier(
          assignments,
          load,
          targetCapacity,
          bill,
          index,
          skippedBills,
          lockedBillKeys,
          maxCascadeDepth
        ) ||
        tryPlaceBillOnEarlier(
          assignments,
          load,
          minCapacity,
          bill,
          index,
          skippedBills,
          lockedBillKeys,
          maxCascadeDepth
        )
      ) {
        rescued += 1;
      }
    }
  }

  return rescued;
}

function spareCapacity(load: number[], capacity: number[], index: number): number {
  return capacity[index] - load[index];
}

/** Paycheck still needs bill moves — above target, or below min break-glass floor. */
function needsRelief(
  load: number,
  targetCapacity: number,
  minCapacity: number
): boolean {
  if (load <= targetCapacity) return false;
  if (load <= minCapacity) return false;
  return true;
}

/** Break-glass band: above target reserve but still above the min floor. */
function isBreakGlassLoad(
  load: number,
  targetCapacity: number,
  minCapacity: number
): boolean {
  return load > targetCapacity && load <= minCapacity;
}

function hasEarlierTargetSurplus(
  load: number[],
  targetCapacity: number[],
  fromIndex: number
): boolean {
  for (let index = 0; index < fromIndex; index++) {
    if (spareCapacity(load, targetCapacity, index) > 0) {
      return true;
    }
  }
  return false;
}

function freeCapacityOnPaycheck(
  assignments: PaycheckAssignment[],
  load: number[],
  capacity: number[],
  targetIndex: number,
  amountNeeded: number,
  skippedBills: Set<string>,
  lockedBillKeys: Set<string>,
  depth: number,
  maxCascadeDepth: number
): boolean {
  if (amountNeeded <= 0) return true;
  if (spareCapacity(load, capacity, targetIndex) >= amountNeeded) return true;
  if (depth >= maxCascadeDepth) return false;

  for (const bill of movableBillsOnPaycheck(assignments[targetIndex], lockedBillKeys)) {
    const earlierCandidates = getEligiblePaycheckIndices(bill, assignments, skippedBills)
      .filter((index) => index < targetIndex)
      .sort((a, b) => b - a);

    for (const earlierIndex of earlierCandidates) {
      if (
        spareCapacity(load, capacity, earlierIndex) < bill.amount &&
        !freeCapacityOnPaycheck(
          assignments,
          load,
          capacity,
          earlierIndex,
          bill.amount,
          skippedBills,
          lockedBillKeys,
          depth + 1,
          maxCascadeDepth
        )
      ) {
        continue;
      }

      if (spareCapacity(load, capacity, earlierIndex) < bill.amount) continue;

      moveBill(assignments, bill, targetIndex, earlierIndex, load);

      if (spareCapacity(load, capacity, targetIndex) >= amountNeeded) {
        return true;
      }
    }
  }

  return spareCapacity(load, capacity, targetIndex) >= amountNeeded;
}

function tryRelieveOverload(
  assignments: PaycheckAssignment[],
  load: number[],
  targetCapacity: number[],
  minCapacity: number[],
  overloadedIndex: number,
  skippedBills: Set<string>,
  lockedBillKeys: Set<string>,
  maxCascadeDepth: number
): boolean {
  if (
    !needsRelief(load[overloadedIndex], targetCapacity[overloadedIndex], minCapacity[overloadedIndex])
  ) {
    return false;
  }

  let changed = false;

  for (const bill of movableBillsOnPaycheck(assignments[overloadedIndex], lockedBillKeys)) {
    if (
      !needsRelief(load[overloadedIndex], targetCapacity[overloadedIndex], minCapacity[overloadedIndex])
    ) {
      break;
    }

    if (
      tryPlaceBillOnEarlier(
        assignments,
        load,
        targetCapacity,
        bill,
        overloadedIndex,
        skippedBills,
        lockedBillKeys,
        maxCascadeDepth
      ) ||
      tryPlaceBillOnEarlier(
        assignments,
        load,
        minCapacity,
        bill,
        overloadedIndex,
        skippedBills,
        lockedBillKeys,
        maxCascadeDepth
      )
    ) {
      changed = true;
    }
  }

  return changed;
}

/** Pull bills off break-glass paychecks when an earlier paycheck has target-tier spare. */
function tryDecongestBreakGlass(
  assignments: PaycheckAssignment[],
  load: number[],
  targetCapacity: number[],
  minCapacity: number[],
  congestedIndex: number,
  skippedBills: Set<string>,
  lockedBillKeys: Set<string>,
  maxCascadeDepth: number
): boolean {
  if (
    !isBreakGlassLoad(
      load[congestedIndex],
      targetCapacity[congestedIndex],
      minCapacity[congestedIndex]
    ) ||
    !hasEarlierTargetSurplus(load, targetCapacity, congestedIndex)
  ) {
    return false;
  }

  let changed = false;
  const movable = movableBillsOnPaycheck(assignments[congestedIndex], lockedBillKeys);

  for (const bill of movable) {
    if (
      !isBreakGlassLoad(
        load[congestedIndex],
        targetCapacity[congestedIndex],
        minCapacity[congestedIndex]
      )
    ) {
      break;
    }

    const placed =
      tryPlaceBillOnEarlier(
        assignments,
        load,
        targetCapacity,
        bill,
        congestedIndex,
        skippedBills,
        lockedBillKeys,
        maxCascadeDepth
      ) ||
      tryPlaceBillOnEarlier(
        assignments,
        load,
        minCapacity,
        bill,
        congestedIndex,
        skippedBills,
        lockedBillKeys,
        maxCascadeDepth
      );
    if (placed) {
      changed = true;
    }
  }

  return changed;
}

/**
 * Forward "dominos": while an earlier paycheck has target-tier spare, pull movable
 * bills from later paychecks nearest-first that are eligible for that earlier
 * date. Healthy-but-full intermediate weeks are actively lightened so room can
 * cascade toward a later break-glass paycheck (Jul 3 ← 10 ← 17 ← 24 ← 31).
 */
function tryForwardDominoFill(
  assignments: PaycheckAssignment[],
  load: number[],
  targetCapacity: number[],
  skippedBills: Set<string>,
  lockedBillKeys: Set<string>
): boolean {
  let changed = false;

  for (let earlier = 0; earlier < assignments.length - 1; earlier++) {
    while (spareCapacity(load, targetCapacity, earlier) > 0) {
      let placed = false;

      // Nearest later paycheck first — open Jul 10 into Jul 3 before reaching for Jul 17.
      for (let later = earlier + 1; later < assignments.length && !placed; later++) {
        // Shed lower-priority bills first so critical stays on the later paycheck when possible.
        const candidates = movableBillsOnPaycheck(assignments[later], lockedBillKeys).reverse();
        for (const bill of candidates) {
          if (spareCapacity(load, targetCapacity, earlier) < bill.amount) continue;
          const eligible = getEligiblePaycheckIndices(bill, assignments, skippedBills);
          if (!eligible.includes(earlier)) continue;

          moveBill(assignments, bill, later, earlier, load);
          changed = true;
          placed = true;
          break;
        }
      }

      if (!placed) break;
    }
  }

  return changed;
}

/**
 * Post-assignment pass: prefer target cash-on-hand on every paycheck, moving
 * movable bills earlier within the 14-day window. Paychecks may land between
 * min and target (break-glass) when target is infeasible; only load above the
 * min floor triggers further relief.
 */
export function rebalancePaycheckAssignments(
  assignments: PaycheckAssignment[],
  startingBalance: number,
  options: RebalanceOptions = {}
): void {
  const skippedBills = options.skippedBills ?? new Set();
  const lockedBillKeys = options.lockedBillKeys ?? new Set();
  const targetCashOnHand = options.targetCashOnHand ?? DEFAULT_TARGET_CASH_ON_HAND;
  const minCashOnHand = options.minCashOnHand ?? DEFAULT_MIN_CASH_ON_HAND;
  const maxPasses = options.maxPasses ?? 200;
  const maxCascadeDepth = options.maxCascadeDepth ?? 8;

  const targetCapacity = paycheckCapacity(assignments, startingBalance, targetCashOnHand);
  const minCapacity = paycheckCapacity(assignments, startingBalance, minCashOnHand);
  const load = paycheckLoad(assignments);

  for (let pass = 0; pass < maxPasses; pass++) {
    let changed = false;

    // 1) Dominos: fill earlier target surplus from later weeks (including healthy-but-full).
    if (
      tryForwardDominoFill(
        assignments,
        load,
        targetCapacity,
        skippedBills,
        lockedBillKeys
      )
    ) {
      changed = true;
    }

    // 2) True shortfalls below the min floor.
    for (let index = assignments.length - 1; index >= 0; index--) {
      if (
        !needsRelief(load[index], targetCapacity[index], minCapacity[index])
      ) {
        continue;
      }
      if (
        tryRelieveOverload(
          assignments,
          load,
          targetCapacity,
          minCapacity,
          index,
          skippedBills,
          lockedBillKeys,
          maxCascadeDepth
        )
      ) {
        changed = true;
      }
    }

    // 3) Break-glass leftovers: place earlier at target, then min, with cascade freeCapacity.
    for (let index = assignments.length - 1; index >= 0; index--) {
      if (
        tryDecongestBreakGlass(
          assignments,
          load,
          targetCapacity,
          minCapacity,
          index,
          skippedBills,
          lockedBillKeys,
          maxCascadeDepth
        )
      ) {
        changed = true;
      }
    }

    if (!changed) break;
  }

  rescueUnpayableBills(
    assignments,
    load,
    targetCapacity,
    minCapacity,
    skippedBills,
    lockedBillKeys,
    maxCascadeDepth
  );
}
