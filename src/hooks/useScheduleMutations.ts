import { useCallback, useEffect, useState } from 'react';
import { useDraftActions, useSchedule } from '../context/DraftContext';
import { useBudget } from '../context/BudgetContext';
import type { BreakGlassPlan, ProposedFix } from '../types';

export function useScheduleMutations() {
  const { isQuickBudget } = useBudget();
  const {
    applyBreakGlassPlan,
    applyReconciliationFixes,
    reloadSnapshot,
    removeBillAssignment,
    removeIncomeOverride,
    setIncomeOverride,
    skipBill,
    unskipBill,
  } = useDraftActions();
  const {
    schedule,
    generateSchedule,
    scheduleStartDate: startDate,
    scheduleMonths: months,
    scheduleStartingBalance: startingBalance,
  } = useSchedule();
  const [skippingBill, setSkippingBill] = useState<string | null>(null);
  const [unskippingBill, setUnskippingBill] = useState<string | null>(null);
  const [restoringBill, setRestoringBill] = useState<string | null>(null);
  const [savingIncomeKey, setSavingIncomeKey] = useState<string | null>(null);
  const [showReconciliation, setShowReconciliation] = useState(false);
  const [dismissedReconciliation, setDismissedReconciliation] = useState(false);
  const [isApplyingFixes, setIsApplyingFixes] = useState(false);
  const [dismissedBreakGlassPlanIds, setDismissedBreakGlassPlanIds] = useState<Set<string>>(
    () => new Set()
  );
  const [applyingBreakGlassPlanId, setApplyingBreakGlassPlanId] = useState<string | null>(null);
  const [isApplyingBreakGlass, setIsApplyingBreakGlass] = useState(false);

  useEffect(() => {
    setShowReconciliation(
      Boolean(schedule?.reconciliation?.needsReconciliation && !dismissedReconciliation)
    );
  }, [dismissedReconciliation, schedule?.reconciliation?.needsReconciliation]);

  useEffect(() => {
    setDismissedReconciliation(false);
    setDismissedBreakGlassPlanIds(new Set());
    setApplyingBreakGlassPlanId(null);
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

  const allAdvisorPlans = schedule?.breakGlassAdvisor?.plans ?? [];
  // Declines hide that entity; accept hides only while applying (anti-flash for
  // the await window). Stack membership comes from the latest schedule build.
  const visibleBreakGlassPlans = allAdvisorPlans.filter(
    (plan) =>
      !dismissedBreakGlassPlanIds.has(plan.id) && plan.id !== applyingBreakGlassPlanId
  );

  // Busy while apply/generate is in flight. Do not key off "plan still present":
  // date-stable ids mean a residual same-date plan would lock the overlay forever.
  const isBreakGlassBusy =
    isApplyingBreakGlass || applyingBreakGlassPlanId !== null;

  const handleAcceptBreakGlassPlan = useCallback(async (plan: BreakGlassPlan) => {
    setIsApplyingBreakGlass(true);
    setApplyingBreakGlassPlanId(plan.id);
    try {
      if (isQuickBudget) {
        const result = await window.electronAPI.breakGlassAdvisor.apply(
          plan.steps.map((step) => ({
            billId: step.billId,
            billDueDate: step.billDueDate,
            fromPaycheckDate: step.fromPaycheckDate,
            toPaycheckDate: step.toPaycheckDate,
          }))
        );
        if (result.success) {
          await generateSchedule(startDate, months, startingBalance, { force: true });
        }
      } else if (applyBreakGlassPlan(plan)) {
        await generateSchedule(startDate, months, startingBalance, { force: true });
      }
    } catch {
      // Error handling is reflected through the page's existing UI state.
    } finally {
      setIsApplyingBreakGlass(false);
      setApplyingBreakGlassPlanId(null);
    }
  }, [
    applyBreakGlassPlan,
    generateSchedule,
    isQuickBudget,
    months,
    startDate,
    startingBalance,
  ]);

  const handleDeclineBreakGlassPlan = useCallback((planId: string) => {
    setDismissedBreakGlassPlanIds((prev) => new Set(prev).add(planId));
  }, []);

  const handleSkipBill = useCallback(async (billId: string, billDate: string) => {
    setSkippingBill(`${billId}-${billDate}`);
    try {
      if (isQuickBudget) {
        const result = await window.electronAPI.skippedBills.skip(billId, billDate);
        if (result.success) {
          await reloadSnapshot();
          await generateSchedule(startDate, months, startingBalance, { force: true });
        }
      } else if (skipBill(billId, billDate)) {
        await generateSchedule(startDate, months, startingBalance, { force: true });
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

  const handleUnskipBill = useCallback(async (billId: string, billDate: string) => {
    setUnskippingBill(`${billId}-${billDate}`);
    try {
      if (isQuickBudget) {
        const result = await window.electronAPI.skippedBills.unskip(billId, billDate);
        if (result.success) {
          await reloadSnapshot();
          await generateSchedule(startDate, months, startingBalance, { force: true });
        }
      } else if (unskipBill(billId, billDate)) {
        await generateSchedule(startDate, months, startingBalance, { force: true });
      }
    } finally {
      setUnskippingBill(null);
    }
  }, [
    generateSchedule,
    isQuickBudget,
    months,
    reloadSnapshot,
    startDate,
    startingBalance,
    unskipBill,
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
    unskippingBill,
    restoringBill,
    savingIncomeKey,
    showReconciliation,
    dismissedReconciliation,
    isApplyingFixes,
    setShowReconciliation,
    setDismissedReconciliation,
    handleApplyFixes,
    handleSkipReconciliation,
    visibleBreakGlassPlans,
    isApplyingBreakGlass: isBreakGlassBusy,
    handleAcceptBreakGlassPlan,
    handleDeclineBreakGlassPlan,
    handleSkipBill,
    handleUnskipBill,
    handleRestoreBill,
    handleSaveIncomeOverride,
    handleClearIncomeOverride,
  };
}
