import { useCallback, useEffect, useState } from 'react';
import { useDraftActions, useSchedule } from '../context/DraftContext';
import { useBudget } from '../context/BudgetContext';
import type { ProposedFix } from '../types';

export function useScheduleMutations() {
  const { isQuickBudget } = useBudget();
  const {
    applyReconciliationFixes,
    reloadSnapshot,
    removeBillAssignment,
    removeIncomeOverride,
    setIncomeOverride,
    skipBill,
  } = useDraftActions();
  const {
    schedule,
    generateSchedule,
    scheduleStartDate: startDate,
    scheduleMonths: months,
    scheduleStartingBalance: startingBalance,
  } = useSchedule();
  const [skippingBill, setSkippingBill] = useState<string | null>(null);
  const [restoringBill, setRestoringBill] = useState<string | null>(null);
  const [savingIncomeKey, setSavingIncomeKey] = useState<string | null>(null);
  const [showReconciliation, setShowReconciliation] = useState(false);
  const [dismissedReconciliation, setDismissedReconciliation] = useState(false);
  const [isApplyingFixes, setIsApplyingFixes] = useState(false);

  useEffect(() => {
    setShowReconciliation(
      Boolean(schedule?.reconciliation?.needsReconciliation && !dismissedReconciliation)
    );
  }, [dismissedReconciliation, schedule?.reconciliation?.needsReconciliation]);

  useEffect(() => {
    setDismissedReconciliation(false);
  }, [startDate, startingBalance]);

  const handleApplyFixes = useCallback(async (fixes: ProposedFix[]) => {
    setIsApplyingFixes(true);
    try {
      if (isQuickBudget) {
        const result = await window.electronAPI.reconciliation.applyFixes(
          fixes.map((fix) => ({
            id: fix.id,
            type: fix.type,
            billId: fix.billId,
            billDueDate: fix.billDueDate,
            fromPaycheckDate: fix.fromPaycheckDate,
            toPaycheckDate: fix.toPaycheckDate,
          }))
        );
        if (result.success) {
          setShowReconciliation(false);
          setDismissedReconciliation(false);
          generateSchedule(startDate, months, startingBalance, { force: true });
        }
      } else if (applyReconciliationFixes(fixes)) {
        setShowReconciliation(false);
        setDismissedReconciliation(false);
        generateSchedule(startDate, months, startingBalance, { force: true });
      }
    } catch {
      // Error handling is reflected through the page's existing UI state.
    } finally {
      setIsApplyingFixes(false);
    }
  }, [
    applyReconciliationFixes,
    generateSchedule,
    isQuickBudget,
    months,
    startDate,
    startingBalance,
  ]);

  const handleSkipReconciliation = useCallback(() => {
    setDismissedReconciliation(true);
    setShowReconciliation(false);
  }, []);

  const handleSkipBill = useCallback(async (billId: string, paycheckDate: string) => {
    setSkippingBill(`${billId}-${paycheckDate}`);
    try {
      if (isQuickBudget) {
        const result = await window.electronAPI.skippedBills.skip(billId, paycheckDate);
        if (result.success) {
          await reloadSnapshot();
          generateSchedule(startDate, months, startingBalance, { force: true });
        }
      } else if (skipBill(billId, paycheckDate)) {
        generateSchedule(startDate, months, startingBalance, { force: true });
      }
    } catch {
      // Error handling is reflected through the page's existing UI state.
    } finally {
      setSkippingBill(null);
    }
  }, [
    generateSchedule,
    isQuickBudget,
    months,
    reloadSnapshot,
    skipBill,
    startDate,
    startingBalance,
  ]);

  const handleRestoreBill = useCallback(async (billId: string, billDueDate: string) => {
    setRestoringBill(`${billId}-${billDueDate}`);
    try {
      if (isQuickBudget) {
        const result = await window.electronAPI.billAssignments.remove(billId, billDueDate);
        if (result.success) {
          await reloadSnapshot();
        }
      } else {
        removeBillAssignment(billId, billDueDate);
      }
    } catch {
      // Error handling is reflected through the page's existing UI state.
    } finally {
      setRestoringBill(null);
    }
  }, [isQuickBudget, reloadSnapshot, removeBillAssignment]);

  const handleSaveIncomeOverride = useCallback(async (
    incomeId: string,
    paycheckDate: string,
    amount: number
  ) => {
    const key = `${incomeId}-${paycheckDate}`;
    setSavingIncomeKey(key);
    try {
      if (isQuickBudget) {
        const result = await window.electronAPI.incomeOverrides.set(incomeId, paycheckDate, amount);
        if (result.success) {
          await reloadSnapshot();
          await generateSchedule(startDate, months, startingBalance, { force: true });
        }
      } else if (setIncomeOverride(incomeId, paycheckDate, amount)) {
        await generateSchedule(startDate, months, startingBalance, { force: true });
      }
    } finally {
      setSavingIncomeKey(null);
    }
  }, [
    generateSchedule,
    isQuickBudget,
    months,
    reloadSnapshot,
    setIncomeOverride,
    startDate,
    startingBalance,
  ]);

  const handleClearIncomeOverride = useCallback(async (incomeId: string, paycheckDate: string) => {
    const key = `${incomeId}-${paycheckDate}`;
    setSavingIncomeKey(key);
    try {
      if (isQuickBudget) {
        const result = await window.electronAPI.incomeOverrides.remove(incomeId, paycheckDate);
        if (result.success) {
          await reloadSnapshot();
          await generateSchedule(startDate, months, startingBalance, { force: true });
        }
      } else if (removeIncomeOverride(incomeId, paycheckDate)) {
        await generateSchedule(startDate, months, startingBalance, { force: true });
      }
    } finally {
      setSavingIncomeKey(null);
    }
  }, [
    generateSchedule,
    isQuickBudget,
    months,
    reloadSnapshot,
    removeIncomeOverride,
    startDate,
    startingBalance,
  ]);

  return {
    skippingBill,
    restoringBill,
    savingIncomeKey,
    showReconciliation,
    dismissedReconciliation,
    isApplyingFixes,
    setShowReconciliation,
    setDismissedReconciliation,
    handleApplyFixes,
    handleSkipReconciliation,
    handleSkipBill,
    handleRestoreBill,
    handleSaveIncomeOverride,
    handleClearIncomeOverride,
  };
}
