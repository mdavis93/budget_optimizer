import { createHash } from 'node:crypto';
import type {
  ScheduleComputeInputPayload,
  ScheduleComputeOp,
} from '@shared/scheduleComputeProtocol';
import { assertPayloadSize } from '@shared/scheduleComputeValidate';
import { scheduleComputeHashBody } from '@shared/scheduleIdentity';

export interface ScheduleComputeNativeInputs {
  incomes: unknown[];
  bills: unknown[];
  startDate: string;
  months: number;
  startingBalance: number;
  skippedBills: Set<string>;
  manualAssignments: Map<string, string>;
  preferredAssignments: Map<string, string>;
  targetCashOnHand: number;
  goals: unknown[];
  minCashOnHand: number;
  minSavingsPerPaycheck: number;
  debts: unknown[];
  accelerateDebtPayoff: boolean;
  incomeOverrides: Map<string, number>;
  leaves: unknown[];
  nowIso: string;
}

export function serializeScheduleComputeInput(
  native: ScheduleComputeNativeInputs
): ScheduleComputeInputPayload {
  const payload: ScheduleComputeInputPayload = {
    incomes: native.incomes,
    bills: native.bills,
    startDate: native.startDate,
    months: native.months,
    startingBalance: native.startingBalance,
    skippedBills: Array.from(native.skippedBills),
    manualAssignments: Array.from(native.manualAssignments.entries()),
    preferredAssignments: Array.from(native.preferredAssignments.entries()),
    targetCashOnHand: native.targetCashOnHand,
    goals: native.goals,
    minCashOnHand: native.minCashOnHand,
    minSavingsPerPaycheck: native.minSavingsPerPaycheck,
    debts: native.debts,
    accelerateDebtPayoff: native.accelerateDebtPayoff === true,
    incomeOverrides: Array.from(native.incomeOverrides.entries()),
    leaves: native.leaves,
    nowIso: native.nowIso,
  };
  assertPayloadSize(payload, 'schedule compute input');
  return payload;
}

export function deserializeScheduleComputeInput(
  payload: ScheduleComputeInputPayload
): ScheduleComputeNativeInputs {
  return {
    incomes: payload.incomes,
    bills: payload.bills,
    startDate: payload.startDate,
    months: payload.months,
    startingBalance: payload.startingBalance,
    skippedBills: new Set(payload.skippedBills),
    manualAssignments: new Map(payload.manualAssignments),
    preferredAssignments: new Map(payload.preferredAssignments ?? []),
    targetCashOnHand: payload.targetCashOnHand,
    goals: payload.goals,
    minCashOnHand: payload.minCashOnHand,
    minSavingsPerPaycheck: payload.minSavingsPerPaycheck,
    debts: payload.debts ?? [],
    accelerateDebtPayoff: payload.accelerateDebtPayoff === true,
    incomeOverrides: new Map(payload.incomeOverrides),
    leaves: payload.leaves,
    nowIso: payload.nowIso,
  };
}

/** Stable hash of op + inputs (excludes jobId, viewport months, and sub-day clock). */
export function computeScheduleInputHash(
  op: ScheduleComputeOp,
  input: ScheduleComputeInputPayload
): string {
  const canonical = JSON.stringify({ op, input: scheduleComputeHashBody(input) });
  return createHash('sha256').update(canonical).digest('hex');
}
