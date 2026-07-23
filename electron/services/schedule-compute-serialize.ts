import { createHash } from 'node:crypto';
import type { DebtPayoffInfo } from './scheduler/types';
import type {
  ScheduleComputeInputPayload,
  ScheduleComputeOp,
  SerializedDebtPayoff,
} from '@shared/scheduleComputeProtocol';
import { assertPayloadSize } from '@shared/scheduleComputeValidate';

export interface ScheduleComputeNativeInputs {
  incomes: unknown[];
  bills: unknown[];
  startDate: string;
  months: number;
  startingBalance: number;
  skippedBills: Set<string>;
  manualAssignments: Map<string, string>;
  targetCashOnHand: number;
  goals: unknown[];
  minCashOnHand: number;
  minSavingsPerPaycheck: number;
  debtPayoffs: Map<string, DebtPayoffInfo>;
  incomeOverrides: Map<string, number>;
  leaves: unknown[];
  nowIso: string;
}

export function serializeDebtPayoffs(
  debtPayoffs: Map<string, DebtPayoffInfo>
): SerializedDebtPayoff[] {
  return Array.from(debtPayoffs.values()).map((info) => ({
    billId: info.billId,
    payoffDate:
      info.payoffDate instanceof Date
        ? info.payoffDate.toISOString()
        : String(info.payoffDate),
    finalPaymentAmount: info.finalPaymentAmount,
  }));
}

export function deserializeDebtPayoffs(
  items: SerializedDebtPayoff[]
): Map<string, DebtPayoffInfo> {
  const map = new Map<string, DebtPayoffInfo>();
  for (const item of items) {
    map.set(item.billId, {
      billId: item.billId,
      payoffDate: new Date(item.payoffDate),
      finalPaymentAmount: item.finalPaymentAmount,
    });
  }
  return map;
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
    targetCashOnHand: native.targetCashOnHand,
    goals: native.goals,
    minCashOnHand: native.minCashOnHand,
    minSavingsPerPaycheck: native.minSavingsPerPaycheck,
    debtPayoffs: serializeDebtPayoffs(native.debtPayoffs),
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
    targetCashOnHand: payload.targetCashOnHand,
    goals: payload.goals,
    minCashOnHand: payload.minCashOnHand,
    minSavingsPerPaycheck: payload.minSavingsPerPaycheck,
    debtPayoffs: deserializeDebtPayoffs(payload.debtPayoffs),
    incomeOverrides: new Map(payload.incomeOverrides),
    leaves: payload.leaves,
    nowIso: payload.nowIso,
  };
}

/** Stable hash of op + inputs (excludes jobId). */
export function computeScheduleInputHash(
  op: ScheduleComputeOp,
  input: ScheduleComputeInputPayload
): string {
  const canonical = JSON.stringify({ op, input });
  return createHash('sha256').update(canonical).digest('hex');
}
