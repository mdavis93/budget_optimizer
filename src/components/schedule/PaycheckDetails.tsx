import type { BillAssignment, IncomeOverride, PaycheckBill, PaycheckEntry } from '../../types';
import PaycheckIncomeSection from './PaycheckIncomeSection';
import PaycheckBillsSection from './PaycheckBillsSection';
import PaycheckGoalDeposits from './PaycheckGoalDeposits';
import PaycheckDebtPaydown from './PaycheckDebtPaydown';
import PaycheckSavingsTransfer from './PaycheckSavingsTransfer';
import PaycheckRemainder from './PaycheckRemainder';
import type { DraggedBill } from './PaycheckView';

interface PaycheckDetailsProps {
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

export default function PaycheckDetails(props: PaycheckDetailsProps) {
  const { paycheck, formatCurrency } = props;

  return (
    <div className="mt-4 pt-4 border-t border-(--color-border)">
      <div className="space-y-4">
        <PaycheckIncomeSection
          paycheck={paycheck}
          formatCurrency={formatCurrency}
          incomeOverrides={props.incomeOverrides}
          onSaveIncomeOverride={props.onSaveIncomeOverride}
          onClearIncomeOverride={props.onClearIncomeOverride}
          savingIncomeKey={props.savingIncomeKey}
        />
        <PaycheckBillsSection
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
          draggedBill={props.draggedBill}
          billAssignments={props.billAssignments}
          validPaycheckDates={props.validPaycheckDates}
          isAssigning={props.isAssigning}
          openPaymentKey={props.openPaymentKey}
          onOpenPaymentEditor={props.onOpenPaymentEditor}
          onClosePaymentEditor={props.onClosePaymentEditor}
          onSavePaymentOverride={props.onSavePaymentOverride}
          onClearPaymentOverride={props.onClearPaymentOverride}
        />
        <PaycheckGoalDeposits paycheck={paycheck} formatCurrency={formatCurrency} />
        <PaycheckDebtPaydown paycheck={paycheck} formatCurrency={formatCurrency} />
        <PaycheckSavingsTransfer paycheck={paycheck} formatCurrency={formatCurrency} />
        <PaycheckRemainder paycheck={paycheck} formatCurrency={formatCurrency} />
      </div>
    </div>
  );
}
