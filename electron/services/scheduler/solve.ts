import { latestEligibleIndex } from './eligibility';

export interface SolvePaycheck {
  index: number;
  dateMs: number;
  capacityCents: number;
}

export interface SolveBillInput {
  billKey: string;
  amountCents: number;
  dueDateMs: number;
  candidateIndices: number[];
  lockedIndex?: number;
}

export interface SolveBillResult {
  billKey: string;
  paycheckIndex: number;
  isUnpayable: boolean;
}

export interface SolutionMetrics {
  unpaidCents: number;
  shortfallPaycheckCount: number;
  totalDaysEarly: number;
  tieBreak: string;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysEarly(dueMs: number, paycheckMs: number): number {
  return Math.max(0, Math.round((dueMs - paycheckMs) / MS_PER_DAY));
}

function computeMetrics(
  bills: SolveBillInput[],
  assignment: Map<string, { index: number; unpayable: boolean }>,
  paychecks: SolvePaycheck[]
): SolutionMetrics {
  const used = new Map<number, number>();
  let unpaidCents = 0;
  let totalDaysEarly = 0;
  const tieParts: string[] = [];

  for (const bill of bills) {
    const a = assignment.get(bill.billKey)!;
    if (!a.unpayable) {
      used.set(a.index, (used.get(a.index) ?? 0) + bill.amountCents);
    }
    if (a.unpayable) {
      unpaidCents += bill.amountCents;
    } else {
      const pc = paychecks.find((p) => p.index === a.index)!;
      totalDaysEarly += daysEarly(bill.dueDateMs, pc.dateMs);
    }
    tieParts.push(`${bill.billKey}:${a.index}:${a.unpayable ? 1 : 0}`);
  }

  let shortfallPaycheckCount = 0;
  for (const pc of paychecks) {
    const load = used.get(pc.index) ?? 0;
    if (load > pc.capacityCents) shortfallPaycheckCount++;
  }

  return {
    unpaidCents,
    shortfallPaycheckCount,
    totalDaysEarly,
    tieBreak: tieParts.join('|'),
  };
}

function isBetter(a: SolutionMetrics, b: SolutionMetrics | null): boolean {
  if (!b) return true;
  if (a.unpaidCents !== b.unpaidCents) return a.unpaidCents < b.unpaidCents;
  if (a.shortfallPaycheckCount !== b.shortfallPaycheckCount) {
    return a.shortfallPaycheckCount < b.shortfallPaycheckCount;
  }
  if (a.totalDaysEarly !== b.totalDaysEarly) return a.totalDaysEarly < b.totalDaysEarly;
  return a.tieBreak < b.tieBreak;
}

/**
 * Exact lexicographic assignment for one cluster:
 * 1) minimize unpaid cents, 2) minimize shortfall paycheck count,
 * 3) minimize days-early, 4) stable tie-break.
 */
export function solveCluster(
  paychecks: SolvePaycheck[],
  bills: SolveBillInput[]
): SolveBillResult[] {
  if (bills.length === 0) return [];

  const sortedBills = [...bills].sort((a, b) => a.billKey.localeCompare(b.billKey));

  let bestAssignment = new Map<string, { index: number; unpayable: boolean }>();
  let bestMetrics: SolutionMetrics | null = null;

  const assignment = new Map<string, { index: number; unpayable: boolean }>();
  const used = new Map<number, number>();

  function partialUnpaid(): number {
    let sum = 0;
    for (const [key, val] of assignment) {
      if (val.unpayable) {
        const b = sortedBills.find((x) => x.billKey === key)!;
        sum += b.amountCents;
      }
    }
    return sum;
  }

  function search(billIdx: number): void {
    if (billIdx >= sortedBills.length) {
      const metrics = computeMetrics(sortedBills, assignment, paychecks);
      if (isBetter(metrics, bestMetrics)) {
        bestMetrics = metrics;
        bestAssignment = new Map(assignment);
      }
      return;
    }

    const bill = sortedBills[billIdx];

    const tryAssign = (index: number, unpayable: boolean) => {
      const pc = paychecks.find((p) => p.index === index);
      if (!pc) return;

      const prev = used.get(index) ?? 0;
      if (!unpayable && prev + bill.amountCents > pc.capacityCents) {
        return;
      }

      assignment.set(bill.billKey, { index, unpayable });
      if (!unpayable) {
        used.set(index, prev + bill.amountCents);
      }

      if (!bestMetrics || partialUnpaid() <= bestMetrics.unpaidCents) {
        search(billIdx + 1);
      }

      if (!unpayable) {
        used.set(index, prev);
      }
      assignment.delete(bill.billKey);
    };

    if (bill.lockedIndex !== undefined) {
      tryAssign(bill.lockedIndex, false);
      return;
    }

    const latest = latestEligibleIndex(bill.candidateIndices);
    tryAssign(latest, true);

    const candidates = [...bill.candidateIndices].sort((a, b) => b - a);
    for (const idx of candidates) {
      tryAssign(idx, false);
    }
  }

  search(0);

  return sortedBills.map((bill) => {
    const a = bestAssignment.get(bill.billKey)!;
    return {
      billKey: bill.billKey,
      paycheckIndex: a.index,
      isUnpayable: a.unpayable,
    };
  });
}

const MAX_EXACT_CLUSTER_BILLS = 16;

function solveClusterGreedy(
  paychecks: SolvePaycheck[],
  bills: SolveBillInput[]
): SolveBillResult[] {
  const sortedBills = [...bills].sort((a, b) => a.billKey.localeCompare(b.billKey));
  const assignment = new Map<string, { index: number; unpayable: boolean }>();
  const used = new Map<number, number>();

  const capacity = (idx: number) =>
    paychecks.find((p) => p.index === idx)?.capacityCents ?? 0;

  const tryPlace = (bill: SolveBillInput, index: number, unpayable: boolean) => {
    const prev = used.get(index) ?? 0;
    if (!unpayable && prev + bill.amountCents > capacity(index)) return false;
    assignment.set(bill.billKey, { index, unpayable });
    if (!unpayable) {
      used.set(index, prev + bill.amountCents);
    }
    return true;
  };

  const remove = (bill: SolveBillInput) => {
    const a = assignment.get(bill.billKey);
    if (!a) return;
    if (!a.unpayable) {
      used.set(a.index, (used.get(a.index) ?? 0) - bill.amountCents);
    }
    assignment.delete(bill.billKey);
  };

  for (const bill of sortedBills) {
    if (bill.lockedIndex !== undefined) {
      tryPlace(bill, bill.lockedIndex, false);
      continue;
    }
    let placed = false;
    for (const idx of [...bill.candidateIndices].sort((a, b) => b - a)) {
      if (tryPlace(bill, idx, false)) {
        placed = true;
        break;
      }
    }
    if (!placed) {
      const latest = latestEligibleIndex(bill.candidateIndices);
      tryPlace(bill, latest, true);
    }
  }

  const load = (idx: number) => used.get(idx) ?? 0;

  let changed = true;
  let guard = 500;
  while (changed && guard-- > 0) {
    changed = false;
    for (const pc of paychecks) {
      if (load(pc.index) <= pc.capacityCents) continue;
      const onPaycheck = sortedBills.filter(
        (b) => assignment.get(b.billKey)?.index === pc.index && !assignment.get(b.billKey)!.unpayable
      );
      for (const bill of onPaycheck) {
        for (const idx of [...bill.candidateIndices].filter((i) => i > pc.index).sort((a, b) => b - a)) {
          remove(bill);
          if (tryPlace(bill, idx, false)) {
            changed = true;
            break;
          }
          tryPlace(bill, pc.index, false);
        }
        if (changed) break;
      }
    }
  }

  guard = 500;
  changed = true;
  while (changed && guard-- > 0) {
    changed = false;
    for (const pc of paychecks) {
      if (load(pc.index) <= pc.capacityCents) continue;
      const onPaycheck = sortedBills.filter(
        (b) => assignment.get(b.billKey)?.index === pc.index && !assignment.get(b.billKey)!.unpayable
      );
      for (const bill of onPaycheck) {
        for (const idx of [...bill.candidateIndices].filter((i) => i < pc.index).sort((a, b) => b - a)) {
          remove(bill);
          if (tryPlace(bill, idx, false)) {
            changed = true;
            break;
          }
          tryPlace(bill, pc.index, false);
        }
        if (changed) break;
      }
    }
  }

  for (const pc of paychecks) {
    while (load(pc.index) > pc.capacityCents) {
      const candidates = sortedBills
        .filter((b) => assignment.get(b.billKey)?.index === pc.index && !assignment.get(b.billKey)!.unpayable)
        .sort((a, b) => a.billKey.localeCompare(b.billKey));
      const bill = candidates[0];
      if (!bill) break;
      remove(bill);
      tryPlace(bill, pc.index, true);
    }
  }

  return sortedBills.map((bill) => {
    const a = assignment.get(bill.billKey)!;
    return {
      billKey: bill.billKey,
      paycheckIndex: a.index,
      isUnpayable: a.unpayable,
    };
  });
}

export function solveClusterBounded(
  paychecks: SolvePaycheck[],
  bills: SolveBillInput[]
): SolveBillResult[] {
  const useExact = bills.length <= MAX_EXACT_CLUSTER_BILLS;
  if (useExact) {
    return solveCluster(paychecks, bills);
  }
  return solveClusterGreedy(paychecks, bills);
}
