import { isAfter, differenceInDays } from 'date-fns';
import { PRIORITY_ORDER } from '../../utils/constants';
import { solvePaycheckDeficit } from '../../utils/rebalanceMicroSolver';
import {
  DEFAULT_MIN_CASH_ON_HAND,
  MAX_PREPAY_DAYS,
  MICRO_SOLVER_MAX_BILLS,
  RebalanceStrategy,
  UnfundableReason,
  PaycheckAssignment,
  ProjectedBill,
  billOccurrenceKey,
} from './types';
import { buildGoalReservePerPaycheck } from './goalReserves';
import { SavingsGoal } from '../database.service';

export interface RebalanceHelpers {
  getBalance: (index: number) => number;
  getSurplus: (index: number) => number;
  getDeficit: (index: number) => number;
  getFundingDeficit: (index: number) => number;
  getTotalDeficit: () => number;
  moveBill: (fromIdx: number, toIdx: number, bill: ProjectedBill) => boolean;
  getMovableBills: (index: number) => ProjectedBill[];
}

export function createRebalanceHelpers(
  assignments: PaycheckAssignment[],
  lockedBills: Set<string> = new Set(),
  poolOptions: {
    minCashOnHand: number;
    minSavingsPerPaycheck: number;
    goalReservePerPaycheck: number[];
  },
  strategy: RebalanceStrategy = 'deficit_killer'
): RebalanceHelpers {
  const { minCashOnHand, minSavingsPerPaycheck, goalReservePerPaycheck } = poolOptions;

  const getBillTotal = (index: number): number =>
    assignments[index].bills
      .filter(b => !b.isUnpayable)
      .reduce((sum, bill) => sum + bill.amount, 0);

  const getIncome = (index: number): number =>
    assignments[index].incomes.reduce((sum, inc) => sum + inc.amount, 0);

  const getBalance = (index: number): number => getIncome(index) - getBillTotal(index);

  /** Income minus bills and all three-pool commitments for this paycheck silo. */
  const getAvailableAfterCommitments = (index: number): number => {
    const goalReserve = goalReservePerPaycheck[index] ?? 0;
    return (
      getIncome(index) -
      getBillTotal(index) -
      minCashOnHand -
      minSavingsPerPaycheck -
      goalReserve
    );
  };

  const getSurplus = (index: number): number => {
    return Math.max(0, getAvailableAfterCommitments(index));
  };

  const getDeficit = (index: number): number => {
    return Math.max(0, -getAvailableAfterCommitments(index));
  };

  // Bills take absolute priority over goal and savings deposits. A paycheck can
  // always sacrifice its goal reserve and savings floor to pay a bill, so the
  // only thing protected ahead of bills is the minimum cash-on-hand. This is the
  // deficit that determines whether a bill is truly unfundable (vs. merely
  // competing with optional goal/savings allocation).
  const getFundingAvailable = (index: number): number => {
    return getIncome(index) - getBillTotal(index) - minCashOnHand;
  };

  const getFundingDeficit = (index: number): number => {
    return Math.max(0, -getFundingAvailable(index));
  };

  const getTotalDeficit = (): number => {
    return assignments.reduce((sum, _, i) => sum + getDeficit(i), 0);
  };

  const moveBill = (fromIdx: number, toIdx: number, bill: ProjectedBill): boolean => {
    const billKey = billOccurrenceKey(bill.billId, bill.date);
    if (lockedBills.has(billKey) || bill.isIncomeAttached) {
      return false;
    }

    const targetPaycheckDate = assignments[toIdx].date;
    const billDueDate = bill.date;
    const daysEarly = differenceInDays(billDueDate, targetPaycheckDate);

    if (daysEarly > MAX_PREPAY_DAYS) {
      return false;
    }

    const billIndex = assignments[fromIdx].bills.findIndex(b =>
      b.billId === bill.billId &&
      b.date.getTime() === bill.date.getTime() &&
      b.amount === bill.amount
    );

    if (billIndex === -1) {
      return false;
    }

    const alreadyInTarget = assignments[toIdx].bills.some(b =>
      b.billId === bill.billId &&
      b.date.getTime() === bill.date.getTime() &&
      b.amount === bill.amount
    );

    if (alreadyInTarget) {
      assignments[fromIdx].bills.splice(billIndex, 1);
      return true;
    }

    const [movedBill] = assignments[fromIdx].bills.splice(billIndex, 1);
    assignments[toIdx].bills.push(movedBill);
    return true;
  };

  const getMovableBills = (index: number): ProjectedBill[] => {
    const bills = [...assignments[index].bills].filter(
      (b) => !b.isIncomeAttached && !b.isUnpayable
    );

    if (strategy === 'prepay_minimizer') {
      return bills.sort((a, b) => {
        const daysEarlyA = differenceInDays(a.date, assignments[index].date);
        const daysEarlyB = differenceInDays(b.date, assignments[index].date);
        return daysEarlyA - daysEarlyB;
      });
    }

    if (strategy === 'goal_guardian') {
      return bills.sort((a, b) => {
        const priorityDiff = PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority];
        if (priorityDiff !== 0) return priorityDiff;
        return a.amount - b.amount;
      });
    }

    return bills.sort((a, b) => {
      const priorityDiff = PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return b.amount - a.amount;
    });
  };

  return { getBalance, getSurplus, getDeficit, getFundingDeficit, getTotalDeficit, moveBill, getMovableBills };
}

