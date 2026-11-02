import { format, parseISO } from 'date-fns';
import {
  dayNumberOfIsoDate,
  eligiblePaycheckIndices,
  isFundingPaycheckUsable,
} from '@shared/billEligibility';
import type {
  BreakGlassAdvisorReport,
  BreakGlassPlan,
  BreakGlassPlanStep,
  PaycheckBill,
  PaycheckEntry,
  ScheduleData,
} from './types';
import {
  DEFAULT_MIN_CASH_ON_HAND,
  DEFAULT_TARGET_CASH_ON_HAND,
  MAX_ADVISOR_EARLY_DAYS,
  MAX_PREPAY_DAYS,
} from './types';
import type { AssignmentModel } from './model/assignmentModel';
import { remainingCentsForPlacement } from './model/assignmentModel';
import { UNPAID_PLACEMENT } from './model/objective';
import { toCents } from './money';
import { GreedySolver } from './solvers/greedySolver';
import type { AssignmentSolver } from './solvers/types';

const MAX_ADVISOR_PLANS = 5;
const MAX_ADVISOR_PLAN_STEPS = 12;

const PRIORITY_TIER: Record<PaycheckBill['priority'], 1 | 2 | 3 | 4> = {
  critical: 1,
  high: 2,
  normal: 3,
  low: 4,
};

export interface ProposeBreakGlassOptions {
  scheduleStartDate?: string;
  maxEarlyDays?: number;
  targetCashOnHand?: number;
  minCashOnHand?: number;
  /** Manual-locked occurrence keys (`billId-yyyy-MM-dd`); treated as fixed sources. */
  lockedBillKeys?: Set<string>;
  /** Called once per original Break-Glass target considered (1-based). */
  onTarget?: (current: number, total: number) => void;
  /** Same solver the baseline assignment used. Defaults to greedy. */
  solver?: AssignmentSolver;
}

interface SimPaycheck {
  date: string;
  budgetRemaining: number;
  bills: PaycheckBill[];
  targetCashOnHand: number;
  minCashOnHand: number;
  purpose?: string;
  incomeSourceIds: string[];
}

interface RelaxedBill {
  bill: PaycheckBill;
  fromIndex: number;
  amountCents: number;
  dueDay: number;
  candidates: number[];
  fixedPaycheck: number;
  isPinned: boolean;
}

interface RelaxedMove {
  billIndex: number;
  fromIndex: number;
  toIndex: number;
}

function occurrenceKey(billId: string, billDate: string): string {
  return `${billId}-${billDate}`;
}

function isBreakGlassRemaining(
  budgetRemaining: number,
  targetCashOnHand: number,
  minCashOnHand: number
): boolean {
  return budgetRemaining < targetCashOnHand && budgetRemaining >= minCashOnHand;
}

function horizonPaychecks(schedule: ScheduleData): PaycheckEntry[] {
  return schedule.fullPaychecks?.length ? schedule.fullPaychecks : schedule.paychecks;
}

function cloneSim(
  paychecks: PaycheckEntry[],
  budgetTarget: number,
  budgetMin: number
): SimPaycheck[] {
  return paychecks.map((paycheck) => ({
    date: paycheck.date,
    budgetRemaining: paycheck.budgetRemaining,
    bills: paycheck.bills.map((bill: PaycheckBill) => ({ ...bill })),
    targetCashOnHand: paycheck.targetCashOnHand ?? budgetTarget,
    minCashOnHand: paycheck.minCashOnHand ?? budgetMin,
    purpose: paycheck.purpose,
    incomeSourceIds: paycheck.incomeSources.map((source) => source.id),
  }));
}

function listBreakGlassDates(
  sim: SimPaycheck[]
): Array<{ date: string; budgetRemaining: number }> {
  return sim
    .filter((paycheck) =>
      isBreakGlassRemaining(
        paycheck.budgetRemaining,
        paycheck.targetCashOnHand,
        paycheck.minCashOnHand
      )
    )
    .map((paycheck) => ({
      date: paycheck.date,
      budgetRemaining: paycheck.budgetRemaining,
    }));
}

