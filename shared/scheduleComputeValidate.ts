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
  assertScheduleSummary(schedule.summary);
}

function assertGoalProjections(value: unknown): void {
  if (!Array.isArray(value)) {
    throw new Error('goalProjections must be an array');
  }
  for (const item of value) {
    if (!isRecord(item)) {
      throw new Error('goalProjection entries must be objects');
    }
    if (typeof item.goalId !== 'string' || typeof item.goalName !== 'string') {
      throw new Error('goalProjection requires goalId and goalName strings');
    }
    if (!isFiniteNumber(item.targetAmount) || !isFiniteNumber(item.alreadySaved)) {
      throw new Error('goalProjection amounts must be finite numbers');
    }
  }
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

  if (expected.op === 'schedule') {
    assertScheduleData(message.schedule);
  } else {
    assertGoalProjections(message.goalProjections);
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
