import {
  Bill,
  BillAssignment,
  Income,
  IncomeOverride,
  Leave,
  SkippedBill,
} from '../types';
import { DraftBudgetFields } from '../types/draft';

export function buildScheduleOverlayHash(params: {
  skippedBills: SkippedBill[];
  billAssignments: BillAssignment[];
  incomeOverrides: IncomeOverride[];
}): string {
  const skipped = params.skippedBills
    .map((sb) => `${sb.billId}-${sb.skipDate}`)
    .sort()
    .join('|');
  const assignments = params.billAssignments
    .map((a) => `${a.billId}-${a.billDueDate}-${a.paycheckDate}`)
    .sort()
    .join('|');
  const overrides = params.incomeOverrides
    .map((o) => `${o.incomeId}-${o.paycheckDate}-${o.amount}`)
    .sort()
    .join('|');
  return `${skipped}::${assignments}::${overrides}`;
}

export function buildScheduleEntityHash(
  incomes: Income[],
  bills: Bill[],
  leaves: Leave[] = []
): string {
  const incomeData = incomes
    .map((i) => `${i.id}-${i.amount}-${i.sourceName}-${i.cadence}-${i.startDate}-${i.isActive}`)
    .sort()
    .join('|');
  const billData = bills
    .map((b) => `${b.id}-${b.budgetedAmount}-${b.creditorName}-${b.dueDay}-${b.priority}`)
    .sort()
    .join('|');
  const leaveData = leaves
    .map(
      (l) =>
        `${l.id}-${l.incomeId}-${l.type}-${l.startDate}-${l.endDate}-${l.targetCashOnHand ?? ''}-${l.minCashOnHand ?? ''}`
    )
    .sort()
    .join('|');
  return `${incomeData}::${billData}::${leaveData}`;
}

export function buildBudgetFieldsHash(budgetFields: DraftBudgetFields | null | undefined): string {
  if (!budgetFields) {
    return '';
  }
  return [
    budgetFields.startingBalance,
    budgetFields.targetCashOnHand,
    budgetFields.minCashOnHand,
    budgetFields.minSavingsPerPaycheck,
    budgetFields.scheduleStartDate,
  ].join('-');
}

export function buildScheduleInputHash(params: {
  incomes: Income[];
  bills: Bill[];
  skippedBills: SkippedBill[];
  billAssignments: BillAssignment[];
  incomeOverrides: IncomeOverride[];
  leaves?: Leave[];
  budgetFields?: DraftBudgetFields | null;
}): string {
  const entityHash = buildScheduleEntityHash(params.incomes, params.bills, params.leaves ?? []);
  const overlayHash = buildScheduleOverlayHash({
    skippedBills: params.skippedBills,
    billAssignments: params.billAssignments,
    incomeOverrides: params.incomeOverrides,
  });
  const budgetHash = buildBudgetFieldsHash(params.budgetFields);
  return `${entityHash}::${overlayHash}::${budgetHash}`;
}
