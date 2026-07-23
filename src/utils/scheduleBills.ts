import { BillAssignment, PaycheckBill } from '../types';

export function getBillAssignmentTarget(
  billAssignments: BillAssignment[],
  billId: string,
  billDueDate: string
): string | undefined {
  return billAssignments.find(
    (a) => a.billId === billId && a.billDueDate === billDueDate
  )?.paycheckDate;
}

/**
 * Filter bills for display on a paycheck card.
 * Manual assignments hide a bill from non-target paychecks, but assignments
 * targeting a paycheck that no longer exists (e.g. unpaid leave removed it)
 * are ignored so the bill stays visible where the scheduler placed it.
 */
export function filterPaycheckBills(
  bills: PaycheckBill[],
  billAssignments: BillAssignment[],
  paycheckDate: string,
  validPaycheckDates?: ReadonlySet<string> | Iterable<string>
): PaycheckBill[] {
  const validDates =
    validPaycheckDates == null
      ? null
      : validPaycheckDates instanceof Set
        ? validPaycheckDates
        : new Set(validPaycheckDates);

  return bills.filter((bill) => {
    const targetPaycheck = getBillAssignmentTarget(
      billAssignments,
      bill.billId,
      bill.billDate
    );
    if (!targetPaycheck) return true;
    if (validDates && !validDates.has(targetPaycheck)) return true;
    return targetPaycheck === paycheckDate;
  });
}

export function isBillMovedToPaycheck(
  billAssignments: BillAssignment[],
  billId: string,
  billDueDate: string,
  paycheckDate: string
): boolean {
  return billAssignments.some(
    (a) =>
      a.billId === billId &&
      a.billDueDate === billDueDate &&
      a.paycheckDate === paycheckDate
  );
}
