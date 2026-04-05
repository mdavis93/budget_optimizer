import { useState, useEffect, useMemo, useCallback, DragEvent } from 'react';
import { Calendar, List, AlertTriangle, RefreshCw, PiggyBank } from 'lucide-react';
import { useData } from '../context/DataContext';
import { format, parseISO, startOfMonth } from 'date-fns';
import { PaycheckBill, BillAssignment, ProposedFix } from '../types';
import clsx from 'clsx';
import ReconciliationPage from '../components/ReconciliationPage';
import { PaycheckView, CalendarView, ScheduleControls, type DraggedBill } from '../components/schedule';

type ViewMode = 'paycheck' | 'calendar';

export default function SchedulePage() {
  const { incomes, bills, schedule, generateSchedule, isLoading } = useData();
  const [viewMode, setViewMode] = useState<ViewMode>('paycheck');
  const [startDate, setStartDate] = useState(() => format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [months, setMonths] = useState(3);
  const [startingBalance, setStartingBalance] = useState(0);
  const [expandedPaychecks, setExpandedPaychecks] = useState<Set<string>>(new Set());
  const [skippingBill, setSkippingBill] = useState<string | null>(null);
  const [draggedBill, setDraggedBill] = useState<DraggedBill | null>(null);
  const [dropTargetDate, setDropTargetDate] = useState<string | null>(null);
  const [billAssignments, setBillAssignments] = useState<BillAssignment[]>([]);
  const [isAssigning, setIsAssigning] = useState(false);
  const [showReconciliation, setShowReconciliation] = useState(false);
  const [dismissedReconciliation, setDismissedReconciliation] = useState(false);
  const [isApplyingFixes, setIsApplyingFixes] = useState(false);

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
  }, [startDate, months]);

  const handleApplyFixes = useCallback(async (fixes: ProposedFix[]) => {
    setIsApplyingFixes(true);
    try {
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
        generateSchedule(startDate, months, startingBalance);
      }
    } catch {
      // Error handling done through UI state
    } finally {
      setIsApplyingFixes(false);
    }
  }, [generateSchedule, startDate, months, startingBalance]);

  const handleSkipReconciliation = useCallback(() => {
    setDismissedReconciliation(true);
    setShowReconciliation(false);
  }, []);

  // Load bill assignments
  useEffect(() => {
    let isMounted = true;
    
    const loadAssignments = async () => {
      const result = await window.electronAPI.billAssignments.getAll();
      if (isMounted && result.success && result.data) {
        setBillAssignments(result.data);
      }
    };
    loadAssignments();
    
    return () => { isMounted = false; };
  }, [schedule]);

  // Create a stable hash of incomes and bills to detect actual data changes
  const dataHash = useMemo(() => {
    const incomeData = incomes.map(i => `${i.id}-${i.amount}-${i.sourceName}-${i.cadence}-${i.startDate}-${i.isActive}`).sort().join('|');
    const billData = bills.map(b => `${b.id}-${b.budgetedAmount}-${b.creditorName}-${b.dueDay}-${b.priority}`).sort().join('|');
    return `${incomeData}::${billData}`;
  }, [incomes, bills]);

  useEffect(() => {
    if (incomes.length > 0 || bills.length > 0) {
      generateSchedule(startDate, months, startingBalance);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: generateSchedule excluded; dataHash tracks data changes
  }, [startDate, months, startingBalance, dataHash]);

  const handleRefresh = () => {
    generateSchedule(startDate, months, startingBalance);
  };

  const handleSkipBill = useCallback(async (billId: string, paycheckDate: string) => {
    setSkippingBill(`${billId}-${paycheckDate}`);
    try {
      const result = await window.electronAPI.skippedBills.skip(billId, paycheckDate);
      if (result.success) {
        generateSchedule(startDate, months, startingBalance);
      }
    } catch {
      // Error handling done through UI state
    } finally {
      setSkippingBill(null);
    }
  }, [generateSchedule, startDate, months, startingBalance]);

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

  const handleDrop = useCallback(async (e: DragEvent, targetPaycheckDate: string) => {
    e.preventDefault();
    setDropTargetDate(null);
    
    if (!draggedBill || targetPaycheckDate === draggedBill.sourcePaycheckDate) {
      return;
    }

    setIsAssigning(true);

    try {
      // Use the actual bill due date as the key, not the paycheck date
      const billDueDate = draggedBill.billDate;
      const result = await window.electronAPI.billAssignments.assign(
        draggedBill.billId,
        billDueDate,
        targetPaycheckDate
      );
      
      if (result.success) {
        generateSchedule(startDate, months, startingBalance);
      }
    } catch {
      // Error handling done through UI state
    } finally {
      setDraggedBill(null);
      setIsAssigning(false);
    }
  }, [draggedBill, generateSchedule, startDate, months, startingBalance]);

  const togglePaycheck = (date: string) => {
    setExpandedPaychecks(prev => {
      const next = new Set(prev);
      if (next.has(date)) {
        next.delete(date);
      } else {
        next.add(date);
      }
      return next;
    });
  };

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
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
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
        <div className="card border-primary-200 dark:border-primary-800 bg-primary-50 dark:bg-primary-500/10">
          <h3 className="font-semibold mb-3 text-primary-700 dark:text-primary-400">Optimization Recommendations</h3>
          <ul className="space-y-2">
            {schedule.recommendations.map((rec, index) => (
              <li key={index} className="flex items-start gap-2 text-sm text-primary-700 dark:text-primary-300">
                <span className="text-primary-500 mt-0.5">→</span>
                {rec}
              </li>
            ))}
          </ul>
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
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          draggedBill={draggedBill}
          dropTargetDate={dropTargetDate}
          billAssignments={billAssignments}
          isAssigning={isAssigning}
        />
      ) : (
        <CalendarView paychecks={schedule?.paychecks || []} />
      )}
    </div>
  );
} 
