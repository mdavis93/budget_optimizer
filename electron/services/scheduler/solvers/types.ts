import type { AssignmentModel } from '../model/assignmentModel';

export type SolverName = 'greedy' | 'highs';

export type FallbackReason =
  | 'size_guard'
  | 'load_rejected'
  | 'non_optimal'
  | 'limit_hit';

export interface AssignmentSolveResult {
  /** Paycheck index per bill, or `UNPAID_PLACEMENT`. */
  placement: Int32Array;
  workCount: number;
  solver: SolverName;
  optimal: boolean;
  fallbackReason?: FallbackReason;
  highsStatus?: string;
}

export interface AssignmentSolver {
  readonly name: SolverName;
  solve(model: AssignmentModel): AssignmentSolveResult;
}
