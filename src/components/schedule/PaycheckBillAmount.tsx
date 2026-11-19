import { useRef } from 'react';
import clsx from 'clsx';
import type { PaycheckBill } from '../../types';
import {
  billPaymentEditorKey,
  isBillPaymentRaised,
} from '../../utils/billPaymentRaised';
import BillPaymentPopover from './BillPaymentPopover';

interface PaycheckBillAmountProps {
  bill: PaycheckBill;
  formatCurrency: (amount: number) => string;
  openPaymentKey: string | null;
  onOpenPaymentEditor: (billId: string, billDate: string) => void;
  onClosePaymentEditor: () => void;
  onSavePaymentOverride: (billId: string, billDate: string, amount: number) => void | Promise<void>;
  onClearPaymentOverride: (billId: string, billDate: string) => void | Promise<void>;
}

export default function PaycheckBillAmount({
  bill,
  formatCurrency,
  openPaymentKey,
  onOpenPaymentEditor,
  onClosePaymentEditor,
  onSavePaymentOverride,
  onClearPaymentOverride,
}: PaycheckBillAmountProps) {
  const amountRef = useRef<HTMLButtonElement>(null);
  const isSkipped = Boolean(bill.isSkipped);
  const seriesAmount = bill.seriesAmount ?? bill.amount;
  const isRaised = isBillPaymentRaised(bill);
  const isEditorOpen = openPaymentKey === billPaymentEditorKey(bill.billId, bill.billDate);
  const anchorRect = amountRef.current?.getBoundingClientRect();

  return (
    <>
      {isSkipped ? (
        <span
          className={clsx(
            'font-mono font-semibold text-slate-600 dark:text-slate-400 line-through',
            isRaised && 'underline decoration-dotted underline-offset-2'
          )}
        >
          -{formatCurrency(bill.amount)}
        </span>
      ) : (
        <button
          ref={amountRef}
          type="button"
          draggable={false}
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onOpenPaymentEditor(bill.billId, bill.billDate);
          }}
          className={clsx(
            'font-mono font-semibold underline-offset-2 group-hover:underline',
            isRaised && 'underline decoration-dotted',
            bill.isUnpayable
              ? 'text-amber-600 dark:text-amber-400 line-through'
              : 'text-danger-600 dark:text-danger-500'
          )}
          title="Change this payment for this date only"
        >
          -{formatCurrency(bill.amount)}
        </button>
      )}
      {isEditorOpen && anchorRect && (
        <BillPaymentPopover
          billDate={bill.billDate}
          seriesAmount={seriesAmount}
          currentAmount={bill.amount}
          anchorRect={anchorRect}
          formatCurrency={formatCurrency}
          onSave={(amount) => onSavePaymentOverride(bill.billId, bill.billDate, amount)}
          onClear={() => onClearPaymentOverride(bill.billId, bill.billDate)}
          onDismiss={onClosePaymentEditor}
        />
      )}
    </>
  );
}
