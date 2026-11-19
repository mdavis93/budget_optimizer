import type { DragEvent } from 'react';
import clsx from 'clsx';
import type {
  BillAssignment,
  IncomeOverride,
  PaycheckBill,
  PaycheckEntry,
} from '../../types';
import PaycheckDetails from './PaycheckDetails';
import PaycheckCardHeader from './PaycheckCardHeader';
import { resolvePaycheckCardState } from './paycheckCardState';
import type { DraggedBill } from './PaycheckView';

interface PaycheckCardProps {
  paycheck: PaycheckEntry;
  expandedPaychecks: Set<string>;
  formatCurrency: (amount: number) => string;
  maxBudgetRemaining: number;
  minCashOnHand: number;
  onToggle: (entryKey: string) => void;
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
  validPaycheckDates: ReadonlySet<string>;
  isAssigning: boolean;
  incomeOverrides: IncomeOverride[];
  onSaveIncomeOverride: (incomeId: string, paycheckDate: string, amount: number) => Promise<void>;
  onClearIncomeOverride: (incomeId: string, paycheckDate: string) => Promise<void>;
  savingIncomeKey: string | null;
  openPaymentKey: string | null;
  onOpenPaymentEditor: (billId: string, billDate: string) => void;
  onClosePaymentEditor: () => void;
  onSavePaymentOverride: (billId: string, billDate: string, amount: number) => void | Promise<void>;
  onClearPaymentOverride: (billId: string, billDate: string) => void | Promise<void>;
}

export default function PaycheckCard(props: PaycheckCardProps) {
  const {
    paycheck,
    expandedPaychecks,
    formatCurrency,
    maxBudgetRemaining,
    minCashOnHand,
    onToggle,
    onDragOver,
    onDragLeave,
    onDrop,
    draggedBill,
    dropTargetDate,
    billAssignments,
    validPaycheckDates,
  } = props;
  const state = resolvePaycheckCardState(
    paycheck,
    billAssignments,
    validPaycheckDates,
    maxBudgetRemaining,
    minCashOnHand,
    formatCurrency,
    expandedPaychecks,
    dropTargetDate,
    draggedBill?.sourcePaycheckDate
  );

  return (
    <div
      className={clsx(
        'card overflow-hidden transition-all',
        state.isReserved &&
          'border-dashed border-2 border-cyan-400 dark:border-cyan-600 bg-cyan-50/40 dark:bg-cyan-500/5',
        state.isHardShortfall &&
          'border-danger-300 dark:border-danger-700 bg-danger-50/50 dark:bg-danger-500/5',
        state.isBelowMinimum && 'break-glass-tape border-warning-300 dark:border-warning-700/50',
        state.isBreakGlass &&
          !state.isHardShortfall &&
          !state.isBelowMinimum &&
          'break-glass-tape border-warning-300 dark:border-warning-700/50',
        state.isDropTarget &&
          'ring-2 ring-primary-500 ring-offset-2 bg-primary-50/50 dark:bg-primary-500/10',
        state.isDragSource && 'opacity-50'
      )}
      onDragOver={
        state.blocksAssignment ? undefined : (e) => onDragOver(e, paycheck.date)
      }
      onDragLeave={state.blocksAssignment ? undefined : onDragLeave}
      onDrop={state.blocksAssignment ? undefined : (e) => onDrop(e, paycheck.date)}
    >
      <PaycheckCardHeader
        paycheck={paycheck}
        isReserved={state.isReserved}
        isHardShortfall={state.isHardShortfall}
        isBelowMinimum={state.isBelowMinimum}
        isBreakGlass={state.isBreakGlass}
        isExpanded={state.isExpanded}
        visibleBills={state.visibleBills}
        hasUnpayableBills={state.hasUnpayableBills}
        unpayableCount={state.unpayableCount}
        warningTooltip={state.warningTooltip}
        formatCurrency={formatCurrency}
        onToggle={() => onToggle(state.entryKey)}
      />
      {state.isExpanded && (
        <PaycheckDetails
          paycheck={paycheck}
          formatCurrency={formatCurrency}
          onSkipBill={props.onSkipBill}
          onUnskipBill={props.onUnskipBill}
          skippingBill={props.skippingBill}
          unskippingBill={props.unskippingBill}
          onRestoreBill={props.onRestoreBill}
          restoringBill={props.restoringBill}
          onDragStart={props.onDragStart}
          onDragEnd={props.onDragEnd}
          draggedBill={draggedBill}
          billAssignments={billAssignments}
          validPaycheckDates={validPaycheckDates}
          isAssigning={props.isAssigning}
          incomeOverrides={props.incomeOverrides}
          onSaveIncomeOverride={props.onSaveIncomeOverride}
          onClearIncomeOverride={props.onClearIncomeOverride}
          savingIncomeKey={props.savingIncomeKey}
          openPaymentKey={props.openPaymentKey}
          onOpenPaymentEditor={props.onOpenPaymentEditor}
          onClosePaymentEditor={props.onClosePaymentEditor}
          onSavePaymentOverride={props.onSavePaymentOverride}
          onClearPaymentOverride={props.onClearPaymentOverride}
        />
      )}
    </div>
  );
}