export function rebalancePhase1_DirectMoves(
  assignments: PaycheckAssignment[],
  helpers: RebalanceHelpers
): void {
  const { getSurplus, getDeficit, getTotalDeficit, moveBill, getMovableBills } = helpers;
  let maxPasses = 200;
  let madeProgress = true;

  while (madeProgress && maxPasses > 0 && getTotalDeficit() > 0) {
    madeProgress = false;
    maxPasses--;

    for (let i = assignments.length - 1; i >= 0; i--) {
      const deficitAmount = getDeficit(i);
      if (deficitAmount <= 0) continue;

      const movableBills = getMovableBills(i).sort((a, b) => {
        const aFit = Math.abs(a.amount - deficitAmount);
        const bFit = Math.abs(b.amount - deficitAmount);
        if (aFit !== bFit) return aFit - bFit;
        return PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority];
      });

      for (const bill of movableBills) {
        let bestJ = -1;
        let bestSurplus = Infinity;

        for (let j = i - 1; j >= 0; j--) {
          const surplus = getSurplus(j);
          if (surplus >= bill.amount && surplus < bestSurplus) {
            bestSurplus = surplus;
            bestJ = j;
          }
        }

        if (bestJ !== -1 && moveBill(i, bestJ, bill)) {
          madeProgress = true;
        }

        if (getDeficit(i) === 0) break;
      }
    }
  }
}

export function rebalancePhase2_CascadeMoves(
  assignments: PaycheckAssignment[],
  helpers: RebalanceHelpers
): void {
  const { getSurplus, getDeficit, getTotalDeficit, moveBill, getMovableBills } = helpers;
  let maxPasses = 200;
  let madeProgress = true;

  while (madeProgress && maxPasses > 0 && getTotalDeficit() > 0) {
    madeProgress = false;
    maxPasses--;

    for (let deficitIdx = assignments.length - 1; deficitIdx >= 0; deficitIdx--) {
      if (getDeficit(deficitIdx) === 0) continue;

      for (let midIdx = deficitIdx - 1; midIdx >= 1; midIdx--) {
        const midMovable = getMovableBills(midIdx);

        for (const midBill of midMovable) {
          let bestEarlyIdx = -1;
          let bestSurplus = Infinity;

          for (let earlyIdx = midIdx - 1; earlyIdx >= 0; earlyIdx--) {
            const surplus = getSurplus(earlyIdx);
            if (surplus >= midBill.amount && surplus < bestSurplus) {
              bestSurplus = surplus;
              bestEarlyIdx = earlyIdx;
            }
          }

          if (bestEarlyIdx !== -1 && moveBill(midIdx, bestEarlyIdx, midBill)) {
            madeProgress = true;

            const newCapacity = getSurplus(midIdx);
            const deficitBills = getMovableBills(deficitIdx).sort((a, b) => {
              const deficitAmount = getDeficit(deficitIdx);
              return Math.abs(a.amount - deficitAmount) - Math.abs(b.amount - deficitAmount);
            });

            for (const defBill of deficitBills) {
              if (newCapacity >= defBill.amount && moveBill(deficitIdx, midIdx, defBill)) {
                break;
              }
            }
          }

          if (getDeficit(deficitIdx) === 0) break;
        }
        if (getDeficit(deficitIdx) === 0) break;
      }
    }
  }
}

