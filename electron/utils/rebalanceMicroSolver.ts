/**
 * Exact micro-solver for a single deficit paycheck (Phase F).
 * When greedy rebalance and backtracking fail, tries all assignments of
 * movable bills to earlier paychecks (≤ maxBills) to clear the deficit
 * while minimizing total days-early prepay.
 */

export interface MicroSolverPaycheck {
  index: number;
  dateMs: number;
  surplus: number;
}

export interface MicroSolverBill {
  key: string;
  amount: number;
  dueDateMs: number;
}

export interface MicroSolverMove {
  billKey: string;
  toIndex: number;
}

export interface MicroSolverResult {
  moves: MicroSolverMove[];
  totalDaysEarly: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysEarly(dueDateMs: number, paycheckDateMs: number): number {
  return Math.max(0, Math.round((dueDateMs - paycheckDateMs) / MS_PER_DAY));
}

function eligibleTargets(
  bill: MicroSolverBill,
  deficitIndex: number,
  paychecks: MicroSolverPaycheck[],
  maxPrepayDays: number
): number[] {
  const targets: number[] = [];
  for (const paycheck of paychecks) {
    if (paycheck.index >= deficitIndex) continue;
    const early = daysEarly(bill.dueDateMs, paycheck.dateMs);
    if (early > maxPrepayDays) continue;
    if (paycheck.dateMs > bill.dueDateMs) continue;
    targets.push(paycheck.index);
  }
  return targets;
}

/**
 * Find a move plan that clears `deficitAmount` on `deficitIndex` by moving
 * a subset of `bills` to earlier paychecks without exceeding their surplus.
 * Returns null when no feasible plan exists within the bill cap.
 */
export function solvePaycheckDeficit(
  deficitIndex: number,
  deficitAmount: number,
  paychecks: MicroSolverPaycheck[],
  bills: MicroSolverBill[],
  maxPrepayDays: number,
  maxBills = 8
): MicroSolverResult | null {
  if (deficitAmount <= 0 || bills.length === 0) {
    return { moves: [], totalDaysEarly: 0 };
  }

  const cappedBills = bills.slice(0, maxBills);
  const paycheckByIndex = new Map(paychecks.map((p) => [p.index, p]));
  const surplusByIndex = new Map(paychecks.map((p) => [p.index, p.surplus]));

  let best: MicroSolverResult | null = null;

  const search = (
    billIdx: number,
    remainingDeficit: number,
    moves: MicroSolverMove[],
    totalDaysEarly: number
  ): void => {
    if (remainingDeficit <= 0) {
      if (!best || totalDaysEarly < best.totalDaysEarly) {
        best = { moves: [...moves], totalDaysEarly };
      }
      return;
    }

    if (billIdx >= cappedBills.length) {
      return;
    }

    const bill = cappedBills[billIdx];
    const targets = eligibleTargets(bill, deficitIndex, paychecks, maxPrepayDays);

    // Leave bill on the deficit paycheck.
    search(billIdx + 1, remainingDeficit, moves, totalDaysEarly);

    for (const toIndex of targets) {
      const available = surplusByIndex.get(toIndex) ?? 0;
      if (available < bill.amount) continue;

      const paycheck = paycheckByIndex.get(toIndex);
      if (!paycheck) continue;

      surplusByIndex.set(toIndex, available - bill.amount);
      moves.push({ billKey: bill.key, toIndex });
      search(
        billIdx + 1,
        remainingDeficit - bill.amount,
        moves,
        totalDaysEarly + daysEarly(bill.dueDateMs, paycheck.dateMs)
      );
      moves.pop();
      surplusByIndex.set(toIndex, available);
    }
  };

  search(0, deficitAmount, [], 0);
  return best;
}
