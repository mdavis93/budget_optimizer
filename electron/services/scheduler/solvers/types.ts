import type { AssignmentModel } from '../model/assignmentModel';

export type SolverName = 'greedy';

export type FallbackReason = 'limit_hit';

export interface AssignmentSolveResult {
  /** Paycheck index per bill, or `UNPAID_PLACEMENT`. */
  placement: Int32Array;
  workCount: number;
  solver: SolverName;
  /** True when the greedy run finished under the work cap. */
  withinWorkCap: boolean;
  fallbackReason?: FallbackReason;
}

export interface AssignmentSolver {
  readonly name: SolverName;
  solve(model: AssignmentModel): AssignmentSolveResult;
}
