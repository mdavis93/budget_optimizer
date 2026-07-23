import { DragEvent, memo } from 'react';
import { format, parseISO } from 'date-fns';
import { 
  Wallet, 
  ChevronDown, 
  ChevronUp, 
  PiggyBank, 
  Target,
  AlertTriangle,
} from 'lucide-react';
import { PaycheckEntry, PaycheckBill, BillAssignment, IncomeOverride } from '../../types';
import { filterPaycheckBills } from '../../utils/scheduleBills';
import clsx from 'clsx';
import IconTooltip from '../IconTooltip';
import PaycheckDetails from './PaycheckDetails';

export interface DraggedBill {
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
  onSkipBill: (billId: string, billDate: string) => void;
  onUnskipBill: (billId: string, billDate: string) => void;
  skippingBill: string | null;
  unskippingBill: string | null;
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
  const target = paycheck.targetCashOnHand ?? maxBudgetRemaining;
  const min = paycheck.minCashOnHand ?? minCashOnHand;
  return (
    !paycheck.isShortfall &&
    paycheck.budgetRemaining < target &&
    paycheck.budgetRemaining >= min
  );
}

/** Hard failure: insolvency, or unfunded bills on a short paycheck — danger theme. */
function isHardShortfallPaycheck(
  paycheck: PaycheckEntry,
  hasUnpayableBills: boolean
): boolean {
  if (paycheck.budgetRemaining < 0) return true;
  return Boolean(paycheck.isShortfall) && hasUnpayableBills;
}

/**
 * Bills are funded but cash sits below the min floor — warning theme (not
 * the same as unpayable / negative remaining).
 */
function isBelowMinimumPaycheck(
  paycheck: PaycheckEntry,
  hasUnpayableBills: boolean
): boolean {
  return (
    Boolean(paycheck.isShortfall) &&
    paycheck.budgetRemaining >= 0 &&
    !hasUnpayableBills
  );
}