/** Dates currently in the Break-Glass band on the assigned schedule (no search). */
export function listBreakGlassPaycheckDates(
  schedule: ScheduleData,
  options: ProposeBreakGlassOptions = {}
): string[] {
  const paychecks = horizonPaychecks(schedule);
  if (!paychecks.length) return [];
  const targetCashOnHand =
    options.targetCashOnHand ?? schedule.maxBudgetRemaining ?? DEFAULT_TARGET_CASH_ON_HAND;
  const minCashOnHand =
    options.minCashOnHand ?? schedule.minCashOnHand ?? DEFAULT_MIN_CASH_ON_HAND;
  return listBreakGlassDates(cloneSim(paychecks, targetCashOnHand, minCashOnHand)).map(
    (paycheck) => paycheck.date
  );
}

function finiteCents(amount: number): number | null {
  if (!Number.isFinite(amount)) return null;
  const cents = toCents(amount);
  if (!Number.isSafeInteger(cents)) return null;
  return cents;
}

/** Operating paychecks a confirmation check may treat as auto-legal. */
function confirmationPaychecks(sim: SimPaycheck[]): SimPaycheck[] {
  return sim.filter((paycheck) => paycheck.purpose !== 'savingsAndGoals');
}

/** True when the landing is outside the shared 20-day window and 31-day fallback. */
function moveRequiresConfirmation(
  bill: PaycheckBill,
  toPaycheckDate: string,
  operating: readonly SimPaycheck[]
): boolean {
  const dueDay = dayNumberOfIsoDate(bill.billDate);
  const paycheckDays = operating.map((paycheck) => dayNumberOfIsoDate(paycheck.date));
  const eligibleDays = new Set(
    eligiblePaycheckIndices(dueDay, paycheckDays, (index) =>
      isFundingPaycheckUsable(
        {
          purpose: operating[index].purpose,
          incomeSourceIds: operating[index].incomeSourceIds,
        },
        bill.preferredIncomeSourceId
      )
    ).map((index) => paycheckDays[index])
  );
  return !eligibleDays.has(dayNumberOfIsoDate(toPaycheckDate));
}

function makeStep(
  bill: PaycheckBill,
  fromPaycheckDate: string,
  toPaycheckDate: string,
  daysEarly: number,
  operating: readonly SimPaycheck[]
): BreakGlassPlanStep {
  return {
    billId: bill.billId,
    billName: bill.creditorName,
    billAmount: bill.amount,
    billDueDate: bill.billDate,
    fromPaycheckDate,
    toPaycheckDate,
    daysEarly,
    requiresConfirmation: moveRequiresConfirmation(bill, toPaycheckDate, operating),
  };
}

function formatHeadline(targetPaycheckDate: string): string {
  const label = format(parseISO(targetPaycheckDate), 'MMM d, yyyy');
  return `Clear Break-Glass on ${label}`;
}

function legalLanding(
  bill: PaycheckBill,
  paycheckIndex: number,
  sim: SimPaycheck[],
  paycheckDay: Int32Array,
  countsTowardCashFloors: Int32Array,
  startDay: number,
  maxEarlyDays: number
): boolean {
  if (countsTowardCashFloors[paycheckIndex] !== 1) return false;
  const payDay = paycheckDay[paycheckIndex];
  if (payDay < startDay) return false;
  const daysEarly = dayNumberOfIsoDate(bill.billDate) - payDay;
  if (daysEarly < 0 || daysEarly > maxEarlyDays) return false;
  return isFundingPaycheckUsable(
    {
      purpose: sim[paycheckIndex].purpose,
      incomeSourceIds: sim[paycheckIndex].incomeSourceIds,
    },
    bill.preferredIncomeSourceId
  );
}

