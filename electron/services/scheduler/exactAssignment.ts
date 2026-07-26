import { format, isAfter, isEqual } from 'date-fns';
import { Bill } from '../database.service';
import { toCents } from './money';
import { buildEligibleBills } from './eligibility';
import { clusterEligibleBills } from './clusters';
import { SolveBillInput, SolvePaycheck, solveClusterBounded } from './solve';
import { rebalancePaycheckAssignments } from './rebalance';
import {
  cashTargetForDate,
  type CashOnHandByDate,
} from './cashOnHandOverrides';
import {
  DEFAULT_MIN_CASH_ON_HAND,
  DEFAULT_TARGET_CASH_ON_HAND,
  PaycheckAssignment,
  ProjectedBill,
  ProjectedIncome,
  billOccurrenceKey,
} from './types';

export interface ExactAssignmentOptions {
  startingBalanceCents?: number;
  skippedBills?: Set<string>;
  /** Hard locks (user drag). Pre-placed and excluded from rebalance moves. */
  manualAssignments?: Map<string, string>;
  /**
   * Soft seeds (Advisor / reconciliation Accept). Pre-placed for this run only;
   * not added to lockedKeys so rebalance may still move them.
   */
  preferredAssignments?: Map<string, string>;
  incomeAttachedBillsRaw?: Bill[];
  lockedBillKeys?: Set<string>;
  targetCashOnHand?: number;
  minCashOnHand?: number;
  cashOnHandByDate?: CashOnHandByDate;
}

function buildPaycheckSkeleton(
  paycheckDates: Date[],
  allIncomes: ProjectedIncome[]
): PaycheckAssignment[] {
  return paycheckDates.map((paycheckDate) => ({
    date: paycheckDate,
    incomes: allIncomes.filter((inc) => isEqual(inc.date, paycheckDate)),
    bills: [],
  }));
}

function applyIncomeAttachedBills(
  assignments: PaycheckAssignment[],
  incomeAttachedBillsRaw: Bill[],
  skippedBills: Set<string>
): Set<string> {
  const keys = new Set<string>();

  for (const bill of incomeAttachedBillsRaw) {
    for (const paycheck of assignments) {
      const hasMatchingIncome = paycheck.incomes.some(
        (inc) => inc.sourceId === bill.preferredIncomeSourceId
      );
      if (!hasMatchingIncome) continue;

      const paycheckDateStr = format(paycheck.date, 'yyyy-MM-dd');
      const skipKey = `${bill.id}-${paycheckDateStr}`;
      if (skippedBills.has(skipKey)) {
        paycheck.bills.push({
          date: paycheck.date,
          billId: bill.id,
          creditorName: bill.creditorName,
          amount: bill.budgetedAmount,
          dueDay: bill.dueDay,
          priority: bill.priority,
          category: bill.category,
          preferredIncomeSourceId: bill.preferredIncomeSourceId,
          isIncomeAttached: true,
          isSkipped: true,
        });
        keys.add(billOccurrenceKey(bill.id, paycheck.date));
        continue;
      }

      paycheck.bills.push({
        date: paycheck.date,
        billId: bill.id,
        creditorName: bill.creditorName,
        amount: bill.budgetedAmount,
        dueDay: bill.dueDay,
        priority: bill.priority,
        category: bill.category,
        preferredIncomeSourceId: bill.preferredIncomeSourceId,
        isIncomeAttached: true,
      });
      keys.add(billOccurrenceKey(bill.id, paycheck.date));
    }
  }

  return keys;
}

function applyFixedAssignments(
  assignments: PaycheckAssignment[],
  allBills: ProjectedBill[],
  placementMap: Map<string, string>,
  skippedBills: Set<string>,
  alreadyPlaced: Set<string>,
  options: { lock: boolean; lockedKeys: Set<string> }
): void {
  for (const bill of allBills) {
    const billDateStr = format(bill.date, 'yyyy-MM-dd');
    const occurrence = billOccurrenceKey(bill.billId, bill.date);
    if (alreadyPlaced.has(occurrence)) continue;

    const assignmentKey = `${bill.billId}-${billDateStr}`;
    const targetPaycheckDate = placementMap.get(assignmentKey);
    if (!targetPaycheckDate) continue;

    const skipKey = `${bill.billId}-${billDateStr}`;
    if (skippedBills.has(skipKey)) continue;

    const paycheckIdx = assignments.findIndex(
      (p) => format(p.date, 'yyyy-MM-dd') === targetPaycheckDate
    );
    if (paycheckIdx === -1) continue;

    assignments[paycheckIdx].bills.push(bill);
    alreadyPlaced.add(occurrence);
    if (options.lock) {
      options.lockedKeys.add(occurrence);
    }
  }
}

function buildSolvePaychecks(
  assignments: PaycheckAssignment[],
  startingBalanceCents: number,
  targetReserves: number[]
): SolvePaycheck[] {
  return assignments.map((assignment, index) => {
    const incomeCents = assignment.incomes.reduce((sum, inc) => sum + toCents(inc.amount), 0);
    const ledgerBoost = index === 0 ? startingBalanceCents : 0;
    const reserveCents = toCents(targetReserves[index]);
    // Pre-placed income-attached / manual bills already consume capacity.
    const lockedPayableCents = assignment.bills
      .filter((bill) => !bill.isUnpayable && !bill.isSkipped)
      .reduce((sum, bill) => sum + toCents(bill.amount), 0);
    const capacityCents = Math.max(
      0,
      incomeCents + ledgerBoost - reserveCents - lockedPayableCents
    );
    return {
      index,
      dateMs: assignment.date.getTime(),
      capacityCents,
    };
  });
}