function paycheckWarningTooltip(
  paycheck: PaycheckEntry,
  hasUnpayableBills: boolean,
  unpayableCount: number,
  formatCurrency: (amount: number) => string,
  fallbackMinCashOnHand: number
): string {
  const min = paycheck.minCashOnHand ?? fallbackMinCashOnHand;
  if (hasUnpayableBills) {
    const noun = unpayableCount === 1 ? 'bill' : 'bills';
    return `${unpayableCount} ${noun} could not be funded from available income in this paycheck's window.`;
  }
  if (paycheck.budgetRemaining < 0) {
    return `Bills exceed this paycheck's income after reserves. Cash on hand would be ${formatCurrency(paycheck.budgetRemaining)}.`;
  }
  if (paycheck.isShortfall) {
    return `Cash on hand (${formatCurrency(paycheck.budgetRemaining)}) is below your minimum floor of ${formatCurrency(min)}. Bills are funded, but this week is tighter than your reserve.`;
  }
  return '';
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
  onUnskipBill,
  skippingBill,
  unskippingBill,
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
        <p className="text-(--color-text-muted)">No paychecks in the selected period</p>
      </div>
    );
  }


  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Paychecks ({paychecks.length})</h3>
          <p className="text-xs text-(--color-text-muted)">
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
          const visibleBills = filterPaycheckBills(
            paycheck.bills,
            billAssignments,
            paycheck.date,
          );
          const unpayableCount = visibleBills.filter(bill => bill.isUnpayable && !bill.isSkipped).length;
          const hasUnpayableBills = unpayableCount > 0;
          const isHardShortfall = isHardShortfallPaycheck(paycheck, hasUnpayableBills);
          const isBelowMinimum = isBelowMinimumPaycheck(paycheck, hasUnpayableBills);
          const isBreakGlass = isBreakGlassPaycheck(paycheck, maxBudgetRemaining, minCashOnHand);
          const warningTooltip = paycheckWarningTooltip(
            paycheck,
            hasUnpayableBills,
            unpayableCount,
            formatCurrency,
            minCashOnHand
          );
          const isExpanded = expandedPaychecks.has(paycheck.date);
          const isDropTarget = dropTargetDate === paycheck.date;
          const isDragSource = draggedBill?.sourcePaycheckDate === paycheck.date;
          const cardClassName = clsx(
            'card overflow-hidden transition-all',
            isHardShortfall && 'border-danger-300 dark:border-danger-700 bg-danger-50/50 dark:bg-danger-500/5',
            isBelowMinimum && 'break-glass-tape border-warning-300 dark:border-warning-700/50',
            isBreakGlass && !isHardShortfall && !isBelowMinimum && 'break-glass-tape border-warning-300 dark:border-warning-700/50',
            isDropTarget && 'ring-2 ring-primary-500 ring-offset-2 bg-primary-50/50 dark:bg-primary-500/10',
            isDragSource && 'opacity-50'
          );
          
          return (
            <div 
              key={paycheck.date}
              className={cardClassName}
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
                    isHardShortfall
                      ? 'bg-danger-100 dark:bg-danger-500/20'
                      : isBelowMinimum || isBreakGlass
                        ? 'bg-warning-100 dark:bg-warning-500/20'
                        : 'bg-success-100 dark:bg-success-500/20'
                  )}>
                    <Wallet className={clsx(
                      'w-6 h-6',
                      isHardShortfall
                        ? 'text-danger-600 dark:text-danger-500'
                        : isBelowMinimum || isBreakGlass
                          ? 'text-warning-600 dark:text-warning-500'
                          : 'text-success-600 dark:text-success-500'
                    )} />
                  </div>
                  <div>
                    <p className="font-semibold text-lg flex items-center gap-2 flex-wrap">
                      {format(parseISO(paycheck.date), 'EEEE, MMMM d, yyyy')}
                      {isBreakGlass && (
                        <span
                          className="text-xs font-semibold px-2 py-0.5 rounded-full bg-warning-100 dark:bg-warning-500/20 text-warning-800 dark:text-warning-200"
                          title="Cash on hand is below your target but above your minimum floor"
                        >
                          Break-Glass
                        </span>
                      )}
                      {isBelowMinimum && (
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-warning-100 dark:bg-warning-500/20 text-warning-800 dark:text-warning-200">
                          Below minimum
                        </span>
                      )}
                    </p>
                    <div className="flex items-center gap-4 text-sm text-(--color-text-secondary)">
                      <span>{paycheck.incomeSources.map(s => s.name).join(' + ')}</span>
                      <span>•</span>
                      <span>{visibleBills.length} bill{visibleBills.length !== 1 ? 's' : ''}</span>
                      {hasUnpayableBills && (
                        <>
                          <span>•</span>
                          <span className="text-danger-600 dark:text-danger-400 font-semibold flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" aria-hidden="true" />
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
                    <p className="text-xs text-(--color-text-muted)">Budget Remaining</p>
                    <p className={clsx(
                      'text-xl font-semibold font-mono',
                      isHardShortfall
                        ? 'text-danger-500'
                        : isBelowMinimum || isBreakGlass
                          ? 'text-warning-600 dark:text-warning-500'
                          : 'text-success-500'
                    )}>
                      {formatCurrency(paycheck.budgetRemaining)}
                    </p>
                  </div>
                  {warningTooltip && (
                    <IconTooltip label={warningTooltip} side="left">
                      <AlertTriangle
                        className={clsx(
                          'w-6 h-6',
                          isHardShortfall ? 'text-danger-500' : 'text-warning-600 dark:text-warning-500'
                        )}
                        aria-hidden="true"
                      />
                    </IconTooltip>
                  )}
                  {isExpanded ? (
                    <ChevronUp className="w-5 h-5 text-(--color-text-muted)" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-(--color-text-muted)" />
                  )}
                </div>
              </button>
              
              {isExpanded && (
                <PaycheckDetails
                  paycheck={paycheck}
                  formatCurrency={formatCurrency}
                  onSkipBill={onSkipBill}
                  onUnskipBill={onUnskipBill}
                  skippingBill={skippingBill}
                  unskippingBill={unskippingBill}
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

export default memo(PaycheckView);