function buildRelaxedModel(
  sim: SimPaycheck[],
  breakGlassDates: ReadonlySet<string>,
  lockedBillKeys: ReadonlySet<string>,
  startDay: number,
  maxEarlyDays: number
): { model: AssignmentModel; bills: RelaxedBill[] } | null {
  const paycheckCount = sim.length;
  const incomeCents = new Int32Array(paycheckCount);
  const minCashCents = new Int32Array(paycheckCount);
  const targetCashCents = new Int32Array(paycheckCount);
  const paycheckDay = new Int32Array(paycheckCount);
  const countsTowardCashFloors = new Int32Array(paycheckCount);
  const paycheckIso = sim.map((paycheck) => paycheck.date);

  for (let index = 0; index < paycheckCount; index++) {
    const paycheck = sim[index];
    const remaining = finiteCents(paycheck.budgetRemaining);
    const minCash = finiteCents(paycheck.minCashOnHand);
    const targetCash = finiteCents(paycheck.targetCashOnHand);
    if (remaining === null || minCash === null || targetCash === null) return null;
    let income = remaining;
    for (const bill of paycheck.bills) {
      if (bill.isSkipped || bill.isUnpayable) continue;
      const amount = finiteCents(bill.amount);
      if (amount === null) return null;
      income += amount;
    }
    if (!Number.isSafeInteger(income)) return null;
    incomeCents[index] = income;
    minCashCents[index] = minCash;
    targetCashCents[index] = targetCash;
    paycheckDay[index] = dayNumberOfIsoDate(paycheck.date);
    countsTowardCashFloors[index] = paycheck.purpose === 'savingsAndGoals' ? 0 : 1;
  }

  const relaxed: RelaxedBill[] = [];
  for (let paycheckIndex = 0; paycheckIndex < paycheckCount; paycheckIndex++) {
    for (const bill of sim[paycheckIndex].bills) {
      if (bill.isSkipped || bill.isUnpayable) continue;
      const amountCents = finiteCents(bill.amount);
      if (amountCents === null) return null;
      const locked = lockedBillKeys.has(occurrenceKey(bill.billId, bill.billDate));
      const onBreakGlass = breakGlassDates.has(sim[paycheckIndex].date);
      const staysFixed = bill.isIncomeAttached === true || (locked && !onBreakGlass);
      const candidates: number[] = [];
      if (staysFixed) {
        candidates.push(paycheckIndex);
      } else {
        for (let landing = 0; landing < paycheckCount; landing++) {
          if (
            legalLanding(
              bill,
              landing,
              sim,
              paycheckDay,
              countsTowardCashFloors,
              startDay,
              maxEarlyDays
            )
          ) {
            candidates.push(landing);
          }
        }
        if (!candidates.includes(paycheckIndex)) candidates.push(paycheckIndex);
        candidates.sort((left, right) => left - right);
      }
      relaxed.push({
        bill,
        fromIndex: paycheckIndex,
        amountCents,
        dueDay: dayNumberOfIsoDate(bill.billDate),
        candidates,
        fixedPaycheck: staysFixed ? paycheckIndex : -1,
        isPinned: bill.isIncomeAttached === true || locked,
      });
    }
  }

  relaxed.sort((left, right) => {
    const leftKey = occurrenceKey(left.bill.billId, left.bill.billDate);
    const rightKey = occurrenceKey(right.bill.billId, right.bill.billDate);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });

  const billCount = relaxed.length;
  const amountCents = new Int32Array(billCount);
  const dueDay = new Int32Array(billCount);
  const priorityTier = new Int32Array(billCount);
  const isPinned = new Int32Array(billCount);
  const fixedPaycheck = new Int32Array(billCount);
  const eligibilityOffsets = new Int32Array(billCount + 1);
  const eligibilityBag: number[] = [];
  const baseline = new Int32Array(billCount);
  const billIds: string[] = [];
  const billDueIso: string[] = [];
  const creditorNames: string[] = [];

  for (let billIndex = 0; billIndex < billCount; billIndex++) {
    const bill = relaxed[billIndex];
    amountCents[billIndex] = bill.amountCents;
    dueDay[billIndex] = bill.dueDay;
    priorityTier[billIndex] = PRIORITY_TIER[bill.bill.priority];
    isPinned[billIndex] = bill.isPinned ? 1 : 0;
    fixedPaycheck[billIndex] = bill.fixedPaycheck;
    baseline[billIndex] = bill.fromIndex;
    eligibilityOffsets[billIndex] = eligibilityBag.length;
    for (const candidate of bill.candidates) eligibilityBag.push(candidate);
    billIds.push(bill.bill.billId);
    billDueIso.push(bill.bill.billDate);
    creditorNames.push(bill.bill.creditorName);
  }
  eligibilityOffsets[billCount] = eligibilityBag.length;

  const model: AssignmentModel = {
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
    advisorBaseline: {
      placement: baseline,
      earlyDayCutoff: MAX_PREPAY_DAYS,
    },
  };
  return { model, bills: relaxed };
}

function shortfallCents(remaining: number, minCash: number): number {
  return Math.max(0, minCash - remaining);
}

function isBreakGlassCents(remaining: number, targetCash: number, minCash: number): boolean {
  return remaining < targetCash && remaining >= minCash;
}

