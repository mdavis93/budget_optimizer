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

export function filterPaycheckBills(
  bills: PaycheckBill[],
  billAssignments: BillAssignment[],
  paycheckDate: string
): PaycheckBill[] {
  return bills.filter((bill) => {
    const targetPaycheck = getBillAssignmentTarget(
      billAssignments,
      bill.billId,
      bill.billDate
    );
    if (targetPaycheck) {
      return targetPaycheck === paycheckDate;
    }
    return true;
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
