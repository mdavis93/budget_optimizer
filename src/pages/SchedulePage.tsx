import { useState, useEffect, useMemo, useCallback, DragEvent } from 'react';
import { Calendar, List, AlertTriangle, RefreshCw, Wallet, Receipt, ChevronDown, ChevronUp, PiggyBank, TrendingUp, SkipForward, GripVertical, Target } from 'lucide-react';
import { useData } from '../context/DataContext';
import { format, parseISO, startOfMonth, isSameDay, getMonth, getYear } from 'date-fns';
import { PaycheckEntry, PaycheckBill, PRIORITY_LABELS, BillAssignment, ProposedFix } from '../types';
import clsx from 'clsx';
import ReconciliationPage from '../components/ReconciliationPage';

interface DraggedBill {
  billId: string;
  creditorName: string;
  amount: number;
  sourcePaycheckDate: string;
  dueDay: number;
  billDate: string; // The actual projected due date of the bill
}

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
    } catch (error) {
      console.error('Failed to apply fixes:', error);
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
    const loadAssignments = async () => {
      const result = await window.electronAPI.billAssignments.getAll();
      if (result.success && result.data) {
        setBillAssignments(result.data);
      }
    };
    loadAssignments();
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
    } catch (error) {
      console.error('[UI] Failed to skip bill:', error);
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
    } catch (error) {
      console.error('[DND] Failed to assign bill:', error);
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

      <div className="card">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label htmlFor="schedule-start-date" className="label">Start Date</label>
            <input
              id="schedule-start-date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="input"
            />
          </div>
          
          <div>
            <label htmlFor="schedule-duration" className="label">Duration</label>
            <select
              id="schedule-duration"
              value={months}
              onChange={(e) => setMonths(parseInt(e.target.value))}
              className="input"
            >
              <option value={1}>1 Month</option>
              <option value={3}>3 Months</option>
              <option value={6}>6 Months</option>
              <option value={12}>12 Months</option>
            </select>
          </div>
          
          <div>
            <label htmlFor="schedule-starting-balance" className="label">Starting Balance</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]">$</span>
              <input
                id="schedule-starting-balance"
                type="number"
                value={startingBalance}
                onChange={(e) => setStartingBalance(parseFloat(e.target.value) || 0)}
                className="input pl-7"
                placeholder="0.00"
              />
            </div>
          </div>
          
          <div className="flex items-end">
            <button
              onClick={handleRefresh}
              disabled={isLoading}
              className="btn-primary w-full"
            >
              Generate Schedule
            </button>
          </div>
        </div>
      </div>

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

interface PaycheckViewProps {
  paychecks: PaycheckEntry[];
  expandedPaychecks: Set<string>;
  togglePaycheck: (date: string) => void;
  expandAll: () => void;
  collapseAll: () => void;
  formatCurrency: (amount: number) => string;
  maxBudgetRemaining: number;
  onSkipBill: (billId: string, paycheckDate: string) => void;
  skippingBill: string | null;
  onDragStart: (bill: PaycheckBill, sourcePaycheckDate: string) => void;
  onDragEnd: () => void;
  onDragOver: (e: DragEvent<HTMLDivElement>, paycheckDate: string) => void;
  onDragLeave: () => void;
  onDrop: (e: DragEvent<HTMLDivElement>, targetPaycheckDate: string) => void;
  draggedBill: DraggedBill | null;
  dropTargetDate: string | null;
  billAssignments: BillAssignment[];
  isAssigning: boolean;
}

