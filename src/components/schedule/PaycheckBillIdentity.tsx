import clsx from 'clsx';
import { GripVertical } from 'lucide-react';
import { ordinalSuffix } from '@shared/ordinal';
import { BILL_PRIORITY_STYLES } from '@shared/billPriorityStyle';
import { PRIORITY_LABELS, type PaycheckBill } from '../../types';

export default function PaycheckBillIdentity({
  bill,
  canDrag,
  isSkipped,
  isManuallyAssigned,
  monthName,
}: {
  bill: PaycheckBill;
  canDrag: boolean;
  isSkipped: boolean;
  isManuallyAssigned: boolean;
  monthName: string;
}) {
  return (
    <div className="relative flex items-center gap-3">
      {canDrag && (
        <GripVertical className="w-4 h-4 text-(--color-text-muted) opacity-0 group-hover:opacity-100 transition-opacity" />
      )}
      <span
        className={clsx(
          'font-medium',
          (bill.isUnpayable || isSkipped) && 'text-(--color-text-muted)',
          bill.isUnpayable && !isSkipped && 'line-through'
        )}
      >
        {bill.creditorName}
      </span>
      {isSkipped && (
        <span className="text-xs px-2 py-0.5 rounded-full bg-slate-300 text-slate-800 dark:bg-slate-600 dark:text-slate-100">
          Skipped
        </span>
      )}
      {bill.isUnpayable && !isSkipped && (
        <span className="text-xs px-2 py-0.5 rounded-full bg-amber-200 text-amber-900 dark:bg-amber-800 dark:text-amber-100">
          Unpayable
        </span>
      )}
      {isManuallyAssigned && !isSkipped && (
        <span className="text-xs px-2 py-0.5 rounded-full bg-primary-200 text-primary-800 dark:bg-primary-800 dark:text-primary-200">
          Moved
        </span>
      )}
      <span
        className={clsx(
          'text-xs px-2 py-0.5 rounded-full',
          BILL_PRIORITY_STYLES[bill.priority].paycheckBadge
        )}
      >
        {PRIORITY_LABELS[bill.priority]}
      </span>
      <span className="text-xs text-(--color-text-muted)">
        {bill.isIncomeAttached
          ? 'Per Paycheck'
          : `Due: ${monthName}${bill.dueDay}${ordinalSuffix(bill.dueDay)}`}
      </span>
    </div>
  );
}
