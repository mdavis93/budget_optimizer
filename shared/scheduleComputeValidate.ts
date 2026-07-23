import {
  SCHEDULE_COMPUTE_MAX_PAYLOAD_BYTES,
  SCHEDULE_COMPUTE_PROTOCOL_VERSION,
  type ScheduleComputeOp,
  type ScheduleComputeSuccessMessage,
  type ScheduleComputeWorkerMessage,
} from './scheduleComputeProtocol';

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
