import { format } from 'date-fns';
import { MAX_MONEY } from '../../validation.service';
import { dayNumberOfDate } from '@shared/billEligibility';
import { isOperatingIncome } from '@shared/incomePurpose';
import type { Bill } from '../../database.service';
import { toCents } from '../money';
import { createEligibilityLookup } from '../eligibility';
import {
  cashMinForDate,
  cashTargetForDate,
  type CashOnHandByDate,
} from '../cashOnHandOverrides';
import {
  DEFAULT_MIN_CASH_ON_HAND,
  DEFAULT_TARGET_CASH_ON_HAND,
  billOccurrenceKey,
  billOccurrenceKeyFromIso,
  type PaycheckAssignment,
  type ProjectedBill,
  type ProjectedIncome,
} from '../types';
import type { PreparedScheduleHorizon } from '../scheduleBuild';
import { priorityFromTier, priorityTier as tierForPriority } from '@shared/billPriority';
import {
  UNPAID_PLACEMENT,
  type BillPriority,
  type ObjectiveBill,
  type ObjectiveInput,
  type ObjectivePaycheck,
} from './objective';

export type AssignmentModelErrorCode = 'non_finite' | 'out_of_range';

export class AssignmentModelError extends Error {
  readonly code: AssignmentModelErrorCode;

  constructor(code: AssignmentModelErrorCode, message: string) {
    super(message);
    this.name = 'AssignmentModelError';
    this.code = code;
  }
}

const MAX_MONEY_CENTS = MAX_MONEY * 100;

export interface AssignmentModel {
  billCount: number;
  paycheckCount: number;
  variableCount: number;
  amountCents: Int32Array;
  dueDay: Int32Array;
  priorityTier: Int32Array;
  isPinned: Int32Array;
  fixedPaycheck: Int32Array;
  incomeCents: Int32Array;
  minCashCents: Int32Array;
  targetCashCents: Int32Array;
  paycheckDay: Int32Array;
  countsTowardCashFloors: Int32Array;
  eligibilityOffsets: Int32Array;
  eligibilityIndices: Int32Array;
  billIds: readonly string[];
  billDueIso: readonly string[];
  creditorNames: readonly string[];
  paycheckIso: readonly string[];
  /**
   * Set only by the Break-Glass relaxed re-solve. Production assignment omits it.
   * Greedy then starts from this placement and breaks T7 ties by early-move count,
   * then move count, then dollar-days.
   */
  advisorBaseline?: {
    placement: Int32Array;
    earlyDayCutoff: number;
  };
}

export interface AssignmentModelInput {
  paycheckDates: Date[];
  incomes: ProjectedIncome[];
  bills: ProjectedBill[];
  startingBalance: number;
  minCashOnHand?: number;
  targetCashOnHand?: number;
  cashOnHandByDate?: CashOnHandByDate;
  skippedBills?: Set<string>;
  manualAssignments?: Map<string, string>;
  preferredAssignments?: Map<string, string>;
  incomeAttachedBillsRaw?: Bill[];
  /** When set, eligibility is every usable paycheck in `[due - maxEarlyDays, due]`. */
  maxEarlyDays?: number;
  /** Inclusive start day number; paychecks before this are ineligible. */
  startDay?: number;
}

function assertMoney(value: number, label: string, allowNegative: boolean): void {
  if (!Number.isFinite(value)) {
    throw new AssignmentModelError('non_finite', `${label} must be a finite number`);
  }
  if (Math.abs(value) > MAX_MONEY) {
    throw new AssignmentModelError('out_of_range', `${label} exceeds MAX_MONEY`);
  }
  if (!allowNegative && value < 0) {
    throw new AssignmentModelError('out_of_range', `${label} cannot be negative`);
  }
}

function assertCents(cents: number, label: string): void {
  if (!Number.isInteger(cents) || Math.abs(cents) > MAX_MONEY_CENTS) {
    throw new AssignmentModelError('out_of_range', `${label} cents exceed the Int32 budget`);
  }
}

