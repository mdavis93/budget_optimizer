import type {
  Bill,
  BillAssignment,
  Debt,
  Income,
  IncomeOverride,
  Leave,
  SavingsGoal,
  SkippedBill,
} from './types';
import type { ScheduleComputeInputPayload } from './scheduleComputeProtocol';

/**
 * Assignment-changing fields hashed by the renderer cache and scheduleInputHash.
 * Viewport `months` is display-only (re-sliced from fullPaychecks) and is omitted.
 * Sub-day clock is omitted; only a local calendar date is hashed.
 */
export const SCHEDULE_IDENTITY_FIELDS = [
  'incomes',
  'bills',
  'goals',
  'debts',
  'leaves',
  'skippedBills',
  'billAssignments',
  'preferredAssignments',
  'incomeOverrides',
  'startDate',
  'startingBalance',
  'targetCashOnHand',
  'minCashOnHand',
  'minSavingsPerPaycheck',
  'clockDate',
] as const;

export type ScheduleIdentityField = (typeof SCHEDULE_IDENTITY_FIELDS)[number];

export interface ScheduleIdentityInput {
  incomes: Income[];
  bills: Bill[];
  goals?: SavingsGoal[];
  debts?: Debt[];
  leaves?: Leave[];
  skippedBills: SkippedBill[];
  billAssignments: BillAssignment[];
  preferredAssignments?: Array<[string, string]>;
  incomeOverrides: IncomeOverride[];
  startDate: string;
  startingBalance: number;
  targetCashOnHand?: number | null;
  minCashOnHand?: number | null;
  minSavingsPerPaycheck?: number | null;
  /** Injected in tests; production uses the local clock. */
  now?: Date;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Local calendar date (YYYY-MM-DD). Not UTC `toISOString().slice(0, 10)`. */
export function localCalendarDate(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function sortById<T extends { id: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function sortPairs(pairs: Array<[string, string]>): Array<[string, string]> {
  return [...pairs].sort((a, b) => {
    const left = `${a[0]}\0${a[1]}`;
    const right = `${b[0]}\0${b[1]}`;
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

function incomeIdentity(incomes: Income[]) {
  return sortById(incomes).map((income) => ({
    id: income.id,
    amount: income.amount,
    cadence: income.cadence,
    startDate: income.startDate,
    endDate: income.endDate ?? '',
    isActive: income.isActive,
  }));
}

function billIdentity(bills: Bill[]) {
  return sortById(bills).map((bill) => ({
    id: bill.id,
    budgetedAmount: bill.budgetedAmount,
    dueDay: bill.dueDay,
    isRecurring: bill.isRecurring,
    priority: bill.priority,
    preferredIncomeSourceId: bill.preferredIncomeSourceId ?? '',
    isIncomeAttached: Boolean(bill.isIncomeAttached),
  }));
}

function goalIdentity(goals: SavingsGoal[]) {
  return sortById(goals).map((goal) => ({
    id: goal.id,
    targetAmount: goal.targetAmount,
    targetDate: goal.targetDate,
    alreadySaved: goal.alreadySaved,
    priority: goal.priority,
  }));
}

function debtIdentity(debts: Debt[]) {
  return sortById(debts).map((debt) => ({
    id: debt.id,
    billId: debt.billId,
    principalBalance: debt.principalBalance,
    apr: debt.apr,
    monthlyPayment: debt.monthlyPayment,
  }));
}

function leaveIdentity(leaves: Leave[]) {
  return sortById(leaves).map((leave) => ({
    id: leave.id,
    incomeId: leave.incomeId,
    type: leave.type,
    startDate: leave.startDate,
    endDate: leave.endDate,
    targetCashOnHand: leave.targetCashOnHand ?? '',
    minCashOnHand: leave.minCashOnHand ?? '',
  }));
}

function skippedIdentity(skippedBills: SkippedBill[]) {
  return [...skippedBills]
    .map((row) => ({ billId: row.billId, skipDate: row.skipDate }))
    .sort((a, b) => {
      const left = `${a.billId}\0${a.skipDate}`;
      const right = `${b.billId}\0${b.skipDate}`;
      return left < right ? -1 : left > right ? 1 : 0;
    });
}

function assignmentIdentity(billAssignments: BillAssignment[]) {
  return [...billAssignments]
    .map((row) => ({
      billId: row.billId,
      billDueDate: row.billDueDate,
      paycheckDate: row.paycheckDate,
    }))
    .sort((a, b) => {
      const left = `${a.billId}\0${a.billDueDate}\0${a.paycheckDate}`;
      const right = `${b.billId}\0${b.billDueDate}\0${b.paycheckDate}`;
      return left < right ? -1 : left > right ? 1 : 0;
    });
}

function overrideIdentity(incomeOverrides: IncomeOverride[]) {
  return [...incomeOverrides]
    .map((row) => ({
      incomeId: row.incomeId,
      paycheckDate: row.paycheckDate,
      amount: row.amount,
    }))
    .sort((a, b) => {
      const left = `${a.incomeId}\0${a.paycheckDate}`;
      const right = `${b.incomeId}\0${b.paycheckDate}`;
      return left < right ? -1 : left > right ? 1 : 0;
    });
}

/**
 * Canonical renderer identity. Cache keys and effect hashes must use this
 * (not `JSON.stringify(overlay)`).
 */
export function buildScheduleIdentity(input: ScheduleIdentityInput): string {
  const canonical = {
    incomes: incomeIdentity(input.incomes),
    bills: billIdentity(input.bills),
    goals: goalIdentity(input.goals ?? []),
    debts: debtIdentity(input.debts ?? []),
    leaves: leaveIdentity(input.leaves ?? []),
    skippedBills: skippedIdentity(input.skippedBills),
    billAssignments: assignmentIdentity(input.billAssignments),
    preferredAssignments: sortPairs(input.preferredAssignments ?? []),
    incomeOverrides: overrideIdentity(input.incomeOverrides),
    startDate: input.startDate,
    startingBalance: input.startingBalance,
    targetCashOnHand: input.targetCashOnHand ?? '',
    minCashOnHand: input.minCashOnHand ?? '',
    minSavingsPerPaycheck: input.minSavingsPerPaycheck ?? '',
    clockDate: localCalendarDate(input.now ?? new Date()),
  };
  return JSON.stringify(canonical);
}

/**
 * Worker SHA-256 input: same months/clock omissions as the renderer identity.
 * Full `nowIso` and `months` stay on the IPC payload; they are not hashed.
 */
export function scheduleComputeHashBody(input: ScheduleComputeInputPayload): Omit<
  ScheduleComputeInputPayload,
  'months' | 'nowIso'
> & { clockDate: string } {
  return {
    incomes: input.incomes,
    bills: input.bills,
    startDate: input.startDate,
    startingBalance: input.startingBalance,
    skippedBills: input.skippedBills,
    manualAssignments: input.manualAssignments,
    preferredAssignments: input.preferredAssignments,
    targetCashOnHand: input.targetCashOnHand,
    goals: input.goals,
    minCashOnHand: input.minCashOnHand,
    minSavingsPerPaycheck: input.minSavingsPerPaycheck,
    debtPayoffs: input.debtPayoffs,
    incomeOverrides: input.incomeOverrides,
    leaves: input.leaves,
    clockDate: localCalendarDate(new Date(input.nowIso)),
  };
}