function PaycheckView({ 
  paychecks, 
  expandedPaychecks, 
  togglePaycheck, 
  expandAll, 
  collapseAll,
  formatCurrency,
  maxBudgetRemaining,
  onSkipBill,
  skippingBill,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  draggedBill,
  dropTargetDate,
  billAssignments,
  isAssigning
}: PaycheckViewProps) {
  if (paychecks.length === 0) {
    return (
      <div className="card text-center py-12">
        <p className="text-[var(--color-text-muted)]">No paychecks in the selected period</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Paychecks ({paychecks.length})</h3>
          <p className="text-xs text-[var(--color-text-muted)]">
            Budget cap: {formatCurrency(maxBudgetRemaining)} • Excess automatically transferred to savings
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={expandAll} className="btn-ghost text-sm">
            Expand All
          </button>
          <button onClick={collapseAll} className="btn-ghost text-sm">
            Collapse All
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {paychecks.map((paycheck) => {
          const isExpanded = expandedPaychecks.has(paycheck.date);
          const isDropTarget = dropTargetDate === paycheck.date;
          const isDragSource = draggedBill?.sourcePaycheckDate === paycheck.date;
          
          return (
            <div 
              key={paycheck.date}
              className={clsx(
                'card overflow-hidden transition-all',
                paycheck.isShortfall && 'border-danger-300 dark:border-danger-700 bg-danger-50/50 dark:bg-danger-500/5',
                isDropTarget && 'ring-2 ring-primary-500 ring-offset-2 bg-primary-50/50 dark:bg-primary-500/10',
                isDragSource && 'opacity-50'
              )}
              onDragOver={(e) => onDragOver(e, paycheck.date)}
              onDragLeave={onDragLeave}
              onDrop={(e) => onDrop(e, paycheck.date)}
            >
              <button
                onClick={() => togglePaycheck(paycheck.date)}
                aria-expanded={isExpanded}
                aria-label={`${isExpanded ? 'Collapse' : 'Expand'} paycheck for ${format(parseISO(paycheck.date), 'MMMM d, yyyy')}`}
                className="w-full flex items-center justify-between p-0 text-left"
              >
                <div className="flex items-center gap-4">
                  <div className={clsx(
                    'p-3 rounded-lg',
                    paycheck.isShortfall 
                      ? 'bg-danger-100 dark:bg-danger-500/20' 
                      : 'bg-success-100 dark:bg-success-500/20'
                  )}>
                    <Wallet className={clsx(
                      'w-6 h-6',
                      paycheck.isShortfall 
                        ? 'text-danger-600 dark:text-danger-500' 
                        : 'text-success-600 dark:text-success-500'
                    )} />
                  </div>
                  <div>
                    <p className="font-semibold text-lg">
                      {format(parseISO(paycheck.date), 'EEEE, MMMM d, yyyy')}
                    </p>
                    <div className="flex items-center gap-4 text-sm text-[var(--color-text-secondary)]">
                      <span>{paycheck.incomeSources.map(s => s.name).join(' + ')}</span>
                      <span>•</span>
                      <span>{paycheck.bills.length} bill{paycheck.bills.length !== 1 ? 's' : ''}</span>
                      {paycheck.goalDeposits && paycheck.goalDeposits.length > 0 && (
                        <>
                          <span>•</span>
                          <span className="text-purple-500 flex items-center gap-1">
                            <Target className="w-3 h-3" />
                            {formatCurrency(paycheck.totalGoalDeposits)} to goals
                          </span>
                        </>
                      )}
                      {paycheck.savingsDeposit > 0 && (
                        <>
                          <span>•</span>
                          <span className="text-primary-500 flex items-center gap-1">
                            <PiggyBank className="w-3 h-3" />
                            {formatCurrency(paycheck.savingsDeposit)} to savings
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center gap-6">
                  <div className="text-right">
                    <p className="text-xs text-[var(--color-text-muted)]">Budget Remaining</p>
                    <p className={clsx(
                      'text-xl font-semibold font-mono',
                      paycheck.budgetRemaining >= 0 ? 'text-success-500' : 'text-danger-500'
                    )}>
                      {formatCurrency(paycheck.budgetRemaining)}
                    </p>
                  </div>
                  {paycheck.isShortfall && (
                    <AlertTriangle className="w-6 h-6 text-danger-500" />
                  )}
                  {isExpanded ? (
                    <ChevronUp className="w-5 h-5 text-[var(--color-text-muted)]" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-[var(--color-text-muted)]" />
                  )}
                </div>
              </button>
              
              {isExpanded && (
                <div className="mt-4 pt-4 border-t border-[var(--color-border)]">
                  <div className="space-y-4">
                    <div>
                      <h4 className="text-sm font-medium text-[var(--color-text-secondary)] mb-2 flex items-center gap-2">
                        <Wallet className="w-4 h-4" />
                        Income
                      </h4>
                      <div className="space-y-2">
                        {paycheck.incomeSources.map((source, idx) => (
                          <div key={idx} className="flex items-center justify-between py-2 px-3 bg-success-50 dark:bg-success-500/10 rounded-lg">
                            <span className="font-medium">{source.name}</span>
                            <span className="font-mono font-semibold text-success-600 dark:text-success-500">
                              +{formatCurrency(source.amount)}
                            </span>
                          </div>
                        ))}
                        <div className="flex items-center justify-between py-2 px-3 bg-[var(--color-bg-tertiary)] rounded-lg font-semibold">
                          <span>Total Income</span>
                          <span className="font-mono text-success-600 dark:text-success-500">
                            +{formatCurrency(paycheck.totalIncome)}
                          </span>
                        </div>
                      </div>
                    </div>
                    
                    {paycheck.bills.length > 0 && (
                      <div>
                        <h4 className="text-sm font-medium text-[var(--color-text-secondary)] mb-2 flex items-center gap-2">
                          <Receipt className="w-4 h-4" />
                          Bills to Pay ({paycheck.bills.length})
                          <span className="text-xs text-[var(--color-text-muted)]">• Drag bills to move between paychecks</span>
                          {isAssigning && <RefreshCw className="w-3 h-3 animate-spin text-primary-500" />}
                        </h4>
                        <div className="space-y-2">
                          {[...paycheck.bills].sort((a, b) => {
                            // Sort by actual bill date (month first, then day)
                            // This groups current month bills before next month bills
                            const paycheckDate = parseISO(paycheck.date);
                            const paycheckMonth = getMonth(paycheckDate);
                            const paycheckYear = getYear(paycheckDate);
                            
                            const aDate = parseISO(a.billDate);
                            const bDate = parseISO(b.billDate);
                            
                            // Calculate months difference from paycheck
                            const aMonthDiff = (getYear(aDate) - paycheckYear) * 12 + (getMonth(aDate) - paycheckMonth);
                            const bMonthDiff = (getYear(bDate) - paycheckYear) * 12 + (getMonth(bDate) - paycheckMonth);
                            
                            // Sort by month difference first, then by day
                            if (aMonthDiff !== bMonthDiff) {
                              return aMonthDiff - bMonthDiff;
                            }
                            return a.dueDay - b.dueDay;
                          }).map((bill, idx) => {
                            const isSkipping = skippingBill === `${bill.billId}-${paycheck.date}`;
                            // Check if this bill has a manual assignment by looking up using billDate
                            const isManuallyAssigned = billAssignments.some(
                              a => a.billId === bill.billId && a.billDueDate === bill.billDate
                            );
                            const isDragging = draggedBill?.billId === bill.billId && draggedBill?.billDate === bill.billDate;
                            
                            // Determine if bill is in a different month than the paycheck
                            const paycheckDate = parseISO(paycheck.date);
                            const billDate = parseISO(bill.billDate);
                            const isNextMonth = getMonth(billDate) !== getMonth(paycheckDate) || getYear(billDate) !== getYear(paycheckDate);
                            const monthName = isNextMonth ? format(billDate, 'MMM') + ' ' : '';
                            
                            return (
                              <div 
                                key={idx} 
                                draggable
                                onDragStart={() => onDragStart(bill, paycheck.date)}
                                onDragEnd={onDragEnd}
                                className={clsx(
                                  'flex items-center justify-between py-2 px-3 rounded-lg group cursor-move',
                                  isManuallyAssigned 
                                    ? 'bg-primary-50 dark:bg-primary-500/10 border-2 border-primary-300 dark:border-primary-700' 
                                    : 'bg-danger-50 dark:bg-danger-500/10',
                                  isDragging && 'opacity-50'
                                )}
                              >
                                <div className="flex items-center gap-3">
                                  <GripVertical className="w-4 h-4 text-[var(--color-text-muted)] opacity-0 group-hover:opacity-100 transition-opacity" />
                                  <span className="font-medium">{bill.creditorName}</span>
                                  {isManuallyAssigned && (
                                    <span className="text-xs px-2 py-0.5 rounded-full bg-primary-200 text-primary-800 dark:bg-primary-800 dark:text-primary-200">
                                      Moved
                                    </span>
                                  )}
                                  <span className={clsx(
                                    'text-xs px-2 py-0.5 rounded-full',
                                    bill.priority === 'critical' && 'bg-danger-200 text-danger-800 dark:bg-danger-800 dark:text-danger-200',
                                    bill.priority === 'high' && 'bg-warning-200 text-warning-800 dark:bg-warning-800 dark:text-warning-200',
                                    bill.priority === 'normal' && 'bg-primary-200 text-primary-800 dark:bg-primary-800 dark:text-primary-200',
                                    bill.priority === 'low' && 'bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
                                  )}>
                                    {PRIORITY_LABELS[bill.priority]}
                                  </span>
                                  <span className="text-xs text-[var(--color-text-muted)]">
                                    {bill.isIncomeAttached 
                                      ? 'Per Paycheck' 
                                      : `Due: ${monthName}${bill.dueDay}${bill.dueDay === 1 ? 'st' : bill.dueDay === 2 ? 'nd' : bill.dueDay === 3 ? 'rd' : 'th'}`}
                                  </span>
                                </div>
                                <div className="flex items-center gap-3">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onSkipBill(bill.billId, paycheck.date);
                                    }}
                                    disabled={isSkipping}
                                    className="opacity-0 group-hover:opacity-100 transition-opacity text-xs font-medium px-2 py-1 rounded bg-amber-500 text-white hover:bg-amber-600 dark:bg-amber-600 dark:text-white dark:hover:bg-amber-500 flex items-center gap-1 shadow-sm"
                                    title="Skip this payment (already paid or not due)"
                                  >
                                    <SkipForward className="w-3 h-3" />
                                    {isSkipping ? 'Skipping...' : 'Skip'}
                                  </button>
                                  <span className="font-mono font-semibold text-danger-600 dark:text-danger-500">
                                    -{formatCurrency(bill.amount)}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                          <div className="flex items-center justify-between py-2 px-3 bg-[var(--color-bg-tertiary)] rounded-lg font-semibold">
                            <span>Total Bills</span>
                            <span className="font-mono text-danger-600 dark:text-danger-500">
                              -{formatCurrency(paycheck.totalBills)}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

                    {paycheck.goalDeposits && paycheck.goalDeposits.length > 0 && (
                      <div>
                        <h4 className="text-sm font-medium text-[var(--color-text-secondary)] mb-2 flex items-center gap-2">
                          <Target className="w-4 h-4" />
                          Goal Deposits ({paycheck.goalDeposits.length})
                        </h4>
                        <div className="space-y-2">
                          {paycheck.goalDeposits.map((deposit, idx) => (
                            <div key={idx} className="flex items-center justify-between py-2 px-3 bg-purple-50 dark:bg-purple-500/10 rounded-lg">
                              <div className="flex items-center gap-2">
                                <Target className="w-4 h-4 text-purple-500" />
                                <span className="font-medium text-purple-700 dark:text-purple-300">Goal: {deposit.goalName}</span>
                              </div>
                              <span className="font-mono font-semibold text-purple-600 dark:text-purple-400">
                                -{formatCurrency(deposit.amount)}
                              </span>
                            </div>
                          ))}
                          {paycheck.totalGoalDeposits > 0 && (
                            <div className="flex items-center justify-between py-2 px-3 bg-[var(--color-bg-tertiary)] rounded-lg font-semibold">
                              <span>Total Goal Deposits</span>
                              <span className="font-mono text-purple-600 dark:text-purple-500">
                                -{formatCurrency(paycheck.totalGoalDeposits)}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {paycheck.savingsDeposit > 0 && (
                      <div>
                        <h4 className="text-sm font-medium text-[var(--color-text-secondary)] mb-2 flex items-center gap-2">
                          <PiggyBank className="w-4 h-4" />
                          Savings Transfer
                        </h4>
                        <div className="flex items-center justify-between py-2 px-3 bg-primary-50 dark:bg-primary-500/10 rounded-lg">
                          <div className="flex items-center gap-2">
                            <TrendingUp className="w-4 h-4 text-primary-500" />
                            <span className="font-medium text-primary-700 dark:text-primary-300">Transfer to Savings</span>
                          </div>
                          <span className="font-mono font-semibold text-primary-600 dark:text-primary-400">
                            {formatCurrency(paycheck.savingsDeposit)}
                          </span>
                        </div>
                      </div>
                    )}
                    
                    <div className="flex items-center justify-between py-3 px-4 bg-[var(--color-bg-secondary)] rounded-lg border border-[var(--color-border)]">
                      <span className="font-semibold">Budget Remaining</span>
                      <span className={clsx(
                        'text-2xl font-mono font-bold',
                        paycheck.budgetRemaining >= 0 ? 'text-success-500' : 'text-danger-500'
                      )}>
                        {formatCurrency(paycheck.budgetRemaining)}
                      </span>
                    </div>

                    <p className="text-xs text-[var(--color-text-muted)] text-center">
                      Savings Balance: {formatCurrency(paycheck.totalSavings)}
                    </p>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CalendarView({ paychecks }: { paychecks: PaycheckEntry[] }) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  
  const paychecksByDate = useMemo(() => {
    const map = new Map<string, PaycheckEntry>();
    for (const paycheck of paychecks) {
      map.set(paycheck.date, paycheck);
    }
    return map;
  }, [paychecks]);

  const calendarDays = useMemo(() => {
    const start = startOfMonth(currentMonth);
    const startDay = start.getDay();
    const daysInMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();
    
    const days: (Date | null)[] = [];
    
    for (let i = 0; i < startDay; i++) {
      days.push(null);
    }
    
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(new Date(currentMonth.getFullYear(), currentMonth.getMonth(), i));
    }
    
    return days;
  }, [currentMonth]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => setCurrentMonth(prev => new Date(prev.getFullYear(), prev.getMonth() - 1))}
          className="btn-ghost"
        >
          ← Previous
        </button>
        <h3 className="font-semibold text-lg">
          {format(currentMonth, 'MMMM yyyy')}
        </h3>
        <button
          onClick={() => setCurrentMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + 1))}
          className="btn-ghost"
        >
          Next →
        </button>
      </div>
      
      <div className="grid grid-cols-7 gap-px bg-[var(--color-border)] rounded-lg overflow-hidden">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
          <div key={day} className="bg-[var(--color-bg-tertiary)] p-2 text-center text-sm font-medium">
            {day}
          </div>
        ))}
        
        {calendarDays.map((day, index) => {
          if (!day) {
            return <div key={index} className="bg-[var(--color-bg-primary)] p-2 min-h-[100px]" />;
          }
          
          const dateKey = format(day, 'yyyy-MM-dd');
          const paycheck = paychecksByDate.get(dateKey);
          const isToday = isSameDay(day, new Date());
          
          return (
            <div
              key={index}
              className={clsx(
                'bg-[var(--color-bg-primary)] p-2 min-h-[100px]',
                paycheck?.isShortfall && 'bg-danger-50 dark:bg-danger-500/10',
                isToday && 'ring-2 ring-inset ring-primary-500'
              )}
            >
              <p className={clsx(
                'text-sm font-medium mb-1',
                isToday && 'text-primary-500'
              )}>
                {format(day, 'd')}
              </p>
              {paycheck && (
                <div className="space-y-1">
                  <div className="text-xs px-1 py-0.5 rounded bg-success-100 text-success-700 dark:bg-success-500/20 dark:text-success-400 truncate">
                    +{formatCurrency(paycheck.totalIncome)}
                  </div>
                  {paycheck.bills.length > 0 && (
                    <div className="text-xs px-1 py-0.5 rounded bg-danger-100 text-danger-700 dark:bg-danger-500/20 dark:text-danger-400 truncate">
                      {paycheck.bills.length} bills
                    </div>
                  )}
                  {paycheck.savingsDeposit > 0 && (
                    <div className="text-xs px-1 py-0.5 rounded bg-primary-100 text-primary-700 dark:bg-primary-500/20 dark:text-primary-400 truncate flex items-center gap-0.5">
                      <PiggyBank className="w-3 h-3" />
                      {formatCurrency(paycheck.savingsDeposit)}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
