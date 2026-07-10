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

function movableBillsOnPaycheck(
  assignment: PaycheckAssignment,
  lockedBillKeys: Set<string>
): ProjectedBill[] {
  return assignment.bills
    .filter((bill) => isMovableBill(bill, lockedBillKeys))
    .sort((a, b) => PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority]);
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
  removeBillAt(assignments, fromIndex, bill);
  addBillAt(assignments, toIndex, bill);
  load[fromIndex] -= bill.amount;
  load[toIndex] += bill.amount;
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
      const roomNeeded = Math.max(0, bill.amount - spareCapacity(load, capacity, earlierIndex));
      if (
        roomNeeded > 0 &&
        !freeCapacityOnPaycheck(
          assignments,
          load,
          capacity,
          earlierIndex,
          roomNeeded,
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

    const earlierCandidates = getEligiblePaycheckIndices(bill, assignments, skippedBills)
      .filter((index) => index < overloadedIndex)
      .sort((a, b) => b - a);

    for (const targetIndex of earlierCandidates) {
      if (spareCapacity(load, targetCapacity, targetIndex) >= bill.amount) {
        moveBill(assignments, bill, overloadedIndex, targetIndex, load);
        changed = true;
        break;
      }

      const roomNeeded = bill.amount - spareCapacity(load, targetCapacity, targetIndex);
      if (
        freeCapacityOnPaycheck(
          assignments,
          load,
          targetCapacity,
          targetIndex,
          roomNeeded,
          skippedBills,
          lockedBillKeys,
          0,
          maxCascadeDepth
        ) &&
        spareCapacity(load, targetCapacity, targetIndex) >= bill.amount
      ) {
        moveBill(assignments, bill, overloadedIndex, targetIndex, load);
        changed = true;
        break;
      }
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

    if (!changed) break;
  }
}
