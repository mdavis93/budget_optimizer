import { format, getMonth, getYear, parseISO } from 'date-fns';
import { GripVertical, RotateCcw, SkipForward } from 'lucide-react';
import clsx from 'clsx';
import { BillAssignment, PaycheckBill, PRIORITY_LABELS } from '../../types';
import { isBillMovedToPaycheck } from '../../utils/scheduleBills';
import type { DraggedBill } from './PaycheckView';

interface PaycheckBillRowProps {
  bill: PaycheckBill;
  paycheckDate: string;
  formatCurrency: (amount: number) => string;
  onSkipBill: (billId: string, paycheckDate: string) => void;
  isSkipping: boolean;
  onRestoreBill: (billId: string, billDueDate: string) => void;
  isRestoring: boolean;
  onDragStart: (bill: PaycheckBill, sourcePaycheckDate: string) => void;
  onDragEnd: () => void;
  draggedBill: DraggedBill | null;
  billAssignments: BillAssignment[];
}

export default function PaycheckBillRow({
  bill,
  paycheckDate,
  formatCurrency,
  onSkipBill,
  isSkipping,
  onRestoreBill,
  isRestoring,
  onDragStart,
  onDragEnd,
  draggedBill,
  billAssignments,
}: PaycheckBillRowProps) {
  const isManuallyAssigned = isBillMovedToPaycheck(
    billAssignments,
    bill.billId,
    bill.billDate,
    paycheckDate
  );
  const isDragging = draggedBill?.billId === bill.billId && draggedBill?.billDate === bill.billDate;
  const paycheckDateValue = parseISO(paycheckDate);
  const billDate = parseISO(bill.billDate);
  const isNextMonth = getMonth(billDate) !== getMonth(paycheckDateValue) || getYear(billDate) !== getYear(paycheckDateValue);
  const monthName = isNextMonth ? format(billDate, 'MMM') + ' ' : '';

  return (
    <div
      draggable={!bill.isUnpayable}
      onDragStart={() => !bill.isUnpayable && onDragStart(bill, paycheckDate)}
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
            onSkipBill(bill.billId, paycheckDate);
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
}
