import { useState, useEffect, useMemo, useCallback, DragEvent } from 'react';
import { Calendar, List, AlertTriangle, RefreshCw, PiggyBank, Target, ChevronDown } from 'lucide-react';
import { useData } from '../context/DataContext';
import { useDraft } from '../context/DraftContext';
import { useBudget } from '../context/BudgetContext';
import { format, parseISO } from 'date-fns';
import { PaycheckBill, ProposedFix } from '../types';
import clsx from 'clsx';
import ReconciliationPage from '../components/ReconciliationPage';
import ConfirmDialog from '../components/ConfirmDialog';
import { PaycheckView, CalendarView, ScheduleControls, type DraggedBill } from '../components/schedule';
import { needsAssignmentConfirmation } from '../utils/assignmentConstraints';
import { buildScheduleInputHash } from '../utils/scheduleInputHash';

type ViewMode = 'paycheck' | 'calendar';

interface PendingAssignment {
  billId: string;
  billDueDate: string;
  paycheckDate: string;
}

export default function SchedulePage() {
  const { 
    incomes, 
    bills, 
    schedule, 
    generateSchedule, 
    isLoading,
    scheduleStartDate: startDate,
    scheduleMonths: months,
    scheduleStartingBalance: startingBalance,
    setScheduleStartDate: setStartDate,
    setScheduleMonths: setMonths,
    setScheduleStartingBalance: setStartingBalance,
  } = useData();
  const { isQuickBudget } = useBudget();
  const draft = useDraft();
  const billAssignments = draft.billAssignments;
  const incomeOverrides = draft.incomeOverrides;
  const [viewMode, setViewMode] = useState<ViewMode>('paycheck');
  const [expandedPaychecks, setExpandedPaychecks] = useState<Set<string>>(new Set());
  const [skippingBill, setSkippingBill] = useState<string | null>(null);
  const [restoringBill, setRestoringBill] = useState<string | null>(null);
  const [draggedBill, setDraggedBill] = useState<DraggedBill | null>(null);
  const [dropTargetDate, setDropTargetDate] = useState<string | null>(null);
  const [savingIncomeKey, setSavingIncomeKey] = useState<string | null>(null);
  const [isAssigning, setIsAssigning] = useState(false);
  const [showReconciliation, setShowReconciliation] = useState(false);
  const [dismissedReconciliation, setDismissedReconciliation] = useState(false);
  const [isApplyingFixes, setIsApplyingFixes] = useState(false);
  const [recommendationsExpanded, setRecommendationsExpanded] = useState(false);
  const [pendingAssignment, setPendingAssignment] = useState<PendingAssignment | null>(null);

  // Calculate total goal deposits from all paychecks
  const totalGoalDeposits = useMemo(() => {
    if (!schedule?.paychecks) return 0;
    return schedule.paychecks.reduce((sum, p) => sum + p.totalGoalDeposits, 0);
  }, [schedule?.paychecks]);

  // Determine if there are actionable recommendations (not just informational)
  const hasActionableRecommendations = useMemo(() => {
    if (!schedule?.recommendations) return false;
    return schedule.recommendations.some(rec => 
      rec.toLowerCase().includes('shortfall') || 
      rec.toLowerCase().includes('deficit') ||
      rec.includes("couldn't be resolved") ||
      rec.includes('consuming over 90%')
    );
  }, [schedule?.recommendations]);

  // Auto-expand recommendations if there are actionable items
  useEffect(() => {
    setRecommendationsExpanded(hasActionableRecommendations);
  }, [hasActionableRecommendations]);

  // Check if reconciliation is needed when schedule changes
  useEffect(() => {
    if (schedule?.reconciliation?.needsReconciliation && !dismissedReconciliation) {
      setShowReconciliation(true);
    } else {
      setShowReconciliation(false);
    }
  }, [schedule?.reconciliation?.needsReconciliation, dismissedReconciliation]);

  // Reset dismissed state when schedule parameters change
  useEffect(() => {
    setDismissedReconciliation(false);
  }, [startDate, startingBalance]);

  const handleApplyFixes = useCallback(async (fixes: ProposedFix[]) => {
    setIsApplyingFixes(true);
    try {
      if (isQuickBudget) {
        const result = await window.electronAPI.reconciliation.applyFixes(
          fixes.map(f => ({
            id: f.id,
            type: f.type,
            billId: f.billId,
            billDueDate: f.billDueDate,
            fromPaycheckDate: f.fromPaycheckDate,
            toPaycheckDate: f.toPaycheckDate,
          }))
        );
        if (result.success) {
          setShowReconciliation(false);
          setDismissedReconciliation(false);
          generateSchedule(startDate, months, startingBalance, { force: true });
        }
      } else if (draft.applyReconciliationFixes(fixes)) {
        setShowReconciliation(false);
        setDismissedReconciliation(false);
        generateSchedule(startDate, months, startingBalance, { force: true });
      }
    } catch {
      // Error handling done through UI state
    } finally {
      setIsApplyingFixes(false);
    }
  }, [generateSchedule, startDate, months, startingBalance, isQuickBudget, draft]);

  const handleSkipReconciliation = useCallback(() => {
    setDismissedReconciliation(true);
    setShowReconciliation(false);
  }, []);

  const dataHash = useMemo(
    () =>
      buildScheduleInputHash({
        incomes,
        bills,
        skippedBills: draft.skippedBills,
        billAssignments: draft.billAssignments,
        incomeOverrides: draft.incomeOverrides,
        budgetFields: draft.budgetFields,
      }),
    [
      incomes,
      bills,
      draft.skippedBills,
      draft.billAssignments,
      draft.incomeOverrides,
      draft.budgetFields,
    ]
  );

  useEffect(() => {
    if (incomes.length > 0 || bills.length > 0) {
      generateSchedule(startDate, months, startingBalance);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: months excluded; viewport changes filter cached schedule
  }, [startDate, startingBalance, dataHash]);

  const handleRefresh = () => {
    generateSchedule(startDate, months, startingBalance, { force: true });
  };

  const handleSkipBill = useCallback(async (billId: string, paycheckDate: string) => {
    setSkippingBill(`${billId}-${paycheckDate}`);
    try {
      if (isQuickBudget) {
        const result = await window.electronAPI.skippedBills.skip(billId, paycheckDate);
        if (result.success) {
          await draft.reloadSnapshot();
          generateSchedule(startDate, months, startingBalance, { force: true });
        }
      } else if (draft.skipBill(billId, paycheckDate)) {
        generateSchedule(startDate, months, startingBalance, { force: true });
      }
    } catch {
      // Error handling done through UI state
    } finally {
      setSkippingBill(null);
    }
  }, [generateSchedule, startDate, months, startingBalance, isQuickBudget, draft]);

  const handleRestoreBill = useCallback(async (billId: string, billDueDate: string) => {
    setRestoringBill(`${billId}-${billDueDate}`);
    try {
      if (isQuickBudget) {
        const result = await window.electronAPI.billAssignments.remove(billId, billDueDate);
        if (result.success) {
          await draft.reloadSnapshot();
        }
      } else {
        draft.removeBillAssignment(billId, billDueDate);
      }
    } catch {
      // Error handling done through UI state
    } finally {
      setRestoringBill(null);
    }
  }, [isQuickBudget, draft]);

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

  const handleDragOver = useCallback((e: DragEvent, paycheckDate: string) => {
    e.preventDefault();
    if (draggedBill && paycheckDate !== draggedBill.sourcePaycheckDate) {
      setDropTargetDate(paycheckDate);
    }
  }, [draggedBill]);

  const handleDragLeave = useCallback(() => {
    setDropTargetDate(null);
  }, []);

  const handleSaveIncomeOverride = useCallback(async (incomeId: string, paycheckDate: string, amount: number) => {
    const key = `${incomeId}-${paycheckDate}`;
    setSavingIncomeKey(key);
    try {
      if (isQuickBudget) {
        const result = await window.electronAPI.incomeOverrides.set(incomeId, paycheckDate, amount);
        if (result.success) {
          await draft.reloadSnapshot();
          await generateSchedule(startDate, months, startingBalance, { force: true });
        }
      } else if (draft.setIncomeOverride(incomeId, paycheckDate, amount)) {
        await generateSchedule(startDate, months, startingBalance, { force: true });
      }
    } finally {
      setSavingIncomeKey(null);
    }
  }, [generateSchedule, startDate, months, startingBalance, isQuickBudget, draft]);

  const handleClearIncomeOverride = useCallback(async (incomeId: string, paycheckDate: string) => {
    const key = `${incomeId}-${paycheckDate}`;
    setSavingIncomeKey(key);
    try {
      if (isQuickBudget) {
        const result = await window.electronAPI.incomeOverrides.remove(incomeId, paycheckDate);
        if (result.success) {
          await draft.reloadSnapshot();
          await generateSchedule(startDate, months, startingBalance, { force: true });
        }
      } else if (draft.removeIncomeOverride(incomeId, paycheckDate)) {
        await generateSchedule(startDate, months, startingBalance, { force: true });
      }
    } finally {
      setSavingIncomeKey(null);
    }
  }, [generateSchedule, startDate, months, startingBalance, isQuickBudget, draft]);

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
          await draft.reloadSnapshot();
          generateSchedule(startDate, months, startingBalance, { force: true });
        }
      } else {
        draft.assignBill(billId, billDueDate, targetPaycheckDate);
      }
    } catch {
      // Error handling done through UI state
    } finally {
      setIsAssigning(false);
    }
  }, [generateSchedule, startDate, months, startingBalance, isQuickBudget, draft]);

  const handleDrop = useCallback(async (e: DragEvent, targetPaycheckDate: string) => {
    e.preventDefault();
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
  }, [draggedBill, applyBillAssignment]);

  const handleConfirmAssignment = useCallback(async () => {
    if (!pendingAssignment) return;
    await applyBillAssignment(
      pendingAssignment.billId,
      pendingAssignment.billDueDate,
      pendingAssignment.paycheckDate
    );
    setPendingAssignment(null);
  }, [pendingAssignment, applyBillAssignment]);

  const togglePaycheck = useCallback((date: string) => {
    setExpandedPaychecks(prev => {
      const next = new Set(prev);
      if (next.has(date)) {
        next.delete(date);
      } else {
        next.add(date);
      }
      return next;
    });
  }, []);

  const expandAll = () => {
    if (schedule?.paychecks) {
      setExpandedPaychecks(new Set(schedule.paychecks.map(p => p.date)));
    }
  };

  const collapseAll = () => {
    setExpandedPaychecks(new Set());
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  if (!schedule && (incomes.length === 0 && bills.length === 0)) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold">Payment Schedule</h2>
          <p className="text-[var(--color-text-secondary)]">
            View your optimized payment schedule
          </p>
        </div>
        
        <div className="card text-center py-16">
          <Calendar className="w-16 h-16 text-[var(--color-text-muted)] mx-auto mb-4" />
          <h3 className="text-lg font-medium mb-2">No Schedule Available</h3>
          <p className="text-[var(--color-text-secondary)] max-w-md mx-auto">
            Add income sources and bills to generate an optimized payment schedule.
          </p>
        </div>
      </div>
    );
  }

  // Show reconciliation page when needed
  if (showReconciliation && schedule?.reconciliation) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold">Payment Schedule</h2>
          <p className="text-[var(--color-text-secondary)]">
            {schedule ? `${format(parseISO(schedule.startDate), 'MMM d, yyyy')} - ${format(parseISO(schedule.endDate), 'MMM d, yyyy')}` : 'Loading...'}
          </p>
        </div>
        
        <ReconciliationPage
          report={schedule.reconciliation}
          onApplyFixes={handleApplyFixes}
          onSkip={handleSkipReconciliation}
          isApplying={isApplyingFixes}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Payment Schedule</h2>
          <p className="text-[var(--color-text-secondary)]">
            {schedule ? `${format(parseISO(schedule.startDate), 'MMM d, yyyy')} - ${format(parseISO(schedule.endDate), 'MMM d, yyyy')}` : 'Loading...'}
          </p>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-[var(--color-bg-secondary)] rounded-lg p-1">
            <button
              onClick={() => setViewMode('paycheck')}
              className={clsx(
                'p-2 rounded-md transition-colors',
                viewMode === 'paycheck' ? 'bg-[var(--color-bg-primary)] shadow-sm' : 'hover:bg-[var(--color-bg-tertiary)]'
              )}
              title="Paycheck View"
            >
              <List className="w-5 h-5" />
            </button>
            <button
              onClick={() => setViewMode('calendar')}
              className={clsx(
                'p-2 rounded-md transition-colors',
                viewMode === 'calendar' ? 'bg-[var(--color-bg-primary)] shadow-sm' : 'hover:bg-[var(--color-bg-tertiary)]'
              )}
              title="Calendar View"
            >
              <Calendar className="w-5 h-5" />
            </button>
          </div>
          
          <button
            onClick={handleRefresh}
            disabled={isLoading}
            className="btn-secondary"
          >
            <RefreshCw className={clsx('w-5 h-5 mr-2', isLoading && 'animate-spin')} />
            Refresh
          </button>
        </div>
      </div>

      <ScheduleControls
        startDate={startDate}
        months={months}
        startingBalance={startingBalance}
        isLoading={isLoading}
        onStartDateChange={setStartDate}
        onMonthsChange={setMonths}
        onStartingBalanceChange={setStartingBalance}
        onGenerate={handleRefresh}
      />

      {schedule?.summary && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div className="card">
            <p className="text-sm text-[var(--color-text-secondary)] mb-1">Total Income</p>
            <p className="text-xl font-semibold text-success-500">{formatCurrency(schedule.summary.totalIncome)}</p>
          </div>
          <div className="card">
            <p className="text-sm text-[var(--color-text-secondary)] mb-1">Total Expenses</p>
            <p className="text-xl font-semibold text-danger-500">{formatCurrency(schedule.summary.totalExpenses)}</p>
          </div>
          <div className="card">
            <p className="text-sm text-[var(--color-text-secondary)] mb-1">Net Balance</p>
            <p className={clsx(
              'text-xl font-semibold',
              schedule.summary.netBalance >= 0 ? 'text-success-500' : 'text-danger-500'
            )}>
              {formatCurrency(schedule.summary.netBalance)}
            </p>
          </div>
          <div className="card bg-primary-50 dark:bg-primary-500/10 border-primary-200 dark:border-primary-800">
            <div className="flex items-center gap-2 mb-1">
              <PiggyBank className="w-4 h-4 text-primary-500" />
              <p className="text-sm text-primary-700 dark:text-primary-400">Total Saved</p>
            </div>
            <p className="text-xl font-semibold text-primary-600 dark:text-primary-400">
              {formatCurrency(schedule.summary.finalSavingsBalance)}
            </p>
          </div>
          <div className="card bg-success-50 dark:bg-success-500/10 border-success-200 dark:border-success-800">
            <div className="flex items-center gap-2 mb-1">
              <Target className="w-4 h-4 text-success-500" />
              <p className="text-sm text-success-700 dark:text-success-400">Goals Total</p>
            </div>
            <p className="text-xl font-semibold text-success-600 dark:text-success-400">
              {formatCurrency(totalGoalDeposits)}
            </p>
          </div>
          <div className="card">
            <p className="text-sm text-[var(--color-text-secondary)] mb-1">Shortfalls</p>
            <p className={clsx(
              'text-xl font-semibold',
              schedule.summary.shortfallCount > 0 ? 'text-warning-500' : 'text-[var(--color-text-primary)]'
            )}>
              {schedule.summary.shortfallCount}
            </p>
          </div>
        </div>
      )}

      {dismissedReconciliation && schedule?.reconciliation?.needsReconciliation && (
        <div className="card border-warning-300 dark:border-warning-700 bg-warning-50 dark:bg-warning-900/30">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-warning-600 dark:text-warning-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-semibold text-warning-900 dark:text-warning-100">
                Budget Has Unresolved Shortfalls
              </h3>
              <p className="text-sm text-warning-800 dark:text-warning-200 mt-1">
                {schedule.reconciliation.shortfalls.length} paycheck{schedule.reconciliation.shortfalls.length !== 1 ? 's' : ''} have 
                negative balances totaling ${schedule.reconciliation.totalDeficit.toLocaleString('en-US', { minimumFractionDigits: 2 })}.
                {schedule.reconciliation.proposedFixes.length > 0 && (
                  <button 
                    onClick={() => {
                      setDismissedReconciliation(false);
                      setShowReconciliation(true);
                    }}
                    className="ml-2 text-warning-700 dark:text-warning-300 underline hover:no-underline"
                  >
                    View suggested fixes
                  </button>
                )}
              </p>
            </div>
          </div>
        </div>
      )}

      {schedule?.recommendations && schedule.recommendations.length > 0 && (
        <div className={clsx(
          'card',
          hasActionableRecommendations 
            ? 'border-warning-300 dark:border-warning-700 bg-warning-50 dark:bg-warning-900/30'
            : 'border-primary-200 dark:border-primary-800 bg-primary-50 dark:bg-primary-500/10'
        )}>
          <button
            onClick={() => setRecommendationsExpanded(!recommendationsExpanded)}
            className="w-full flex items-center justify-between text-left"
          >
            <h3 className={clsx(
              'font-semibold',
              hasActionableRecommendations
                ? 'text-warning-700 dark:text-warning-400'
                : 'text-primary-700 dark:text-primary-400'
            )}>
              {hasActionableRecommendations ? 'Action Recommended' : 'Budget Insights'}
            </h3>
            <ChevronDown className={clsx(
              'w-5 h-5 transition-transform',
              hasActionableRecommendations
                ? 'text-warning-600 dark:text-warning-400'
                : 'text-primary-600 dark:text-primary-400',
              recommendationsExpanded && 'rotate-180'
            )} />
          </button>
          {recommendationsExpanded && (
            <ul className="space-y-2 mt-3">
              {schedule.recommendations.map((rec, index) => (
                <li key={index} className={clsx(
                  'flex items-start gap-2 text-sm',
                  hasActionableRecommendations
                    ? 'text-warning-700 dark:text-warning-300'
                    : 'text-primary-700 dark:text-primary-300'
                )}>
                  <span className={clsx(
                    'mt-0.5',
                    hasActionableRecommendations ? 'text-warning-500' : 'text-primary-500'
                  )}>→</span>
                  {rec}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {viewMode === 'paycheck' ? (
        <PaycheckView 
          paychecks={schedule?.paychecks || []} 
          expandedPaychecks={expandedPaychecks}
          togglePaycheck={togglePaycheck}
          expandAll={expandAll}
          collapseAll={collapseAll}
          formatCurrency={formatCurrency}
          maxBudgetRemaining={schedule?.maxBudgetRemaining || 250}
          onSkipBill={handleSkipBill}
          skippingBill={skippingBill}
          onRestoreBill={handleRestoreBill}
          restoringBill={restoringBill}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          draggedBill={draggedBill}
          dropTargetDate={dropTargetDate}
          billAssignments={billAssignments}
          isAssigning={isAssigning}
          incomeOverrides={incomeOverrides}
          onSaveIncomeOverride={handleSaveIncomeOverride}
          onClearIncomeOverride={handleClearIncomeOverride}
          savingIncomeKey={savingIncomeKey}
        />
      ) : (
        <CalendarView paychecks={schedule?.paychecks || []} />
      )}

      <ConfirmDialog
        isOpen={pendingAssignment !== null}
        onClose={() => setPendingAssignment(null)}
        onConfirm={handleConfirmAssignment}
        title="Unusual bill assignment"
        message={
          pendingAssignment
            ? `This bill is due ${format(parseISO(pendingAssignment.billDueDate), 'MMM d, yyyy')} but assigned to ${format(parseISO(pendingAssignment.paycheckDate), 'MMM d, yyyy')}. Continue?`
            : ''
        }
        confirmText="Continue"
        variant="warning"
      />
    </div>
  );
}
