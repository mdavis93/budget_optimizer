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
    used.set(a.index, (used.get(a.index) ?? 0) + bill.amountCents);
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
      used.set(index, prev + bill.amountCents);

      if (!bestMetrics || partialUnpaid() <= bestMetrics.unpaidCents) {
        search(billIdx + 1);
      }

      used.set(index, prev);
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
