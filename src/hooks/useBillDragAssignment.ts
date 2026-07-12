import { useCallback, useState, type DragEvent } from 'react';
import { useDraftActions, useSchedule } from '../context/DraftContext';
import { useBudget } from '../context/BudgetContext';
import type { PaycheckBill } from '../types';
import type { DraggedBill } from '../components/schedule';
import { needsAssignmentConfirmation } from '../utils/assignmentConstraints';

interface PendingAssignment {
  billId: string;
  billDueDate: string;
  paycheckDate: string;
}

export function useBillDragAssignment() {
  const { isQuickBudget } = useBudget();
  const { assignBill, reloadSnapshot } = useDraftActions();
  const {
    generateSchedule,
    scheduleStartDate: startDate,
    scheduleMonths: months,
    scheduleStartingBalance: startingBalance,
  } = useSchedule();
  const [draggedBill, setDraggedBill] = useState<DraggedBill | null>(null);
  const [dropTargetDate, setDropTargetDate] = useState<string | null>(null);
  const [isAssigning, setIsAssigning] = useState(false);
  const [pendingAssignment, setPendingAssignment] = useState<PendingAssignment | null>(null);

  const applyBillAssignment = useCallback(async (
    billId: string,
    billDueDate: string,
    targetPaycheckDate: string
  ) => {
    setIsAssigning(true);
    try {
      if (isQuickBudget) {
        const result = await window.electronAPI.billAssignments.assign(
          billId,
          billDueDate,
          targetPaycheckDate
        );
        if (result.success) {
          await reloadSnapshot();
          generateSchedule(startDate, months, startingBalance, { force: true });
        }
      } else {
        assignBill(billId, billDueDate, targetPaycheckDate);
      }
    } catch {
      // Error handling is reflected through the page's existing UI state.
    } finally {
      setIsAssigning(false);
    }
  }, [
    assignBill,
    generateSchedule,
    isQuickBudget,
    months,
    reloadSnapshot,
    startDate,
    startingBalance,
  ]);

  const handleDragStart = useCallback((bill: PaycheckBill, sourcePaycheckDate: string) => {
    setDraggedBill({
      billId: bill.billId,
      creditorName: bill.creditorName,
      amount: bill.amount,
      sourcePaycheckDate,
      dueDay: bill.dueDay,
      billDate: bill.billDate,
    });
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggedBill(null);
    setDropTargetDate(null);
  }, []);

  const handleDragOver = useCallback((event: DragEvent, paycheckDate: string) => {
    event.preventDefault();
    if (draggedBill && paycheckDate !== draggedBill.sourcePaycheckDate) {
      setDropTargetDate(paycheckDate);
    }
  }, [draggedBill]);

  const handleDragLeave = useCallback(() => {
    setDropTargetDate(null);
  }, []);

  const handleDrop = useCallback(async (event: DragEvent, targetPaycheckDate: string) => {
    event.preventDefault();
    setDropTargetDate(null);

    if (!draggedBill || targetPaycheckDate === draggedBill.sourcePaycheckDate) {
      return;
    }

    const { billId, billDate: billDueDate } = draggedBill;
    if (needsAssignmentConfirmation(billDueDate, targetPaycheckDate)) {
      setPendingAssignment({ billId, billDueDate, paycheckDate: targetPaycheckDate });
      setDraggedBill(null);
      return;
    }

    await applyBillAssignment(billId, billDueDate, targetPaycheckDate);
    setDraggedBill(null);
  }, [applyBillAssignment, draggedBill]);

  const handleConfirmAssignment = useCallback(async () => {
    if (!pendingAssignment) return;

    await applyBillAssignment(
      pendingAssignment.billId,
      pendingAssignment.billDueDate,
      pendingAssignment.paycheckDate
    );
    setPendingAssignment(null);
  }, [applyBillAssignment, pendingAssignment]);

  return {
    draggedBill,
    dropTargetDate,
    isAssigning,
    pendingAssignment,
    setPendingAssignment,
    handleDragStart,
    handleDragEnd,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleConfirmAssignment,
  };
}