export function rebalancePhase3_DeepCascade(
  assignments: PaycheckAssignment[],
  helpers: RebalanceHelpers
): void {
  const { getSurplus, getDeficit, getTotalDeficit, moveBill, getMovableBills } = helpers;
  let maxPasses = 100;
  let madeProgress = true;

  while (madeProgress && maxPasses > 0 && getTotalDeficit() > 0) {
    madeProgress = false;
    maxPasses--;

    for (let deficitIdx = assignments.length - 1; deficitIdx >= 0; deficitIdx--) {
      const deficit = getDeficit(deficitIdx);
      if (deficit === 0) continue;

      const deficitBills = getMovableBills(deficitIdx);

      for (const targetBill of deficitBills) {
        for (let midIdx = deficitIdx - 1; midIdx >= 0; midIdx--) {
          const currentCapacity = getSurplus(midIdx);
          const needed = targetBill.amount - currentCapacity;

          if (needed <= 0) {
            if (moveBill(deficitIdx, midIdx, targetBill)) {
              madeProgress = true;
              break;
            }
          } else if (midIdx > 0) {
            const midBills = getMovableBills(midIdx)
              .filter(b => b.amount <= needed + 50);

            let freedAmount = 0;
            const billsToMove: { bill: ProjectedBill; to: number }[] = [];

            for (const midBill of midBills) {
              for (let earlyIdx = midIdx - 1; earlyIdx >= 0; earlyIdx--) {
                if (getSurplus(earlyIdx) >= midBill.amount) {
                  billsToMove.push({ bill: midBill, to: earlyIdx });
                  freedAmount += midBill.amount;
                  break;
                }
              }
              if (freedAmount >= needed) break;
            }

            if (freedAmount >= needed) {
              for (const move of billsToMove) {
                moveBill(midIdx, move.to, move.bill);
              }
              if (getSurplus(midIdx) >= targetBill.amount) {
                moveBill(deficitIdx, midIdx, targetBill);
                madeProgress = true;
                break;
              }
            }
          }
        }
        if (madeProgress) break;
      }
      if (madeProgress) break;
    }
  }
}

export function rebalancePhase4_EvenOut(
  assignments: PaycheckAssignment[],
  helpers: RebalanceHelpers,
  minCashOnHand: number
): void {
  const { getBalance, getSurplus, moveBill, getMovableBills } = helpers;
  let maxPasses = 50;
  let madeProgress = true;

  while (madeProgress && maxPasses > 0) {
    madeProgress = false;
    maxPasses--;

    for (let i = 1; i < assignments.length; i++) {
      const balance = getBalance(i);

      if (balance >= minCashOnHand && balance < minCashOnHand * 3) {
        const movableBills = getMovableBills(i);

        for (const bill of movableBills) {
          for (let j = i - 1; j >= 0; j--) {
            if (getSurplus(j) >= bill.amount + minCashOnHand) {
              if (moveBill(i, j, bill)) {
                madeProgress = true;
                break;
              }
            }
          }
          if (madeProgress) break;
        }
      }
      if (madeProgress) break;
    }
  }
}

export function rebalanceBacktrackSearch(
  assignments: PaycheckAssignment[],
  helpers: RebalanceHelpers,
  maxDepth = 4
): void {
  const { getTotalDeficit, getDeficit, getSurplus, moveBill, getMovableBills } = helpers;

  for (let depth = 0; depth < maxDepth && getTotalDeficit() > 0; depth++) {
    let madeProgress = false;

    for (let i = assignments.length - 1; i >= 0; i--) {
      if (getDeficit(i) <= 0) continue;

      for (const bill of getMovableBills(i)) {
        for (let j = i - 1; j >= 0; j--) {
          if (getSurplus(j) >= bill.amount && moveBill(i, j, bill)) {
            madeProgress = true;
            break;
          }
        }
        if (getDeficit(i) === 0) break;
      }
      if (madeProgress) break;
    }

    if (!madeProgress) break;
  }
}

export function rebalanceMicroSolver(
  assignments: PaycheckAssignment[],
  helpers: RebalanceHelpers
): void {
  const { getDeficit, getTotalDeficit, getSurplus, moveBill, getMovableBills } = helpers;

  if (getTotalDeficit() <= 0) {
    return;
  }

  let madeProgress = true;
  while (madeProgress && getTotalDeficit() > 0) {
    madeProgress = false;

    for (let i = assignments.length - 1; i >= 0; i--) {
      const deficitAmount = getDeficit(i);
      if (deficitAmount <= 0) continue;

      const movableBills = getMovableBills(i);
      if (movableBills.length === 0) continue;

      const earlierPaychecks = assignments.slice(0, i).map((assignment, index) => ({
        index,
        dateMs: assignment.date.getTime(),
        surplus: getSurplus(index),
      }));

      const solverBills = movableBills.map((bill) => ({
        key: billOccurrenceKey(bill.billId, bill.date),
        amount: bill.amount,
        dueDateMs: bill.date.getTime(),
      }));

      const plan = solvePaycheckDeficit(
        i,
        deficitAmount,
        earlierPaychecks,
        solverBills,
        MAX_PREPAY_DAYS,
        MICRO_SOLVER_MAX_BILLS
      );

      if (!plan || plan.moves.length === 0) {
        continue;
      }

      const billByKey = new Map(
        movableBills.map((bill) => [billOccurrenceKey(bill.billId, bill.date), bill])
      );

      for (const move of plan.moves) {
        const bill = billByKey.get(move.billKey);
        if (bill && moveBill(i, move.toIndex, bill)) {
          madeProgress = true;
        }
      }
    }
  }
}

