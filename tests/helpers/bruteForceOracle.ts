import {
  UNPAID_PLACEMENT,
  compareTierVectors,
  scoreObjective,
  type BillPriority,
  type ObjectiveBill,
  type ObjectivePaycheck,
  type TierVector,
} from '../../electron/services/scheduler/model/objective';

/** Brute force is only for tiny instances. 5^8 assignments is the full grid. */
export const MAX_ORACLE_BILLS = 8;
export const MAX_ORACLE_PAYCHECKS = 4;

export interface OracleBill {
  amountCents: number;
  priority: BillPriority;
  /** UTC day number of the due date. */
  dueDay: number;
  eligiblePaycheckIndexes: readonly number[];
  /**
   * Lock, income attachment, or preferred placement.
   * The bill may only be paid on this paycheck, or left unpaid.
   */
  fixedPaycheckIndex?: number;
  /** Unpaid cents count toward T0. Preferred placements are fixed and not pinned. */
  isPinned?: boolean;
}

export interface OraclePaycheck {
  /** UTC day number. */
  day: number;
  /** Spendable cents before bills, including any first-paycheck starting balance. */
  capacityCents: number;
  minCashCents: number;
  targetCashCents: number;
}

export interface OracleProblem {
  bills: readonly OracleBill[];
  paychecks: readonly OraclePaycheck[];
}

export interface OracleResult {
  /** Paycheck index per bill, or `UNPAID_PLACEMENT`. */
  placement: number[];
  vector: TierVector;
}

function assertPaycheckIndex(index: number, paycheckCount: number, label: string): void {
  if (!Number.isInteger(index) || index < 0 || index >= paycheckCount) {
    throw new Error(`${label} is outside the paycheck list`);
  }
}

function choicesFor(bill: OracleBill, paycheckCount: number, label: string): number[] {
  if (bill.fixedPaycheckIndex !== undefined) {
    assertPaycheckIndex(bill.fixedPaycheckIndex, paycheckCount, label);
    return [bill.fixedPaycheckIndex, UNPAID_PLACEMENT];
  }

  const eligible = [...new Set(bill.eligiblePaycheckIndexes)];
  eligible.sort((left, right) => left - right);
  for (const index of eligible) {
    assertPaycheckIndex(index, paycheckCount, label);
  }
  eligible.push(UNPAID_PLACEMENT);
  return eligible;
}

/**
 * Exhaustive minimum of the shared tier vector.
 * Hard constraint: paid bills never exceed a paycheck's capacity, so a
 * paycycle is never planned negative. Unpaid is always a candidate.
 * Unpaid tiers outrank cash floors and earliness, so a bill that fits a
 * legal paycheck is paid even if that dips below the floor.
 * Remaining cash is capacity minus bills that were paid.
 * Ties keep the earliest candidate in paycheck-index order.
 */
export function bruteForceOracle(problem: OracleProblem): OracleResult {
  if (
    problem.bills.length > MAX_ORACLE_BILLS ||
    problem.paychecks.length > MAX_ORACLE_PAYCHECKS
  ) {
    throw new Error(
      `brute-force oracle supports at most ${MAX_ORACLE_BILLS} bills and ${MAX_ORACLE_PAYCHECKS} paychecks`
    );
  }

  const choiceLists = problem.bills.map((bill, index) =>
    choicesFor(bill, problem.paychecks.length, `oracle bill ${index}`)
  );
  const objectiveBills: ObjectiveBill[] = problem.bills.map((bill) => ({
    amountCents: bill.amountCents,
    priority: bill.priority,
    dueDay: bill.dueDay,
    isPinned: bill.isPinned,
  }));

  const scorePlacement = (placement: readonly number[]): TierVector | null => {
    const spent = new Array<number>(problem.paychecks.length).fill(0);
    for (let index = 0; index < placement.length; index++) {
      const paycheckIndex = placement[index];
      if (paycheckIndex === UNPAID_PLACEMENT) continue;
      spent[paycheckIndex] += problem.bills[index].amountCents;
    }
    for (let index = 0; index < spent.length; index++) {
      if (spent[index] > 0 && spent[index] > problem.paychecks[index].capacityCents) {
        return null;
      }
    }
    const paychecks: ObjectivePaycheck[] = problem.paychecks.map((paycheck, index) => ({
      day: paycheck.day,
      remainingCents: paycheck.capacityCents - spent[index],
      minCashCents: paycheck.minCashCents,
      targetCashCents: paycheck.targetCashCents,
    }));
    return scoreObjective({ bills: objectiveBills, paychecks, placement });
  };

  let bestPlacement: number[] | null = null;
  let bestVector: TierVector | null = null;

  const consider = (placement: number[]): void => {
    const vector = scorePlacement(placement);
    if (vector === null) return;
    if (bestVector === null || compareTierVectors(vector, bestVector) < 0) {
      bestVector = vector;
      bestPlacement = placement.slice();
    }
  };

  const placement = new Array<number>(problem.bills.length).fill(UNPAID_PLACEMENT);
  const search = (billIndex: number): void => {
    if (billIndex === problem.bills.length) {
      consider(placement);
      return;
    }
    for (const choice of choiceLists[billIndex]) {
      placement[billIndex] = choice;
      search(billIndex + 1);
    }
  };

  search(0);

  if (bestPlacement === null || bestVector === null) {
    throw new Error('brute-force oracle did not find an assignment');
  }

  return { placement: bestPlacement, vector: bestVector };
}
