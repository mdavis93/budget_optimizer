import { DragEvent, useState, memo } from 'react';
import { format, parseISO, getMonth, getYear } from 'date-fns';
import { 
  Wallet, 
  Receipt, 
  ChevronDown, 
  ChevronUp, 
  PiggyBank, 
  TrendingUp, 
  SkipForward, 
  GripVertical, 
  Target,
  AlertTriangle,
  RefreshCw,
  Pencil,
  RotateCcw,
} from 'lucide-react';
import { PaycheckEntry, PaycheckBill, PRIORITY_LABELS, BillAssignment, IncomeOverride } from '../../types';
import { filterPaycheckBills, isBillMovedToPaycheck } from '../../utils/scheduleBills';
import clsx from 'clsx';

interface DraggedBill {
  billId: string;
  creditorName: string;
  amount: number;
  sourcePaycheckDate: string;
  dueDay: number;
  billDate: string;
}

interface PaycheckViewProps {
  paychecks: PaycheckEntry[];
  expandedPaychecks: Set<string>;
  togglePaycheck: (date: string) => void;
  expandAll: () => void;
  collapseAll: () => void;
  formatCurrency: (amount: number) => string;
  maxBudgetRemaining: number;
  minCashOnHand: number;
  onSkipBill: (billId: string, paycheckDate: string) => void;
  skippingBill: string | null;
  onRestoreBill: (billId: string, billDueDate: string) => void;
  restoringBill: string | null;
  onDragStart: (bill: PaycheckBill, sourcePaycheckDate: string) => void;
  onDragEnd: () => void;
  onDragOver: (e: DragEvent<HTMLDivElement>, paycheckDate: string) => void;
  onDragLeave: () => void;
  onDrop: (e: DragEvent<HTMLDivElement>, targetPaycheckDate: string) => void;
  draggedBill: DraggedBill | null;
  dropTargetDate: string | null;
  billAssignments: BillAssignment[];
  isAssigning: boolean;
  incomeOverrides: IncomeOverride[];
  onSaveIncomeOverride: (incomeId: string, paycheckDate: string, amount: number) => Promise<void>;
  onClearIncomeOverride: (incomeId: string, paycheckDate: string) => Promise<void>;
  savingIncomeKey: string | null;
}

function isBreakGlassPaycheck(
  paycheck: PaycheckEntry,
  maxBudgetRemaining: number,
  minCashOnHand: number
): boolean {
  return (
    !paycheck.isShortfall &&
    paycheck.budgetRemaining < maxBudgetRemaining &&
    paycheck.budgetRemaining >= minCashOnHand
  );
}