/**
 * Assign bills to paychecks using the exact windowed solver (due date is
 * source of truth; bidirectional within the 14-day eligibility window).
 */
export function assignBillsExact(
  paycheckDates: Date[],
  allIncomes: ProjectedIncome[],
  allBills: ProjectedBill[],
  startingBalance: number,
  options: ExactAssignmentOptions = {}
): PaycheckAssignment[] {
  const skippedBills = options.skippedBills ?? new Set();
  const manualAssignments = options.manualAssignments ?? new Map();
  const preferredAssignments = options.preferredAssignments ?? new Map();
  const incomeAttachedBillsRaw = options.incomeAttachedBillsRaw ?? [];
  const minCashOnHand = options.minCashOnHand ?? DEFAULT_MIN_CASH_ON_HAND;
  const targetCashOnHand = options.targetCashOnHand ?? DEFAULT_TARGET_CASH_ON_HAND;
  const cashOnHandByDate = options.cashOnHandByDate;
  const lockedKeys = new Set(options.lockedBillKeys ?? []);
  const alreadyPlaced = new Set<string>();

  const assignments = buildPaycheckSkeleton(paycheckDates, allIncomes);

  // User drag locks first — win over soft preferences for the same occurrence.
  applyFixedAssignments(
    assignments,
    allBills,
    manualAssignments,
    skippedBills,
    alreadyPlaced,
    { lock: true, lockedKeys }
  );

  const incomeAttachedKeys = applyIncomeAttachedBills(
    assignments,
    incomeAttachedBillsRaw,
    skippedBills
  );
  for (const key of incomeAttachedKeys) {
    lockedKeys.add(key);
    alreadyPlaced.add(key);
  }

  // Advisor / reconciliation Accept: seed placement without locking.
  applyFixedAssignments(
    assignments,
    allBills,
    preferredAssignments,
    skippedBills,
    alreadyPlaced,
    { lock: false, lockedKeys }
  );

  const solverBills = allBills.filter(
    (b) => !alreadyPlaced.has(billOccurrenceKey(b.billId, b.date))
  );

  const eligible = buildEligibleBills(solverBills, assignments, skippedBills);
  const clusters = clusterEligibleBills(eligible);
  const targetReserves = assignments.map((assignment) =>
    cashTargetForDate(
      cashOnHandByDate,
      format(assignment.date, 'yyyy-MM-dd'),
      targetCashOnHand
    )
  );
  const solvePaychecks = buildSolvePaychecks(
    assignments,
    toCents(startingBalance),
    targetReserves
  );

  for (const cluster of clusters) {
    const involvedIndices = new Set<number>();
    for (const item of cluster) {
      for (const idx of item.candidateIndices) involvedIndices.add(idx);
    }

    const clusterPaychecks = solvePaychecks.filter((p) => involvedIndices.has(p.index));

    const billInputs: SolveBillInput[] = cluster.map((item) => {
      const key = item.billKey;
      const manualDate = manualAssignments.get(
        `${item.bill.billId}-${format(item.bill.date, 'yyyy-MM-dd')}`
      );
      let lockedIndex: number | undefined;
      if (manualDate) {
        lockedIndex = assignments.findIndex(
          (p) => format(p.date, 'yyyy-MM-dd') === manualDate
        );
        if (lockedIndex === -1) lockedIndex = undefined;
      }

      return {
        billKey: key,
        amountCents: toCents(item.bill.amount),
        dueDateMs: item.bill.date.getTime(),
        candidateIndices: item.candidateIndices,
        lockedIndex,
      };
    });

    const results = solveClusterBounded(clusterPaychecks, billInputs);
    const billByKey = new Map(cluster.map((c) => [c.billKey, c.bill]));

    for (const result of results) {
      const bill = billByKey.get(result.billKey);
      if (!bill) continue;

      const placed = { ...bill };
      if (result.isUnpayable) {
        placed.isUnpayable = true;
        placed.unfundableReason = 'insufficient_income_in_window';
      }

      assignments[result.paycheckIndex].bills.push(placed);
    }
  }

  // Bills with no eligibility window: attach to latest paycheck on/before due
  const eligibleKeys = new Set(eligible.map((e) => e.billKey));
  for (const bill of solverBills) {
    const key = billOccurrenceKey(bill.billId, bill.date);
    if (eligibleKeys.has(key)) continue;

    let landing = -1;
    for (let i = assignments.length - 1; i >= 0; i--) {
      if (!isAfter(assignments[i].date, bill.date)) {
        landing = i;
        break;
      }
    }
    if (landing === -1) continue;

    assignments[landing].bills.push({
      ...bill,
      isUnpayable: true,
      unfundableReason: 'no_eligible_paycheck_in_window',
    });
  }

  rebalancePaycheckAssignments(assignments, startingBalance, {
    skippedBills,
    lockedBillKeys: lockedKeys,
    targetCashOnHand,
    minCashOnHand,
    cashOnHandByDate,
  });

  return assignments;
}
