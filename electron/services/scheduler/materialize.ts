import { format, isAfter, parseISO } from 'date-fns';
import type { Bill } from '../database.service';
import {
  candidatesForBill,
  type AssignmentModel,
} from './model/assignmentModel';
import { UNPAID_PLACEMENT } from './model/objective';
import { priorityFromTier } from '@shared/billPriority';
import {
  type PaycheckAssignment,
  type ProjectedBill,
  type ProjectedIncome,
  type UnfundableReason,
} from './types';

function isoOf(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

function buildPaycheckSkeleton(
  paycheckDates: Date[],
  allIncomes: ProjectedIncome[]
): PaycheckAssignment[] {
  return paycheckDates.map((paycheckDate) => {
    const incomes = allIncomes.filter((income) => income.date.getTime() === paycheckDate.getTime());
    return {
      date: paycheckDate,
      incomes,
      bills: [],
      unusable: incomes.length > 0 && incomes.every((income) => income.unusable),
    };
  });
}

function lookupProjectedBill(
  model: AssignmentModel,
  billIndex: number,
  bills: readonly ProjectedBill[],
  incomeAttachedBillsRaw: readonly Bill[]
): ProjectedBill {
  const billId = model.billIds[billIndex];
  const dueIso = model.billDueIso[billIndex];
  const dueDate = parseISO(dueIso);
  const fromProjected = bills.find(
    (bill) => bill.billId === billId && isoOf(bill.date) === dueIso
  );
  if (fromProjected) {
    return { ...fromProjected };
  }

  const attached = incomeAttachedBillsRaw.find((bill) => bill.id === billId);
  if (attached) {
    return {
      date: dueDate,
      billId,
      creditorName: attached.creditorName,
      amount: attached.budgetedAmount,
      dueDay: attached.dueDay,
      priority: attached.priority,
      category: attached.category,
      preferredIncomeSourceId: attached.preferredIncomeSourceId,
      isIncomeAttached: true,
    };
  }

  return {
    date: dueDate,
    billId,
    creditorName: model.creditorNames[billIndex],
    amount: model.amountCents[billIndex] / 100,
    dueDay: model.dueDay[billIndex],
    priority: priorityFromTier(model.priorityTier[billIndex]),
  };
}

function latestOnOrBefore(
  assignments: readonly PaycheckAssignment[],
  due: Date
): number {
  for (let index = assignments.length - 1; index >= 0; index--) {
    if (!isAfter(assignments[index].date, due)) {
      return index;
    }
  }
  return -1;
}

function unpaidLanding(
  model: AssignmentModel,
  billIndex: number,
  assignments: readonly PaycheckAssignment[]
): { paycheckIndex: number; reason: UnfundableReason } {
  const candidates = candidatesForBill(model, billIndex);
  if (model.fixedPaycheck[billIndex] >= 0) {
    return {
      paycheckIndex: model.fixedPaycheck[billIndex],
      reason: 'insufficient_income_in_window',
    };
  }
  if (candidates.length > 0) {
    return {
      paycheckIndex: candidates[candidates.length - 1],
      reason: 'insufficient_income_in_window',
    };
  }
  const due = parseISO(model.billDueIso[billIndex]);
  return {
    paycheckIndex: latestOnOrBefore(assignments, due),
    reason: 'no_eligible_paycheck_in_window',
  };
}

/**
 * Turn a solver placement into paycheck assignments. Unpaid bills stay on a
 * paycheck so the ledger can show them.
 */
export function materializeAssignments(
  model: AssignmentModel,
  placement: ArrayLike<number>,
  paycheckDates: Date[],
  allIncomes: ProjectedIncome[],
  bills: readonly ProjectedBill[],
  incomeAttachedBillsRaw: readonly Bill[] = []
): PaycheckAssignment[] {
  const assignments = buildPaycheckSkeleton(paycheckDates, allIncomes);
  const unpaidOnPaycheck: number[] = [];

  for (let billIndex = 0; billIndex < model.billCount; billIndex++) {
    const projected = lookupProjectedBill(model, billIndex, bills, incomeAttachedBillsRaw);
    const paycheckIndex = placement[billIndex];
    if (paycheckIndex !== UNPAID_PLACEMENT) {
      assignments[paycheckIndex].bills.push(projected);
      continue;
    }

    const landing = unpaidLanding(model, billIndex, assignments);
    if (landing.paycheckIndex < 0) continue;
    assignments[landing.paycheckIndex].bills.push({
      ...projected,
      isUnpayable: true,
      unfundableReason: landing.reason,
    });
    unpaidOnPaycheck.push(landing.paycheckIndex);
  }

  for (const paycheckIndex of new Set(unpaidOnPaycheck)) {
    const paycheck = assignments[paycheckIndex];
    const unpaid = paycheck.bills.filter((bill) => bill.isUnpayable);
    for (const bill of unpaid) {
      if (bill.unfundableReason === 'no_eligible_paycheck_in_window') continue;
      const others = paycheck.bills.filter((other) => other !== bill);
      if (others.length === 0) continue;
      const othersPinned = others.every((other) => {
        const index = model.billIds.findIndex(
          (billId, billIndex) =>
            billId === other.billId && model.billDueIso[billIndex] === isoOf(other.date)
        );
        return index >= 0 && model.isPinned[index] === 1;
      });
      if (othersPinned) {
        bill.unfundableReason = 'all_movable_bills_locked';
      }
    }
  }

  return assignments;
}