export function diagnoseUnfundableReason(
  paycheckIndex: number,
  bill: ProjectedBill,
  assignments: PaycheckAssignment[],
  lockedBills: Set<string>,
  minCashOnHand: number,
  minSavingsPerPaycheck: number,
  goalReservePerPaycheck: number[]
): UnfundableReason {
  const income = assignments[paycheckIndex].incomes.reduce((sum, inc) => sum + inc.amount, 0);
  const billTotal = assignments[paycheckIndex].bills
    .filter((b) => !b.isUnpayable)
    .reduce((sum, b) => sum + b.amount, 0);
  const goalReserve = goalReservePerPaycheck[paycheckIndex] ?? 0;

  if (income < billTotal + minCashOnHand + minSavingsPerPaycheck + goalReserve) {
    if (goalReserve > 0 && income >= billTotal + minCashOnHand + minSavingsPerPaycheck) {
      return 'goal_reserve_conflict';
    }
    return 'insufficient_income_this_paycheck';
  }

  let hasEligibleEarlier = false;
  let hasUnlockedEligibleMove = false;
  const billKey = billOccurrenceKey(bill.billId, bill.date);

  for (let j = paycheckIndex - 1; j >= 0; j--) {
    const paycheckDate = assignments[j].date;
    if (isAfter(paycheckDate, bill.date)) continue;
    const daysEarly = differenceInDays(bill.date, paycheckDate);
    if (daysEarly > MAX_PREPAY_DAYS) continue;

    const targetIncome = assignments[j].incomes.reduce((sum, inc) => sum + inc.amount, 0);
    const targetBills = assignments[j].bills
      .filter((b) => !b.isUnpayable)
      .reduce((sum, b) => sum + b.amount, 0);
    const targetGoalReserve = goalReservePerPaycheck[j] ?? 0;
    const headroom =
      targetIncome -
      targetBills -
      minCashOnHand -
      minSavingsPerPaycheck -
      targetGoalReserve;

    if (headroom >= bill.amount) {
      hasEligibleEarlier = true;
      if (!lockedBills.has(billKey) && !bill.isIncomeAttached) {
        hasUnlockedEligibleMove = true;
      }
    }
  }

  if (!hasEligibleEarlier) {
    return 'no_eligible_earlier_paycheck';
  }
  if (!hasUnlockedEligibleMove) {
    return 'all_movable_bills_locked';
  }
  return 'insufficient_income_this_paycheck';
}

export function rebalanceFinalCleanup(assignments: PaycheckAssignment[]): void {
  // Deduplicate bills across all paychecks
  const seenBills = new Set<string>();
  for (const assignment of assignments) {
    assignment.bills = assignment.bills.filter(bill => {
      const key = billOccurrenceKey(bill.billId, bill.date);
      if (seenBills.has(key)) {
        return false;
      }
      seenBills.add(key);
      return true;
    });
  }

  // Re-sort bills by priority
  for (const assignment of assignments) {
    assignment.bills.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
  }
}

export function rebalanceBills(
  assignments: PaycheckAssignment[],
  lockedBills: Set<string> = new Set(),
  goals: SavingsGoal[] = [],
  minCashOnHand: number = DEFAULT_MIN_CASH_ON_HAND,
  minSavingsPerPaycheck: number = 0,
  strategy: RebalanceStrategy = 'deficit_killer'
): void {
  const goalReservePerPaycheck = buildGoalReservePerPaycheck(assignments, goals);
  const poolOptions = { minCashOnHand, minSavingsPerPaycheck, goalReservePerPaycheck };
  const helpers = createRebalanceHelpers(assignments, lockedBills, poolOptions, strategy);

  // Phase 1: Direct moves - move bills from deficit to surplus paychecks
  rebalancePhase1_DirectMoves(assignments, helpers);

  // Phase 2: Cascade moves - create capacity by moving bills between non-deficit paychecks
  rebalancePhase2_CascadeMoves(assignments, helpers);

  // Phase 3: Deep cascade - try moving smaller bills to create room for larger ones
  rebalancePhase3_DeepCascade(assignments, helpers);

  // Phase 4: Even out paychecks for better breathing room
  rebalancePhase4_EvenOut(assignments, helpers, minCashOnHand);

  // Phase 5: Bounded backtrack search when deficits remain
  rebalanceBacktrackSearch(assignments, helpers);

  // Phase 6: Exact micro-solver for stubborn single-paycheck deficits
  rebalanceMicroSolver(assignments, helpers);

  // Final cleanup: deduplicate and sort
  rebalanceFinalCleanup(assignments);
}