function isoOf(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

function buildPaycheckSkeleton(
  paycheckDates: Date[],
  incomes: ProjectedIncome[]
): PaycheckAssignment[] {
  return paycheckDates.map((paycheckDate) => {
    const onDate = incomes.filter(
      (income) => income.date.getTime() === paycheckDate.getTime()
    );
    return {
      date: paycheckDate,
      incomes: onDate,
      bills: [],
      unusable: onDate.length > 0 && onDate.every((income) => income.unusable),
    };
  });
}

interface ModelBill {
  billId: string;
  dueIso: string;
  creditorName: string;
  amountCents: number;
  dueDay: number;
  priority: BillPriority;
  isPinned: boolean;
  fixedPaycheck: number;
  candidates: number[];
}

function pushAttachedBills(
  assignments: PaycheckAssignment[],
  incomeAttachedBillsRaw: Bill[],
  skippedBills: Set<string>,
  bills: ModelBill[]
): void {
  for (const bill of incomeAttachedBillsRaw) {
    assertMoney(bill.budgetedAmount, `attached bill ${bill.id} amount`, false);
    const amountCents = toCents(bill.budgetedAmount);
    assertCents(amountCents, `attached bill ${bill.id}`);
    for (let paycheckIndex = 0; paycheckIndex < assignments.length; paycheckIndex++) {
      const paycheck = assignments[paycheckIndex];
      const hasMatchingIncome = paycheck.incomes.some(
        (income) => income.sourceId === bill.preferredIncomeSourceId
      );
      if (!hasMatchingIncome) continue;
      const paycheckIso = isoOf(paycheck.date);
      if (skippedBills.has(billOccurrenceKeyFromIso(bill.id, paycheckIso))) continue;
      bills.push({
        billId: bill.id,
        dueIso: paycheckIso,
        creditorName: bill.creditorName,
        amountCents,
        dueDay: dayNumberOfDate(paycheck.date),
        priority: bill.priority,
        isPinned: true,
        fixedPaycheck: paycheckIndex,
        candidates: [paycheckIndex],
      });
    }
  }
}

function resolveFixedPaycheck(
  assignmentKey: string,
  paycheckIso: readonly string[],
  manualAssignments: Map<string, string>,
  preferredAssignments: Map<string, string>
): { index: number; pinned: boolean } | null {
  const lockedDate = manualAssignments.get(assignmentKey);
  if (lockedDate !== undefined) {
    const index = paycheckIso.indexOf(lockedDate);
    return index === -1 ? null : { index, pinned: true };
  }
  const preferredDate = preferredAssignments.get(assignmentKey);
  if (preferredDate !== undefined) {
    const index = paycheckIso.indexOf(preferredDate);
    return index === -1 ? null : { index, pinned: false };
  }
  return null;
}

/**
 * Integer-cent assignment MIP. Eligibility is CSR (`eligibilityOffsets` /
 * `eligibilityIndices`). User strings stay off the LP and are only kept for
 * materialize.
 */
export function buildAssignmentModel(input: AssignmentModelInput): AssignmentModel {
  assertMoney(input.startingBalance, 'startingBalance', true);
  const minCashOnHand = input.minCashOnHand ?? DEFAULT_MIN_CASH_ON_HAND;
  const targetCashOnHand = input.targetCashOnHand ?? DEFAULT_TARGET_CASH_ON_HAND;
  assertMoney(minCashOnHand, 'minCashOnHand', false);
  assertMoney(targetCashOnHand, 'targetCashOnHand', false);

  const skippedBills = input.skippedBills ?? new Set<string>();
  const manualAssignments = input.manualAssignments ?? new Map<string, string>();
  const preferredAssignments = input.preferredAssignments ?? new Map<string, string>();
  const incomeAttachedBillsRaw = input.incomeAttachedBillsRaw ?? [];

  const operatingIncomes = input.incomes.filter((income) => isOperatingIncome(income));
  const assignments = buildPaycheckSkeleton(input.paycheckDates, operatingIncomes);
  const paycheckIso = assignments.map((assignment) => isoOf(assignment.date));
  const paycheckCount = assignments.length;
  const firstRealIndex = assignments.findIndex((assignment) => !assignment.unusable);
  const startingBalanceCents = toCents(input.startingBalance);
  assertCents(startingBalanceCents, 'startingBalance');

  const incomeCents = new Int32Array(paycheckCount);
  const minCashCents = new Int32Array(paycheckCount);
  const targetCashCents = new Int32Array(paycheckCount);
  const paycheckDay = new Int32Array(paycheckCount);
  const countsTowardCashFloors = new Int32Array(paycheckCount);

  for (let index = 0; index < paycheckCount; index++) {
    const assignment = assignments[index];
    let incomeTotal = 0;
    for (const income of assignment.incomes) {
      assertMoney(income.amount, `income ${income.sourceId} amount`, false);
      incomeTotal += toCents(income.amount);
    }
    if (index === firstRealIndex) {
      incomeTotal += startingBalanceCents;
    }
    assertCents(incomeTotal, `paycheck ${paycheckIso[index]} income`);
    const minDollars = cashMinForDate(input.cashOnHandByDate, paycheckIso[index], minCashOnHand);
    const targetDollars = cashTargetForDate(
      input.cashOnHandByDate,
      paycheckIso[index],
      targetCashOnHand
    );
    assertMoney(minDollars, `min cash ${paycheckIso[index]}`, false);
    assertMoney(targetDollars, `target cash ${paycheckIso[index]}`, false);
    incomeCents[index] = incomeTotal;
    minCashCents[index] = toCents(minDollars);
    targetCashCents[index] = toCents(targetDollars);
    paycheckDay[index] = dayNumberOfDate(assignment.date);
    countsTowardCashFloors[index] = assignment.unusable ? 0 : 1;
  }

  const modelBills: ModelBill[] = [];
  pushAttachedBills(assignments, incomeAttachedBillsRaw, skippedBills, modelBills);

  const placedKeys = new Set(
    modelBills.map((bill) => billOccurrenceKeyFromIso(bill.billId, bill.dueIso))
  );
  const eligibility = createEligibilityLookup(assignments, skippedBills);

  for (const bill of input.bills) {
    assertMoney(bill.amount, `bill ${bill.billId} amount`, false);
    const amountCents = toCents(bill.amount);
    assertCents(amountCents, `bill ${bill.billId}`);
    const dueIso = isoOf(bill.date);
    const occurrence = billOccurrenceKey(bill.billId, bill.date);
    if (placedKeys.has(occurrence) || skippedBills.has(billOccurrenceKeyFromIso(bill.billId, dueIso))) {
      continue;
    }
    const assignmentKey = billOccurrenceKeyFromIso(bill.billId, dueIso);
    const fixed = resolveFixedPaycheck(
      assignmentKey,
      paycheckIso,
      manualAssignments,
      preferredAssignments
    );
    let candidates: number[];
    let fixedPaycheck = -1;
    let isPinned = false;
    if (fixed) {
      fixedPaycheck = fixed.index;
      isPinned = fixed.pinned;
      candidates = [fixed.index];
    } else if (input.maxEarlyDays !== undefined) {
      candidates = [];
      const due = dayNumberOfDate(bill.date);
      for (let paycheckIndex = 0; paycheckIndex < paycheckCount; paycheckIndex++) {
        const daysEarly = due - paycheckDay[paycheckIndex];
        if (daysEarly < 0 || daysEarly > input.maxEarlyDays) continue;
        if (input.startDay !== undefined && paycheckDay[paycheckIndex] < input.startDay) {
          continue;
        }
        if (countsTowardCashFloors[paycheckIndex] !== 1) continue;
        candidates.push(paycheckIndex);
      }
    } else {
      candidates = [...eligibility(bill)];
    }
    modelBills.push({
      billId: bill.billId,
      dueIso,
      creditorName: bill.creditorName,
      amountCents,
      dueDay: dayNumberOfDate(bill.date),
      priority: bill.priority,
      isPinned,
      fixedPaycheck,
      candidates,
    });
  }

  modelBills.sort((left, right) => {
    const keyLeft = billOccurrenceKeyFromIso(left.billId, left.dueIso);
    const keyRight = billOccurrenceKeyFromIso(right.billId, right.dueIso);
    return keyLeft < keyRight ? -1 : keyLeft > keyRight ? 1 : 0;
  });

  const billCount = modelBills.length;
  const amountCents = new Int32Array(billCount);
  const dueDay = new Int32Array(billCount);
  const priorityTier = new Int32Array(billCount);
  const isPinned = new Int32Array(billCount);
  const fixedPaycheck = new Int32Array(billCount);
  const eligibilityOffsets = new Int32Array(billCount + 1);
  const eligibilityBag: number[] = [];
  const billIds: string[] = [];
  const billDueIso: string[] = [];
  const creditorNames: string[] = [];

  for (let billIndex = 0; billIndex < billCount; billIndex++) {
    const bill = modelBills[billIndex];
    amountCents[billIndex] = bill.amountCents;
    dueDay[billIndex] = bill.dueDay;
    priorityTier[billIndex] = tierForPriority(bill.priority);
    isPinned[billIndex] = bill.isPinned ? 1 : 0;
    fixedPaycheck[billIndex] = bill.fixedPaycheck;
    eligibilityOffsets[billIndex] = eligibilityBag.length;
    for (const paycheckIndex of bill.candidates) {
      if (
        !Number.isInteger(paycheckIndex) ||
        paycheckIndex < 0 ||
        paycheckIndex >= paycheckCount
      ) {
        throw new AssignmentModelError(
          'out_of_range',
          `eligibility index ${paycheckIndex} is outside the paycheck list`
        );
      }
      eligibilityBag.push(paycheckIndex);
    }
    billIds.push(bill.billId);
    billDueIso.push(bill.dueIso);
    creditorNames.push(bill.creditorName);
  }
  eligibilityOffsets[billCount] = eligibilityBag.length;

  return {
    billCount,
    paycheckCount,
    variableCount: eligibilityBag.length,
    amountCents,
    dueDay,
    priorityTier,
    isPinned,
    fixedPaycheck,
    incomeCents,
    minCashCents,
    targetCashCents,
    paycheckDay,
    countsTowardCashFloors,
    eligibilityOffsets,
    eligibilityIndices: Int32Array.from(eligibilityBag),
    billIds,
    billDueIso,
    creditorNames,
    paycheckIso,
  };
}

export function buildAssignmentModelFromPrepared(
  prepared: PreparedScheduleHorizon,
  preferredAssignments: Map<string, string> = new Map()
): AssignmentModel {
  return buildAssignmentModel({
    paycheckDates: prepared.paycheckDates,
    incomes: prepared.operatingIncomes,
    bills: prepared.uniqueBills,
    startingBalance: prepared.startingBalance,
    minCashOnHand: prepared.minCashOnHand,
    targetCashOnHand: prepared.maxBudgetRemaining,
    cashOnHandByDate: prepared.cashOnHandByDate,
    skippedBills: prepared.skippedBills,
    manualAssignments: prepared.effectiveManualAssignments,
    preferredAssignments,
    incomeAttachedBillsRaw: prepared.incomeAttachedBillsRaw,
  });
}

export function remainingCentsForPlacement(
  model: AssignmentModel,
  placement: ArrayLike<number>
): Int32Array {
  const remaining = Int32Array.from(model.incomeCents);
  for (let billIndex = 0; billIndex < model.billCount; billIndex++) {
    const paycheckIndex = placement[billIndex];
    if (paycheckIndex === UNPAID_PLACEMENT) continue;
    remaining[paycheckIndex] -= model.amountCents[billIndex];
  }
  return remaining;
}

export function modelToObjectiveInput(
  model: AssignmentModel,
  placement: ArrayLike<number>
): ObjectiveInput {
  const remaining = remainingCentsForPlacement(model, placement);
  const bills: ObjectiveBill[] = [];
  const paychecks: ObjectivePaycheck[] = [];
  for (let billIndex = 0; billIndex < model.billCount; billIndex++) {
    const tier = model.priorityTier[billIndex];
    const priority: BillPriority = priorityFromTier(tier);
    bills.push({
      amountCents: model.amountCents[billIndex],
      priority,
      dueDay: model.dueDay[billIndex],
      isPinned: model.isPinned[billIndex] === 1,
    });
  }
  for (let paycheckIndex = 0; paycheckIndex < model.paycheckCount; paycheckIndex++) {
    paychecks.push({
      day: model.paycheckDay[paycheckIndex],
      remainingCents: remaining[paycheckIndex],
      minCashCents: model.minCashCents[paycheckIndex],
      targetCashCents: model.targetCashCents[paycheckIndex],
      countsTowardCashFloors: model.countsTowardCashFloors[paycheckIndex] === 1,
    });
  }
  return {
    bills,
    paychecks,
    placement: Array.from(placement),
  };
}

export function candidatesForBill(model: AssignmentModel, billIndex: number): number[] {
  const start = model.eligibilityOffsets[billIndex];
  const end = model.eligibilityOffsets[billIndex + 1];
  const candidates: number[] = [];
  for (let cursor = start; cursor < end; cursor++) {
    candidates.push(model.eligibilityIndices[cursor]);
  }
  return candidates;
}
