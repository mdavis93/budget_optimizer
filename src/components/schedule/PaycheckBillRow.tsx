import { format, getMonth, getYear, parseISO } from 'date-fns';
import clsx from 'clsx';
import { BillAssignment, PaycheckBill } from '../../types';
import { isBillMovedToPaycheck } from '../../utils/scheduleBills';
import PaycheckBillAmount from './PaycheckBillAmount';
import { PaycheckBillActions, PaycheckBillSkippedWatermark } from './PaycheckBillChrome';
import PaycheckBillIdentity from './PaycheckBillIdentity';
import type { DraggedBill } from './PaycheckView';

interface PaycheckBillRowProps {
  bill: PaycheckBill;
  paycheckDate: string;
  formatCurrency: (amount: number) => string;
  onSkipBill: (billId: string, billDate: string) => void;
  onUnskipBill: (billId: string, billDate: string) => void;
  isSkipping: boolean;
  isUnskipping: boolean;
  onRestoreBill: (billId: string, billDueDate: string) => void;
  isRestoring: boolean;
  onDragStart: (bill: PaycheckBill, sourcePaycheckDate: string) => void;
  onDragEnd: () => void;
  draggedBill: DraggedBill | null;
  billAssignments: BillAssignment[];
  openPaymentKey: string | null;
  onOpenPaymentEditor: (billId: string, billDate: string) => void;
  onClosePaymentEditor: () => void;
  onSavePaymentOverride: (billId: string, billDate: string, amount: number) => void | Promise<void>;
  onClearPaymentOverride: (billId: string, billDate: string) => void | Promise<void>;
}

export default function PaycheckBillRow({
  bill,
  paycheckDate,
  formatCurrency,
  onSkipBill,
  onUnskipBill,
  isSkipping,
  isUnskipping,
  onRestoreBill,
  isRestoring,
  onDragStart,
  onDragEnd,
  draggedBill,
  billAssignments,
  openPaymentKey,
  onOpenPaymentEditor,
  onClosePaymentEditor,
  onSavePaymentOverride,
  onClearPaymentOverride,
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
  const isNextMonth =
    getMonth(billDate) !== getMonth(paycheckDateValue) ||
    getYear(billDate) !== getYear(paycheckDateValue);
  const monthName = isNextMonth ? format(billDate, 'MMM') + ' ' : '';
  const isSkipped = Boolean(bill.isSkipped);
  const canDrag = !isSkipped;

  return (
    <div
      draggable={canDrag}
      onDragStart={() => canDrag && onDragStart(bill, paycheckDate)}
      onDragEnd={onDragEnd}
      className={clsx(
        'relative flex items-center justify-between py-2 px-3 rounded-lg group overflow-hidden',
        isSkipped
          ? 'bg-slate-200/70 dark:bg-slate-500/20 border border-dashed border-slate-400 dark:border-slate-500 opacity-90'
          : bill.isUnpayable
            ? 'bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-700/50 cursor-move'
            : isManuallyAssigned
              ? 'bg-primary-50 dark:bg-primary-500/10 border-2 border-primary-300 dark:border-primary-700 cursor-move'
              : 'bg-danger-50 dark:bg-danger-500/10 cursor-move',
        isDragging && 'opacity-50'
      )}
    >
      {isSkipped && <PaycheckBillSkippedWatermark />}
      <PaycheckBillIdentity
        bill={bill}
        canDrag={canDrag}
        isSkipped={isSkipped}
        isManuallyAssigned={isManuallyAssigned}
        monthName={monthName}
      />
      <div className="relative flex items-center gap-3">
        <PaycheckBillActions
          billId={bill.billId}
          billDate={bill.billDate}
          isSkipped={isSkipped}
          isManuallyAssigned={isManuallyAssigned}
          isSkipping={isSkipping}
          isUnskipping={isUnskipping}
          isRestoring={isRestoring}
          onSkipBill={onSkipBill}
          onUnskipBill={onUnskipBill}
          onRestoreBill={onRestoreBill}
        />
        <PaycheckBillAmount
          bill={bill}
          formatCurrency={formatCurrency}
          openPaymentKey={openPaymentKey}
          onOpenPaymentEditor={onOpenPaymentEditor}
          onClosePaymentEditor={onClosePaymentEditor}
          onSavePaymentOverride={onSavePaymentOverride}
          onClearPaymentOverride={onClearPaymentOverride}
        />
      </div>
    </div>
  );
}
