import { isOperatingIncome } from '@shared/incomePurpose';
import { Bill } from '../database.service';
import { partitionPresumedPaidBills } from './lookahead';
import { type CashOnHandByDate } from './cashOnHandOverrides';
import { buildAssignmentModel } from './model/assignmentModel';
import { UNPAID_PLACEMENT } from './model/objective';
import { materializeAssignments } from './materialize';
import { GreedySolver } from './solvers/greedySolver';
import type { AssignmentSolver, AssignmentSolveResult } from './solvers/types';
import {
  DEFAULT_MIN_CASH_ON_HAND,
  DEFAULT_TARGET_CASH_ON_HAND,
  PaycheckAssignment,
  ProjectedBill,
  ProjectedIncome,
} from './types';

export interface AssignmentComputeMeta {
  solver: AssignmentSolveResult['solver'];
  fallbackReason?: AssignmentSolveResult['fallbackReason'];
  timings: {
    modelMs: number;
    solveMs: number;
    materializeMs: number;
  };
  ignoredPins: number;
}

export interface AssignBillsOptions {
  startingBalanceCents?: number;
  skippedBills?: Set<string>;
  /** Hard locks (user drag). Fixed for the run and pinned in T0. */
  manualAssignments?: Map<string, string>;
  /**
   * Soft seeds (Advisor / reconciliation Accept). Fixed for the run;
   * score in the bill's real priority tier.
   */
  preferredAssignments?: Map<string, string>;
  incomeAttachedBillsRaw?: Bill[];
  lockedBillKeys?: Set<string>;
  targetCashOnHand?: number;
  minCashOnHand?: number;
  cashOnHandByDate?: CashOnHandByDate;
  startDate?: Date;
  solver?: AssignmentSolver;
  onComputeMeta?: (meta: AssignmentComputeMeta) => void;
}

/**
 * Assign bills to paychecks. Builds the integer model, runs the chosen solver
 * (library default: greedy), then materializes paycheck assignments.
 */
export function assignBills(
  paycheckDates: Date[],
  allIncomes: ProjectedIncome[],
  allBills: ProjectedBill[],
  startingBalance: number,
  options: AssignBillsOptions = {}
): PaycheckAssignment[] {
  const skippedBills = options.skippedBills ?? new Set();
  const manualAssignments = options.manualAssignments ?? new Map();
  const preferredAssignments = options.preferredAssignments ?? new Map();
  const incomeAttachedBillsRaw = options.incomeAttachedBillsRaw ?? [];
  const minCashOnHand = options.minCashOnHand ?? DEFAULT_MIN_CASH_ON_HAND;
  const targetCashOnHand = options.targetCashOnHand ?? DEFAULT_TARGET_CASH_ON_HAND;
  const solver = options.solver ?? new GreedySolver();

  const operating = allIncomes.filter((income) => isOperatingIncome(income));
  const { payableBills } = partitionPresumedPaidBills(
    allBills,
    operating,
    options.startDate
  );

  const modelStarted = performance.now();
  const model = buildAssignmentModel({
    paycheckDates,
    incomes: operating,
    bills: payableBills,
    startingBalance,
    minCashOnHand,
    targetCashOnHand,
    cashOnHandByDate: options.cashOnHandByDate,
    skippedBills,
    manualAssignments,
    preferredAssignments,
    incomeAttachedBillsRaw,
  });
  const modelMs = performance.now() - modelStarted;

  const solveStarted = performance.now();
  const solved = solver.solve(model);
  const solveMs = performance.now() - solveStarted;

  const materializeStarted = performance.now();
  const assignments = materializeAssignments(
    model,
    solved.placement,
    paycheckDates,
    operating,
    payableBills,
    incomeAttachedBillsRaw
  );
  const materializeMs = performance.now() - materializeStarted;

  let ignoredPins = 0;
  for (let billIndex = 0; billIndex < model.billCount; billIndex++) {
    if (model.isPinned[billIndex] === 1 && solved.placement[billIndex] === UNPAID_PLACEMENT) {
      ignoredPins += 1;
    }
  }

  options.onComputeMeta?.({
    solver: solved.solver,
    fallbackReason: solved.fallbackReason,
    timings: { modelMs, solveMs, materializeMs },
    ignoredPins,
  });

  return assignments;
}