function PaycheckView({ 
  paychecks, 
  expandedPaychecks, 
  togglePaycheck, 
  expandAll, 
  collapseAll,
  formatCurrency,
  maxBudgetRemaining,
  minCashOnHand,
  onSkipBill,
  skippingBill,
  onRestoreBill,
  restoringBill,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  draggedBill,
  dropTargetDate,
  billAssignments,
  isAssigning,
  incomeOverrides,
  onSaveIncomeOverride,
  onClearIncomeOverride,
  savingIncomeKey,
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
            Target cash on hand: {formatCurrency(maxBudgetRemaining)} • Surplus above target funds goals and savings
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
          const visibleBills = filterPaycheckBills(paycheck.bills, billAssignments, paycheck.date);
          const unpayableCount = visibleBills.filter(bill => bill.isUnpayable).length;
          const hasUnpayableBills = unpayableCount > 0;
          const needsAttention = paycheck.isShortfall || hasUnpayableBills;
          const isBreakGlass = isBreakGlassPaycheck(paycheck, maxBudgetRemaining, minCashOnHand);
          const isExpanded = expandedPaychecks.has(paycheck.date);
          const isDropTarget = dropTargetDate === paycheck.date;
          const isDragSource = draggedBill?.sourcePaycheckDate === paycheck.date;
          
          return (
            <div 
              key={paycheck.date}
              className={clsx(
                'card overflow-hidden transition-all',
                needsAttention && 'border-danger-300 dark:border-danger-700 bg-danger-50/50 dark:bg-danger-500/5',
                isBreakGlass && !needsAttention && 'border-warning-300/70 dark:border-warning-700/50',
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
                    needsAttention 
                      ? 'bg-danger-100 dark:bg-danger-500/20' 
                      : 'bg-success-100 dark:bg-success-500/20'
                  )}>
                    <Wallet className={clsx(
                      'w-6 h-6',
                      needsAttention 
                        ? 'text-danger-600 dark:text-danger-500' 
                        : 'text-success-600 dark:text-success-500'
                    )} />
                  </div>
                  <div>
                    <p className="font-semibold text-lg flex items-center gap-2 flex-wrap">
                      {format(parseISO(paycheck.date), 'EEEE, MMMM d, yyyy')}
                      {isBreakGlass && (
                        <span
                          className="break-glass-tape text-xs font-semibold px-2 py-0.5 rounded-full text-warning-800 dark:text-warning-200"
                          title="Cash on hand is below your target but above your minimum floor"
                        >
                          Break-Glass
                        </span>
                      )}
                    </p>
                    <div className="flex items-center gap-4 text-sm text-[var(--color-text-secondary)]">
                      <span>{paycheck.incomeSources.map(s => s.name).join(' + ')}</span>
                      <span>•</span>
                      <span>{visibleBills.length} bill{visibleBills.length !== 1 ? 's' : ''}</span>
                      {hasUnpayableBills && (
                        <>
                          <span>•</span>
                          <span className="text-danger-600 dark:text-danger-400 font-semibold flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" />
                            {unpayableCount} unpayable
                          </span>
                        </>
                      )}
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
                  {needsAttention && (
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
                <PaycheckDetails
                  paycheck={paycheck}
                  formatCurrency={formatCurrency}
                  onSkipBill={onSkipBill}
                  skippingBill={skippingBill}
                  onRestoreBill={onRestoreBill}
                  restoringBill={restoringBill}
                  onDragStart={onDragStart}
                  onDragEnd={onDragEnd}
                  draggedBill={draggedBill}
                  billAssignments={billAssignments}
                  isAssigning={isAssigning}
                  incomeOverrides={incomeOverrides}
                  onSaveIncomeOverride={onSaveIncomeOverride}
                  onClearIncomeOverride={onClearIncomeOverride}
                  savingIncomeKey={savingIncomeKey}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface PaycheckDetailsProps {
  paycheck: PaycheckEntry;
  formatCurrency: (amount: number) => string;
  onSkipBill: (billId: string, paycheckDate: string) => void;
  skippingBill: string | null;
  onRestoreBill: (billId: string, billDueDate: string) => void;
  restoringBill: string | null;
  onDragStart: (bill: PaycheckBill, sourcePaycheckDate: string) => void;
  onDragEnd: () => void;
  draggedBill: DraggedBill | null;
  billAssignments: BillAssignment[];
  isAssigning: boolean;
  incomeOverrides: IncomeOverride[];
  onSaveIncomeOverride: (incomeId: string, paycheckDate: string, amount: number) => Promise<void>;
  onClearIncomeOverride: (incomeId: string, paycheckDate: string) => Promise<void>;
  savingIncomeKey: string | null;
}

function incomeOverrideRowKey(incomeId: string, paycheckDate: string): string {
  return `${incomeId}-${paycheckDate}`;
}

function hasIncomeOverride(
  overrides: IncomeOverride[],
  incomeId: string,
  paycheckDate: string
): boolean {
  return overrides.some(o => o.incomeId === incomeId && o.paycheckDate === paycheckDate);
}

function PaycheckDetails({
  paycheck,
  formatCurrency,
  onSkipBill,
  skippingBill,
  onRestoreBill,
  restoringBill,
  onDragStart,
  onDragEnd,
  draggedBill,
  billAssignments,
  isAssigning,
  incomeOverrides,
  onSaveIncomeOverride,
  onClearIncomeOverride,
  savingIncomeKey,
}: PaycheckDetailsProps) {
  const [editingIncomeKey, setEditingIncomeKey] = useState<string | null>(null);
  const [draftIncomeAmount, setDraftIncomeAmount] = useState('');
  const visibleBills = filterPaycheckBills(paycheck.bills, billAssignments, paycheck.date);
  const visibleTotalBills = visibleBills
    .filter(bill => !bill.isUnpayable)
    .reduce((sum, bill) => sum + bill.amount, 0);

  return (
    <div className="mt-4 pt-4 border-t border-[var(--color-border)]">
      <div className="space-y-4">
        <div>
          <h4 className="text-sm font-medium text-[var(--color-text-secondary)] mb-2 flex items-center gap-2">
            <Wallet className="w-4 h-4" />
            Income
          </h4>
          <div className="space-y-2">
            {paycheck.incomeSources.map((source) => {
              const rowKey = incomeOverrideRowKey(source.id, paycheck.date);
              const overridden = hasIncomeOverride(incomeOverrides, source.id, paycheck.date);
              const isEditing = editingIncomeKey === rowKey;
              const isSaving = savingIncomeKey === rowKey;

              return (
                <div
                  key={rowKey}
                  className="py-2 px-3 bg-success-50 dark:bg-success-500/10 rounded-lg space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{source.name}</span>
                    <div className="flex items-center gap-2">
                      {!isEditing && (
                        <>
                          <span className="font-mono font-semibold text-success-600 dark:text-success-500">
                            +{formatCurrency(source.amount)}
                          </span>
                          {overridden && (
                            <span className="text-xs text-amber-700 dark:text-amber-400 font-medium">
                              Adjusted
                            </span>
                          )}
                          <button
                            type="button"
                            title="Edit gross income for this paycheck"
                            onClick={() => {
                              setEditingIncomeKey(rowKey);
                              setDraftIncomeAmount(String(source.amount));
                            }}
                            className="p-1.5 rounded-md text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          {overridden && (
                            <button
                              type="button"
                              className="text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline"
                              onClick={() => onClearIncomeOverride(source.id, paycheck.date)}
                              disabled={isSaving}
                            >
                              Clear
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  {isEditing && (
                    <div className="flex flex-wrap items-end gap-2 pt-1 border-t border-success-200/60 dark:border-success-500/20">
                      <div className="flex-1 min-w-[140px]">
                        <label className="text-xs text-[var(--color-text-muted)] block mb-0.5">
                          Gross for this paycheck
                        </label>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          className="input w-full"
                          value={draftIncomeAmount}
                          onChange={(e) => setDraftIncomeAmount(e.target.value)}
                          disabled={isSaving}
                        />
                      </div>
                      <button
                        type="button"
                        className="btn-primary text-sm"
                        disabled={isSaving}
                        onClick={async () => {
                          const v = parseFloat(draftIncomeAmount);
                          if (!Number.isFinite(v) || v < 0) return;
                          await onSaveIncomeOverride(source.id, paycheck.date, v);
                          setEditingIncomeKey(null);
                        }}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        className="btn-secondary text-sm"
                        disabled={isSaving}
                        onClick={() => setEditingIncomeKey(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            <div className="flex items-center justify-between py-2 px-3 bg-[var(--color-bg-tertiary)] rounded-lg font-semibold">
              <span>Total Income</span>
              <span className="font-mono text-success-600 dark:text-success-500">
                +{formatCurrency(paycheck.totalIncome)}
              </span>
            </div>
          </div>
        </div>
        
        {visibleBills.length > 0 && (
          <div>
            <h4 className="text-sm font-medium text-[var(--color-text-secondary)] mb-2 flex items-center gap-2">
              <Receipt className="w-4 h-4" />
              Bills to Pay ({visibleBills.length})
              <span className="text-xs text-[var(--color-text-muted)]">• Drag bills to move between paychecks</span>
              {isAssigning && <RefreshCw className="w-3 h-3 animate-spin text-primary-500" />}
            </h4>
            <div className="space-y-2">
              {[...visibleBills].sort((a, b) => {
                const paycheckDate = parseISO(paycheck.date);
                const paycheckMonth = getMonth(paycheckDate);
                const paycheckYear = getYear(paycheckDate);
                
                const aDate = parseISO(a.billDate);
                const bDate = parseISO(b.billDate);
                
                const aMonthDiff = (getYear(aDate) - paycheckYear) * 12 + (getMonth(aDate) - paycheckMonth);
                const bMonthDiff = (getYear(bDate) - paycheckYear) * 12 + (getMonth(bDate) - paycheckMonth);
                
                if (aMonthDiff !== bMonthDiff) {
                  return aMonthDiff - bMonthDiff;
                }
                return a.dueDay - b.dueDay;
              }).map((bill, idx) => {
                const isSkipping = skippingBill === `${bill.billId}-${paycheck.date}`;
                const isRestoring = restoringBill === `${bill.billId}-${bill.billDate}`;
                const isManuallyAssigned = isBillMovedToPaycheck(
                  billAssignments,
                  bill.billId,
                  bill.billDate,
                  paycheck.date
                );
                const isDragging = draggedBill?.billId === bill.billId && draggedBill?.billDate === bill.billDate;
                
                const paycheckDate = parseISO(paycheck.date);
                const billDate = parseISO(bill.billDate);
                const isNextMonth = getMonth(billDate) !== getMonth(paycheckDate) || getYear(billDate) !== getYear(paycheckDate);
                const monthName = isNextMonth ? format(billDate, 'MMM') + ' ' : '';
                
                return (
                  <div 
                    key={idx} 
                    draggable={!bill.isUnpayable}
                    onDragStart={() => !bill.isUnpayable && onDragStart(bill, paycheck.date)}
                    onDragEnd={onDragEnd}
                    className={clsx(
                      'flex items-center justify-between py-2 px-3 rounded-lg group',
                      bill.isUnpayable
                        ? 'bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-700/50'
                        : isManuallyAssigned 
                          ? 'bg-primary-50 dark:bg-primary-500/10 border-2 border-primary-300 dark:border-primary-700 cursor-move' 
                          : 'bg-danger-50 dark:bg-danger-500/10 cursor-move',
                      isDragging && 'opacity-50'
                    )}
                  >
                    <div className="flex items-center gap-3">
                      {!bill.isUnpayable && (
                        <GripVertical className="w-4 h-4 text-[var(--color-text-muted)] opacity-0 group-hover:opacity-100 transition-opacity" />
                      )}
                      <span className={clsx('font-medium', bill.isUnpayable && 'line-through text-[var(--color-text-muted)]')}>
                        {bill.creditorName}
                      </span>
                      {bill.isUnpayable && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-amber-200 text-amber-900 dark:bg-amber-800 dark:text-amber-100">
                          Unpayable
                        </span>
                      )}
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
                      {isManuallyAssigned && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onRestoreBill(bill.billId, bill.billDate);
                          }}
                          disabled={isRestoring}
                          className="opacity-0 group-hover:opacity-100 transition-opacity text-xs font-medium px-2 py-1 rounded bg-primary-500 text-white hover:bg-primary-600 dark:bg-primary-600 dark:text-white dark:hover:bg-primary-500 flex items-center gap-1 shadow-sm"
                          title="Restore to original paycheck"
                        >
                          <RotateCcw className="w-3 h-3" />
                          {isRestoring ? 'Restoring...' : 'Restore'}
                        </button>
                      )}
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
                      <span className={clsx(
                        'font-mono font-semibold',
                        bill.isUnpayable
                          ? 'text-amber-600 dark:text-amber-400 line-through'
                          : 'text-danger-600 dark:text-danger-500'
                      )}>
                        -{formatCurrency(bill.amount)}
                      </span>
                    </div>
                  </div>
                );
              })}
              <div className="flex items-center justify-between py-2 px-3 bg-[var(--color-bg-tertiary)] rounded-lg font-semibold">
                <span>Total Bills</span>
                <span className="font-mono text-danger-600 dark:text-danger-500">
                  -{formatCurrency(visibleTotalBills)}
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
  );
}

export default memo(PaycheckView);

export type { DraggedBill };
