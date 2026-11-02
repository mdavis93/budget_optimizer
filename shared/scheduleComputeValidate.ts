import {
  SCHEDULE_COMPUTE_MAX_PAYLOAD_BYTES,
  SCHEDULE_COMPUTE_PROGRESS_MAX_BYTES,
  SCHEDULE_COMPUTE_PROTOCOL_VERSION,
  SCHEDULE_COMPUTE_STAGES,
  type ScheduleComputeOp,
  type ScheduleComputeProgressMessage,
  type ScheduleComputeStage,
  type ScheduleComputeSuccessMessage,
  type ScheduleComputeWorkerMessage,
} from './scheduleComputeProtocol';

const PROGRESS_KEYS = new Set([
  'type',
  'protocolVersion',
  'jobId',
  'inputHash',
  'op',
  'stage',
  'current',
  'total',
]);

const STAGE_SET = new Set<string>(SCHEDULE_COMPUTE_STAGES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Approximate serialized size for payload caps (structured-clone stand-in). */
export function estimatePayloadBytes(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  } catch {
    return SCHEDULE_COMPUTE_MAX_PAYLOAD_BYTES + 1;
  }
}

export function assertPayloadSize(value: unknown, label: string): void {
  const bytes = estimatePayloadBytes(value);
  if (bytes > SCHEDULE_COMPUTE_MAX_PAYLOAD_BYTES) {
    throw new Error(`${label} exceeds max payload size (${bytes} bytes)`);
  }
}

function assertScheduleSummary(summary: unknown): asserts summary is Record<string, unknown> {
  if (!isRecord(summary)) {
    throw new Error('schedule.summary must be an object');
  }
  for (const key of [
    'totalIncome',
    'totalExpenses',
    'netBalance',
    'shortfallCount',
  ] as const) {
    if (!isFiniteNumber(summary[key])) {
      throw new Error(`schedule.summary.${key} must be a finite number`);
    }
  }
}

function assertScheduleData(schedule: unknown): void {
  if (!isRecord(schedule)) {
    throw new Error('schedule must be an object');
  }
  if (typeof schedule.startDate !== 'string' || typeof schedule.endDate !== 'string') {
    throw new Error('schedule startDate/endDate must be strings');
  }
  if (!Array.isArray(schedule.paychecks) || !Array.isArray(schedule.fullPaychecks)) {
    throw new Error('schedule paychecks/fullPaychecks must be arrays');
  }
  if (!Array.isArray(schedule.entries) || !Array.isArray(schedule.recommendations)) {
    throw new Error('schedule entries/recommendations must be arrays');
  }
  if (!isFiniteNumber(schedule.viewportMonths)) {
    throw new Error('schedule.viewportMonths must be a finite number');
  }
  if (!isFiniteNumber(schedule.maxBudgetRemaining) || !isFiniteNumber(schedule.minCashOnHand)) {
    throw new Error('schedule cash-on-hand fields must be finite numbers');
  }
  if (schedule.presumedPaidCount !== undefined) {
    if (
      typeof schedule.presumedPaidCount !== 'number' ||
      !Number.isInteger(schedule.presumedPaidCount) ||
      schedule.presumedPaidCount < 0
    ) {
      throw new Error('schedule.presumedPaidCount must be a non-negative integer');
    }
  }
  assertScheduleSummary(schedule.summary);
}

/**
 * Structural allowlist validation for worker results.
 * Does not reject unknown nested keys (scheduler may add fields).
 */
export function assertScheduleComputeSuccessMessage(
  message: unknown,
  expected: { jobId: string; inputHash: string; op: ScheduleComputeOp }
): asserts message is ScheduleComputeSuccessMessage {
  assertPayloadSize(message, 'schedule compute result');

  if (!isRecord(message) || message.type !== 'result') {
    throw new Error('compute result must be a result message');
  }
  if (message.protocolVersion !== SCHEDULE_COMPUTE_PROTOCOL_VERSION) {
    throw new Error('unsupported compute protocol version');
  }
  if (message.jobId !== expected.jobId) {
    throw new Error('compute result jobId mismatch');
  }
  if (message.inputHash !== expected.inputHash) {
    throw new Error('compute result inputHash mismatch');
  }
  if (message.op !== expected.op) {
    throw new Error('compute result op mismatch');
  }

  assertScheduleData(message.schedule);
  assertComputeMeta(message.computeMeta);
}

const SOLVER_SET = new Set(['greedy', 'highs']);
const FALLBACK_SET = new Set(['size_guard', 'load_rejected', 'non_optimal', 'limit_hit']);

function assertComputeMeta(value: unknown): void {
  if (!isRecord(value)) {
    throw new Error('computeMeta must be an object');
  }
  if (typeof value.solver !== 'string' || !SOLVER_SET.has(value.solver)) {
    throw new Error('computeMeta.solver must be greedy or highs');
  }
  if (value.fallbackReason !== undefined) {
    if (typeof value.fallbackReason !== 'string' || !FALLBACK_SET.has(value.fallbackReason)) {
      throw new Error('computeMeta.fallbackReason is not a known reason');
    }
  }
  if (!isRecord(value.timings)) {
    throw new Error('computeMeta.timings must be an object');
  }
  for (const key of ['modelMs', 'solveMs', 'materializeMs'] as const) {
    if (!isFiniteNumber(value.timings[key]) || (value.timings[key] as number) < 0) {
      throw new Error(`computeMeta.timings.${key} must be a non-negative finite number`);
    }
  }
  if (
    typeof value.ignoredPins !== 'number' ||
    !Number.isInteger(value.ignoredPins) ||
    value.ignoredPins < 0
  ) {
    throw new Error('computeMeta.ignoredPins must be a non-negative integer');
  }
}

export function isWorkerMessage(value: unknown): value is ScheduleComputeWorkerMessage {
  return isRecord(value) && typeof value.type === 'string';
}

/**
 * Best-effort progress parse. Returns null on any mismatch — callers must not
 * fail the compute job for a bad progress packet.
 */
export function readScheduleComputeProgressMessage(
  value: unknown,
  expected: { jobId: string; inputHash: string; op: ScheduleComputeOp }
): ScheduleComputeProgressMessage | null {
  if (!isRecord(value) || value.type !== 'progress') {
    return null;
  }
  if (estimatePayloadBytes(value) > SCHEDULE_COMPUTE_PROGRESS_MAX_BYTES) {
    return null;
  }
  for (const key of Object.keys(value)) {
    if (!PROGRESS_KEYS.has(key)) {
      return null;
    }
  }
  if (value.protocolVersion !== SCHEDULE_COMPUTE_PROTOCOL_VERSION) {
    return null;
  }
  if (value.jobId !== expected.jobId || value.inputHash !== expected.inputHash || value.op !== expected.op) {
    return null;
  }
  if (typeof value.stage !== 'string' || !STAGE_SET.has(value.stage)) {
    return null;
  }
  if (value.current !== undefined && !(isFiniteNumber(value.current) && value.current >= 0)) {
    return null;
  }
  if (value.total !== undefined && !(isFiniteNumber(value.total) && value.total >= 0)) {
    return null;
  }

  return {
    type: 'progress',
    protocolVersion: SCHEDULE_COMPUTE_PROTOCOL_VERSION,
    jobId: expected.jobId,
    inputHash: expected.inputHash,
    op: expected.op,
    stage: value.stage as ScheduleComputeStage,
    ...(value.current !== undefined ? { current: value.current } : {}),
    ...(value.total !== undefined ? { total: value.total } : {}),
  };
}
