import { useState, useEffect, useMemo, useCallback } from 'react';
import { Calendar, List, RefreshCw } from 'lucide-react';
import { useDraftData, useSchedule } from '../context/DraftContext';
import { useBudget } from '../context/BudgetContext';
import { format, parseISO } from 'date-fns';
import { PaycheckEntry } from '../types';
import clsx from 'clsx';
import ReconciliationPage from '../components/ReconciliationPage';
import ConfirmDialog from '../components/ConfirmDialog';
import {
  PaycheckView,
  CalendarView,
  ScheduleControls,
  ScheduleSummaryCards,
  ReconciliationBanner,
  ScheduleRecommendations,
  BreakGlassAdvisorPanel,
} from '../components/schedule';
import { formatCurrency } from '../utils/formatCurrency';
import { useBillDragAssignment } from '../hooks/useBillDragAssignment';
import { useScheduleMutations } from '../hooks/useScheduleMutations';
import { useToast } from '../components/Toast';

type ViewMode = 'paycheck' | 'calendar';

const EMPTY_PAYCHECKS: PaycheckEntry[] = [];

export default function SchedulePage() {
  const {
    schedule, 
    generateSchedule, 
    isLoading,
    scheduleStartDate: startDate,
    scheduleMonths: months,
    scheduleStartingBalance: startingBalance,
    scheduleInputHash,
    setScheduleStartDate: setStartDate,
    setScheduleMonths: setMonths,
    setScheduleStartingBalance: setStartingBalance,
  } = useSchedule();
  const { currentBudget } = useBudget();
  const { incomes, bills, billAssignments, incomeOverrides } = useDraftData();
  const { showToast } = useToast();
  const [viewMode, setViewMode] = useState<ViewMode>('paycheck');
  const [expandedPaychecks, setExpandedPaychecks] = useState<Set<string>>(new Set());
  const [recommendationsExpanded, setRecommendationsExpanded] = useState(false);
  const {
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
    isApplyingBreakGlass,
    handleAcceptBreakGlassPlan,
    handleDeclineBreakGlassPlan,
    handleSkipBill,
    handleUnskipBill,
    handleRestoreBill,
    handleSaveIncomeOverride,
    handleClearIncomeOverride,
  } = useScheduleMutations();
  const {
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
  } = useBillDragAssignment();

  // Calculate total goal deposits from all paychecks
  const totalGoalDeposits = useMemo(() => {
    if (!schedule?.paychecks) return 0;
    return schedule.paychecks.reduce((sum, p) => sum + p.totalGoalDeposits, 0);
  }, [schedule?.paychecks]);

  // Goal-anchored viewport shortcuts derive from the computed projections so the
  // dropdown can offer a "Through <goal>" option per goal.
  const goalViewportSources = useMemo(
    () =>
      (schedule?.goalProjections ?? []).map((p) => ({
        goalName: p.goalName,
        targetDate: p.targetDate,
      })),
    [schedule?.goalProjections]
  );

  // At-risk status comes from the full-horizon goal projections (not the viewport
  // slice), so the warning is accurate regardless of the visible window.
  const hasAtRiskGoals = useMemo(
    () => (schedule?.goalProjections ?? []).some((p) => p.status !== 'achievable'),
    [schedule?.goalProjections]
  );

  // Determine if there are actionable recommendations (not just informational)
  const hasActionableRecommendations = useMemo(() => {
    if (!schedule?.recommendations) return false;
    return schedule.recommendations.some(rec => 
      rec.toLowerCase().includes('shortfall') || 
      rec.toLowerCase().includes('deficit') ||
      rec.includes("couldn't be resolved") ||
      rec.includes('consuming over 90%') ||
      rec.includes('consuming the available surplus')
    );
  }, [schedule?.recommendations]);

  // Auto-expand recommendations if there are actionable items
  useEffect(() => {
    setRecommendationsExpanded(hasActionableRecommendations);
  }, [hasActionableRecommendations]);

  useEffect(() => {
    if (incomes.length > 0 || bills.length > 0) {
      generateSchedule(startDate, months, startingBalance);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: months excluded; viewport changes filter cached schedule
  }, [startDate, startingBalance, scheduleInputHash]);

  const handleRefresh = async () => {
    const result = await generateSchedule(startDate, months, startingBalance, { force: true });
    if (result) {
      showToast('success', 'Schedule refreshed');
    } else {
      showToast('error', 'Failed to refresh schedule');
    }
  };

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

  const expandAll = useCallback(() => {
    if (schedule?.paychecks) {
      setExpandedPaychecks(new Set(schedule.paychecks.map(p => p.date)));
    }
  }, [schedule?.paychecks]);

  const collapseAll = useCallback(() => {
    setExpandedPaychecks(new Set());
  }, []);

  if (!schedule && (incomes.length === 0 && bills.length === 0)) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold">Payment Schedule</h2>
          <p className="text-(--color-text-secondary)">
            View your optimized payment schedule
          </p>
        </div>
        
        <div className="card text-center py-16">
          <Calendar className="w-16 h-16 text-(--color-text-muted) mx-auto mb-4" />
          <h3 className="text-lg font-medium mb-2">No Schedule Available</h3>
          <p className="text-(--color-text-secondary) max-w-md mx-auto">
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
          <p className="text-(--color-text-secondary)">
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
          <p className="text-(--color-text-secondary)">
            {schedule ? `${format(parseISO(schedule.startDate), 'MMM d, yyyy')} - ${format(parseISO(schedule.endDate), 'MMM d, yyyy')}` : 'Loading...'}
          </p>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-(--color-bg-secondary) rounded-lg p-1">
            <button
              onClick={() => setViewMode('paycheck')}
              className={clsx(
                'p-2 rounded-md transition-colors',
                viewMode === 'paycheck' ? 'bg-(--color-bg-primary) shadow-xs' : 'hover:bg-(--color-bg-tertiary)'
              )}
              title="Paycheck View"
            >
              <List className="w-5 h-5" />
            </button>
            <button
              onClick={() => setViewMode('calendar')}
              className={clsx(
                'p-2 rounded-md transition-colors',
                viewMode === 'calendar' ? 'bg-(--color-bg-primary) shadow-xs' : 'hover:bg-(--color-bg-tertiary)'
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
        calculationMonths={schedule?.calculationMonths}
        goals={goalViewportSources}
        onStartDateChange={setStartDate}
        onMonthsChange={setMonths}
        onStartingBalanceChange={setStartingBalance}
      />

      {schedule?.summary && (
        <ScheduleSummaryCards
          summary={schedule.summary}
          totalGoalDeposits={totalGoalDeposits}
          hasAtRiskGoals={hasAtRiskGoals}
        />
      )}

      {dismissedReconciliation && schedule?.reconciliation?.needsReconciliation && (
        <ReconciliationBanner
          shortfallCount={schedule.summary.shortfallCount}
          totalDeficit={schedule.reconciliation.totalDeficit}
          hasProposedFixes={schedule.reconciliation.proposedFixes.length > 0}
          onViewSuggestedFixes={() => {
            setDismissedReconciliation(false);
            setShowReconciliation(true);
          }}
        />
      )}

      {visibleBreakGlassPlans.length > 0 || isApplyingBreakGlass ? (
        <BreakGlassAdvisorPanel
          plans={visibleBreakGlassPlans}
          onAccept={handleAcceptBreakGlassPlan}
          onDecline={handleDeclineBreakGlassPlan}
          isApplying={isApplyingBreakGlass}
        />
      ) : null}

      {(isLoading || isApplyingBreakGlass) && (
        <div
          className="fixed top-14 bottom-0 left-64 right-0 z-40 flex items-center justify-center bg-black/20 dark:bg-black/40"
          role="status"
          aria-live="polite"
          data-testid="schedule-busy-overlay"
        >
          <div className="rounded-xl bg-(--color-bg-primary) border border-(--color-border) shadow-lg px-6 py-5 flex items-center gap-3 max-w-md mx-4">
            <RefreshCw className="w-5 h-5 text-primary-500 animate-spin shrink-0" />
            <div>
              <p className="font-medium text-(--color-text-primary)">
                {isApplyingBreakGlass ? 'Applying adjustments…' : 'Building schedule…'}
              </p>
              <p className="text-sm text-(--color-text-secondary)">
                This can take a few seconds for a full-year projection.
              </p>
            </div>
          </div>
        </div>
      )}

      {schedule?.recommendations && schedule.recommendations.length > 0 && (
        <ScheduleRecommendations
          recommendations={schedule.recommendations}
          hasActionableRecommendations={hasActionableRecommendations}
          expanded={recommendationsExpanded}
          onToggle={() => setRecommendationsExpanded(!recommendationsExpanded)}
        />
      )}

      {viewMode === 'paycheck' ? (
        <PaycheckView 
          paychecks={schedule?.paychecks ?? EMPTY_PAYCHECKS} 
          expandedPaychecks={expandedPaychecks}
          togglePaycheck={togglePaycheck}
          expandAll={expandAll}
          collapseAll={collapseAll}
          formatCurrency={formatCurrency}
          maxBudgetRemaining={schedule?.maxBudgetRemaining ?? currentBudget?.targetCashOnHand ?? 250}
          minCashOnHand={schedule?.minCashOnHand ?? currentBudget?.minCashOnHand ?? 100}
          onSkipBill={handleSkipBill}
          onUnskipBill={handleUnskipBill}
          skippingBill={skippingBill}
          unskippingBill={unskippingBill}
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
        <CalendarView paychecks={schedule?.paychecks ?? EMPTY_PAYCHECKS} />
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
