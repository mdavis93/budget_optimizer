import { getMonth, getYear, parseISO } from 'date-fns';
import { Receipt, RefreshCw } from 'lucide-react';
import type { BillAssignment, PaycheckBill, PaycheckEntry } from '../../types';
import { filterPaycheckBills } from '../../utils/scheduleBills';
import { isSavingsAndGoalsIncome } from '@shared/incomePurpose';
import { billOccurrenceKeyFromIso } from '@shared/billOccurrence';
import PaycheckBillRow from './PaycheckBillRow';
import type { DraggedBill } from './PaycheckView';

function compareBillsForPaycheck(paycheckDate: string, a: PaycheckBill, b: PaycheckBill): number {
  const paycheck = parseISO(paycheckDate);
  const paycheckMonth = getMonth(paycheck);
  const paycheckYear = getYear(paycheck);
  const aDate = parseISO(a.billDate);
  const bDate = parseISO(b.billDate);
  const aMonthDiff = (getYear(aDate) - paycheckYear) * 12 + (getMonth(aDate) - paycheckMonth);
  const bMonthDiff = (getYear(bDate) - paycheckYear) * 12 + (getMonth(bDate) - paycheckMonth);
  return aMonthDiff !== bMonthDiff ? aMonthDiff - bMonthDiff : a.dueDay - b.dueDay;
}

interface PaycheckBillsSectionProps {
  paycheck: PaycheckEntry;
  formatCurrency: (amount: number) => string;
  onSkipBill: (billId: string, billDate: string) => void;
  onUnskipBill: (billId: string, billDate: string) => void;
  skippingBill: string | null;
  unskippingBill: string | null;
  onRestoreBill: (billId: string, billDueDate: string) => void;
  restoringBill: string | null;
  onDragStart: (bill: PaycheckBill, sourcePaycheckDate: string) => void;
  onDragEnd: () => void;
  draggedBill: DraggedBill | null;
  billAssignments: BillAssignment[];
  validPaycheckDates?: ReadonlySet<string>;
  isAssigning: boolean;
  openPaymentKey: string | null;
  onOpenPaymentEditor: (billId: string, billDate: string) => void;
  onClosePaymentEditor: () => void;
  onSavePaymentOverride: (billId: string, billDate: string, amount: number) => void | Promise<void>;
  onClearPaymentOverride: (billId: string, billDate: string) => void | Promise<void>;
}

export default function PaycheckBillsSection({
  paycheck,
  formatCurrency,
  onSkipBill,
  onUnskipBill,
  skippingBill,
  unskippingBill,
  onRestoreBill,
  restoringBill,
  onDragStart,
  onDragEnd,
  draggedBill,
  billAssignments,
  validPaycheckDates,
  isAssigning,
  openPaymentKey,
  onOpenPaymentEditor,
  onClosePaymentEditor,
  onSavePaymentOverride,
  onClearPaymentOverride,
}: PaycheckBillsSectionProps) {
  if (isSavingsAndGoalsIncome(paycheck)) return null;

  const visibleBills = filterPaycheckBills(
    paycheck.bills,
    billAssignments,
    paycheck.date,
    validPaycheckDates
  );
  if (visibleBills.length === 0) return null;

  const visibleTotalBills = visibleBills
    .filter(bill => !bill.isUnpayable && !bill.isSkipped)
    .reduce((sum, bill) => sum + bill.amount, 0);

  return (
    <div>
      <h4 className="text-sm font-medium text-(--color-text-secondary) mb-2 flex items-center gap-2">
        <Receipt className="w-4 h-4" />
        Bills to Pay ({visibleBills.length})
        <span className="text-xs text-(--color-text-muted)">• Drag bills to move between paychecks</span>
        {isAssigning && <RefreshCw className="w-3 h-3 animate-spin text-primary-500" />}
      </h4>
      <div className="space-y-2">
        {[...visibleBills].sort((a, b) => compareBillsForPaycheck(paycheck.date, a, b)).map((bill, idx) => (
          <PaycheckBillRow
            key={idx}
            bill={bill}
            paycheckDate={paycheck.date}
            formatCurrency={formatCurrency}
            onSkipBill={onSkipBill}
            onUnskipBill={onUnskipBill}
            isSkipping={skippingBill === billOccurrenceKeyFromIso(bill.billId, bill.billDate)}
            isUnskipping={unskippingBill === billOccurrenceKeyFromIso(bill.billId, bill.billDate)}
            onRestoreBill={onRestoreBill}
            isRestoring={restoringBill === billOccurrenceKeyFromIso(bill.billId, bill.billDate)}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            draggedBill={draggedBill}
            billAssignments={billAssignments}
            openPaymentKey={openPaymentKey}
            onOpenPaymentEditor={onOpenPaymentEditor}
            onClosePaymentEditor={onClosePaymentEditor}
            onSavePaymentOverride={onSavePaymentOverride}
            onClearPaymentOverride={onClearPaymentOverride}
          />
        ))}
        <div className="flex items-center justify-between py-2 px-3 bg-(--color-bg-tertiary) rounded-lg font-semibold">
          <span>Total Bills</span>
          <span className="font-mono text-danger-600 dark:text-danger-500">
            -{formatCurrency(visibleTotalBills)}
          </span>
        </div>
      </div>
    </div>
  );
}