function respectsHardConstraints(
  model: AssignmentModel,
  baseline: ArrayLike<number>,
  placement: ArrayLike<number>,
  startDay: number,
  maxEarlyDays: number
): boolean {
  if (placement.length !== model.billCount) return false;
  const baseRemaining = remainingCentsForPlacement(model, baseline);
  const nextRemaining = remainingCentsForPlacement(model, placement);

  for (let billIndex = 0; billIndex < model.billCount; billIndex++) {
    const paycheckIndex = placement[billIndex];
    if (paycheckIndex === UNPAID_PLACEMENT) return false;
    if (paycheckIndex === baseline[billIndex]) continue;
    const daysEarly = model.dueDay[billIndex] - model.paycheckDay[paycheckIndex];
    if (daysEarly < 0 || daysEarly > maxEarlyDays) return false;
    if (model.paycheckDay[paycheckIndex] < startDay) return false;
  }

  for (let paycheckIndex = 0; paycheckIndex < model.paycheckCount; paycheckIndex++) {
    if (model.countsTowardCashFloors[paycheckIndex] !== 1) continue;
    if (
      shortfallCents(nextRemaining[paycheckIndex], model.minCashCents[paycheckIndex]) >
      shortfallCents(baseRemaining[paycheckIndex], model.minCashCents[paycheckIndex])
    ) {
      return false;
    }
    const wasBreakGlass = isBreakGlassCents(
      baseRemaining[paycheckIndex],
      model.targetCashCents[paycheckIndex],
      model.minCashCents[paycheckIndex]
    );
    const nowBreakGlass = isBreakGlassCents(
      nextRemaining[paycheckIndex],
      model.targetCashCents[paycheckIndex],
      model.minCashCents[paycheckIndex]
    );
    if (!wasBreakGlass && nowBreakGlass) return false;
  }
  return true;
}

function clearsTarget(model: AssignmentModel, placement: ArrayLike<number>, paycheckIndex: number): boolean {
  const remaining = remainingCentsForPlacement(model, placement);
  return (
    remaining[paycheckIndex] >= model.targetCashCents[paycheckIndex]
  );
}

function connectMoves(moves: RelaxedMove[], paycheckCount: number): RelaxedMove[][] {
  const parent = Array.from({ length: paycheckCount }, (_, index) => index);
  const find = (index: number): number => {
    let cursor = index;
    while (parent[cursor] !== cursor) {
      parent[cursor] = parent[parent[cursor]];
      cursor = parent[cursor];
    }
    return cursor;
  };
  const unite = (left: number, right: number): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };
  for (const move of moves) unite(move.fromIndex, move.toIndex);
  const groups = new Map<number, RelaxedMove[]>();
  for (const move of moves) {
    const root = find(move.fromIndex);
    const group = groups.get(root);
    if (group) group.push(move);
    else groups.set(root, [move]);
  }
  return [...groups.values()];
}

function stepsForMoves(
  moves: RelaxedMove[],
  model: AssignmentModel,
  bills: RelaxedBill[],
  operating: readonly SimPaycheck[]
): BreakGlassPlanStep[] {
  const steps = moves.map((move) => {
    const bill = bills[move.billIndex].bill;
    const toPaycheckDate = model.paycheckIso[move.toIndex];
    const daysEarly = model.dueDay[move.billIndex] - model.paycheckDay[move.toIndex];
    return makeStep(
      bill,
      model.paycheckIso[move.fromIndex],
      toPaycheckDate,
      daysEarly,
      operating
    );
  });
  steps.sort((left, right) => {
    if (left.fromPaycheckDate !== right.fromPaycheckDate) {
      return left.fromPaycheckDate < right.fromPaycheckDate ? -1 : 1;
    }
    if (left.billId !== right.billId) return left.billId < right.billId ? -1 : 1;
    return left.billDueDate < right.billDueDate ? -1 : 1;
  });
  return steps;
}

function notifyTargets(
  dates: readonly string[],
  onTarget: ProposeBreakGlassOptions['onTarget']
): void {
  dates.forEach((_, index) => onTarget?.(index + 1, dates.length));
}

/**
 * Propose Break-Glass plans from one relaxed re-solve on `options.solver`.
 * Bills may land up to 28 days early. Locks on paychecks already in the
 * Break-Glass band can move; other locks stay fixed.
 */
