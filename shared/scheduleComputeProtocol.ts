/**
 * Cross-process protocol for schedule / goal compute in a utilityProcess.
 * Main owns DB I/O; the worker only receives plain payloads and returns ephemeral results.
 */

export const SCHEDULE_COMPUTE_PROTOCOL_VERSION = 1 as const;

export const SCHEDULE_COMPUTE_SERVICE_NAME = 'budget-optimizer-schedule';

/** Hard wall-clock timeout for a single compute job. */
export const SCHEDULE_COMPUTE_TIMEOUT_MS = 60_000;

/** After utilityProcess.kill() (SIGTERM), escalate to SIGKILL. */
export const SCHEDULE_COMPUTE_KILL_ESCALATION_MS = 2_000;

/** Reject oversized request/response payloads (approx serialized size). */
export const SCHEDULE_COMPUTE_MAX_PAYLOAD_BYTES = 32 * 1024 * 1024;

export type ScheduleComputeOp = 'schedule' | 'goals';

export type ScheduleComputeErrorCode =
  | 'timeout'
  | 'crashed'
  | 'invalid_result'
  | 'superseded'
  | 'worker_error'
  | 'worker_unavailable'
  | 'disposed';

export interface SerializedDebtPayoff {
  billId: string;
  payoffDate: string;
  finalPaymentAmount: number;
}

/** JSON-safe compute inputs (Maps/Sets/Dates flattened). */
export interface ScheduleComputeInputPayload {
  incomes: unknown[];
  bills: unknown[];
  startDate: string;
  months: number;
  startingBalance: number;
  skippedBills: string[];
  manualAssignments: Array<[string, string]>;
  targetCashOnHand: number;
  goals: unknown[];
  minCashOnHand: number;
  minSavingsPerPaycheck: number;
  debtPayoffs: SerializedDebtPayoff[];
  incomeOverrides: Array<[string, number]>;
  leaves: unknown[];
  /** ISO timestamp for deterministic beyond-horizon goal projection. */
  nowIso: string;
}

export interface ScheduleComputeRequest {
  protocolVersion: typeof SCHEDULE_COMPUTE_PROTOCOL_VERSION;
  jobId: string;
  /** Stable hash of op + inputs (excludes jobId); used for coalesce / stale checks. */
  inputHash: string;
  op: ScheduleComputeOp;
  input: ScheduleComputeInputPayload;
}

export interface ScheduleComputeScheduleSuccess {
  type: 'result';
  protocolVersion: typeof SCHEDULE_COMPUTE_PROTOCOL_VERSION;
  jobId: string;
  inputHash: string;
  op: 'schedule';
  schedule: unknown;
}

export interface ScheduleComputeGoalsSuccess {
  type: 'result';
  protocolVersion: typeof SCHEDULE_COMPUTE_PROTOCOL_VERSION;
  jobId: string;
  inputHash: string;
  op: 'goals';
  goalProjections: unknown;
}

export type ScheduleComputeSuccessMessage =
  | ScheduleComputeScheduleSuccess
  | ScheduleComputeGoalsSuccess;

export interface ScheduleComputeWorkerErrorMessage {
  type: 'error';
  protocolVersion: typeof SCHEDULE_COMPUTE_PROTOCOL_VERSION;
  jobId: string;
  inputHash: string;
  error: string;
}

export type ScheduleComputeWorkerMessage =
  | ScheduleComputeSuccessMessage
  | ScheduleComputeWorkerErrorMessage
  | { type: 'pong'; jobId: string }
  | { type: 'ping'; jobId: string };

export class ScheduleComputeError extends Error {
  readonly code: ScheduleComputeErrorCode;

  constructor(code: ScheduleComputeErrorCode, message: string) {
    super(message);
    this.name = 'ScheduleComputeError';
    this.code = code;
  }
}

export function isScheduleComputeError(error: unknown): error is ScheduleComputeError {
  return error instanceof ScheduleComputeError;
}
