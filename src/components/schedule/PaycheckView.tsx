import { DragEvent, memo, useCallback } from 'react';
import { paycheckKey } from '@shared/incomePurpose';
import { PaycheckEntry, PaycheckBill, BillAssignment, IncomeOverride } from '../../types';
import { useBillPaymentEditor } from '../../hooks/useBillPaymentEditor';
import PaycheckCard from './PaycheckCard';
import PaycheckListHeader from './PaycheckListHeader';

export interface DraggedBill {
  billId: string;
  creditorName: string;
  amount: number;
  sourcePaycheckDate: string;
  dueDay: number;
  billDate: string;
  preferredIncomeSourceId?: string;
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
  debtPlanEnabled?: boolean;
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
  onSavePaymentOverride: (billId: string, billDate: string, amount: number) => Promise<void>;
  onClearPaymentOverride: (billId: string, billDate: string) => Promise<void>;
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
  debtPlanEnabled = false,
  onSavePaymentOverride,
  onClearPaymentOverride,
  ...cardProps
}: PaycheckViewProps) {
  const {
    openPaymentKey,
    openPaymentEditor,
    closePaymentEditor,
    handleSavePaymentOverride,
    handleClearPaymentOverride,
  } = useBillPaymentEditor({
    onSave: onSavePaymentOverride,
    onClear: onClearPaymentOverride,
  });

  const handleTogglePaycheck = useCallback(
    (entryKey: string) => {
      closePaymentEditor();
      togglePaycheck(entryKey);
    },
    [closePaymentEditor, togglePaycheck]
  );

  const handleCollapseAll = useCallback(() => {
    closePaymentEditor();
    collapseAll();
  }, [closePaymentEditor, collapseAll]);

  if (paychecks.length === 0) {
    return (
      <div className="card text-center py-12">
        <p className="text-(--color-text-muted)">No paychecks in the selected period</p>
      </div>
    );
  }

  const validPaycheckDates = new Set(paychecks.map((p) => p.date));

  return (
    <div className="space-y-4">
      <PaycheckListHeader
        paycheckCount={paychecks.length}
        formatCurrency={formatCurrency}
        maxBudgetRemaining={maxBudgetRemaining}
        debtPlanEnabled={debtPlanEnabled}
        onExpandAll={expandAll}
        onCollapseAll={handleCollapseAll}
      />
      <div className="space-y-4">
        {paychecks.map((paycheck) => (
          <PaycheckCard
            key={paycheckKey(paycheck)}
            paycheck={paycheck}
            expandedPaychecks={expandedPaychecks}
            formatCurrency={formatCurrency}
            maxBudgetRemaining={maxBudgetRemaining}
            minCashOnHand={minCashOnHand}
            onToggle={handleTogglePaycheck}
            validPaycheckDates={validPaycheckDates}
            openPaymentKey={openPaymentKey}
            onOpenPaymentEditor={openPaymentEditor}
            onClosePaymentEditor={closePaymentEditor}
            onSavePaymentOverride={handleSavePaymentOverride}
            onClearPaymentOverride={handleClearPaymentOverride}
            {...cardProps}
          />
        ))}
      </div>
    </div>
  );
}

export default memo(PaycheckView);