export function proposeBreakGlassPlans(
  schedule: ScheduleData,
  options: ProposeBreakGlassOptions = {}
): BreakGlassAdvisorReport {
  const paychecks = horizonPaychecks(schedule);
  if (!paychecks.length) return { plans: [] };

  const targetCashOnHand =
    options.targetCashOnHand ?? schedule.maxBudgetRemaining ?? DEFAULT_TARGET_CASH_ON_HAND;
  const minCashOnHand =
    options.minCashOnHand ?? schedule.minCashOnHand ?? DEFAULT_MIN_CASH_ON_HAND;
  const maxEarlyDays = options.maxEarlyDays ?? MAX_ADVISOR_EARLY_DAYS;
  const scheduleStartDate = options.scheduleStartDate ?? schedule.startDate;
  const lockedBillKeys = options.lockedBillKeys ?? new Set<string>();
  const sim = cloneSim(paychecks, targetCashOnHand, minCashOnHand);
  const targetDates = listBreakGlassDates(sim).map((paycheck) => paycheck.date);
  if (targetDates.length === 0) return { plans: [] };

  const built = buildRelaxedModel(
    sim,
    new Set(targetDates),
    lockedBillKeys,
    dayNumberOfIsoDate(scheduleStartDate),
    maxEarlyDays
  );
  if (!built) {
    notifyTargets(targetDates, options.onTarget);
    return { plans: [] };
  }

  const solver = options.solver ?? new GreedySolver();
  const solved = solver.solve(built.model);
  const baseline = built.model.advisorBaseline?.placement;
  const solvable =
    solved.optimal &&
    baseline !== undefined &&
    respectsHardConstraints(
      built.model,
      baseline,
      solved.placement,
      dayNumberOfIsoDate(scheduleStartDate),
      maxEarlyDays
    );

  const moves: RelaxedMove[] = [];
  if (solvable && baseline) {
    for (let billIndex = 0; billIndex < built.model.billCount; billIndex++) {
      const toIndex = solved.placement[billIndex];
      const fromIndex = baseline[billIndex];
      if (toIndex === fromIndex || toIndex === UNPAID_PLACEMENT) continue;
      moves.push({ billIndex, fromIndex, toIndex });
    }
  }

  const targetIndexes = new Map(
    targetDates.map((date) => [date, built.model.paycheckIso.indexOf(date)])
  );
  const viable: Array<{ moves: RelaxedMove[]; cleared: string[] }> = [];
  if (solvable && baseline) {
    for (const group of connectMoves(moves, built.model.paycheckCount)) {
      if (group.length === 0 || group.length > MAX_ADVISOR_PLAN_STEPS) continue;
      const isolated = Int32Array.from(baseline);
      for (const move of group) isolated[move.billIndex] = move.toIndex;
      if (
        !respectsHardConstraints(
          built.model,
          baseline,
          isolated,
          dayNumberOfIsoDate(scheduleStartDate),
          maxEarlyDays
        )
      ) {
        continue;
      }
      const touched = new Set<number>();
      for (const move of group) {
        touched.add(move.fromIndex);
        touched.add(move.toIndex);
      }
      const cleared = targetDates.filter((date) => {
        const index = targetIndexes.get(date) ?? -1;
        return index >= 0 && touched.has(index) && clearsTarget(built.model, isolated, index);
      });
      if (cleared.length === 0) continue;
      viable.push({ moves: group, cleared });
    }
  }

  viable.sort((left, right) =>
    left.cleared[0] < right.cleared[0] ? -1 : left.cleared[0] > right.cleared[0] ? 1 : 0
  );
  const usedTargets = new Set<string>();
  const operating = confirmationPaychecks(sim);
  const plans: BreakGlassPlan[] = [];
  for (const candidate of viable) {
    const targetPaycheckDate = candidate.cleared.find((date) => !usedTargets.has(date));
    if (!targetPaycheckDate) continue;
    for (const date of candidate.cleared) usedTargets.add(date);
    const steps = stepsForMoves(candidate.moves, built.model, built.bills, operating);
    plans.push({
      id: `break-glass-${targetPaycheckDate}`,
      targetPaycheckDate,
      headline: formatHeadline(targetPaycheckDate),
      steps,
      maxDaysEarly: Math.max(...steps.map((step) => step.daysEarly)),
      clearsBreakGlass: true,
    });
    if (plans.length >= MAX_ADVISOR_PLANS) break;
  }

  notifyTargets(targetDates, options.onTarget);
  return { plans };
}
