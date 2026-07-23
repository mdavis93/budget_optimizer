import { useState } from 'react';
import { getMonth, getYear, parseISO } from 'date-fns';
import { PiggyBank, Receipt, RefreshCw, Target, TrendingUp, Wallet } from 'lucide-react';
import clsx from 'clsx';
import { BillAssignment, IncomeOverride, PaycheckBill, PaycheckEntry } from '../../types';
import { filterPaycheckBills } from '../../utils/scheduleBills';
import PaycheckBillRow from './PaycheckBillRow';
import PaycheckIncomeRow from './PaycheckIncomeRow';
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

export default function PaycheckDetails({
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
  incomeOverrides,
  onSaveIncomeOverride,
  onClearIncomeOverride,
  savingIncomeKey,
}: PaycheckDetailsProps) {
  const [editingIncomeKey, setEditingIncomeKey] = useState<string | null>(null);
  const [draftIncomeAmount, setDraftIncomeAmount] = useState('');
  const visibleBills = filterPaycheckBills(
    paycheck.bills,
    billAssignments,
    paycheck.date,
    validPaycheckDates
  );
  const visibleTotalBills = visibleBills
    .filter(bill => !bill.isUnpayable && !bill.isSkipped)
    .reduce((sum, bill) => sum + bill.amount, 0);

  return (
    <div className="mt-4 pt-4 border-t border-(--color-border)">
      <div className="space-y-4">
        <div>
          <h4 className="text-sm font-medium text-(--color-text-secondary) mb-2 flex items-center gap-2">
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
                <PaycheckIncomeRow
                  key={rowKey}
                  source={source}
                  rowKey={rowKey}
                  overridden={overridden}
                  isEditing={isEditing}
                  isSaving={isSaving}
                  draftIncomeAmount={draftIncomeAmount}
                  formatCurrency={formatCurrency}
                  onEdit={() => {
                    setEditingIncomeKey(rowKey);
                    setDraftIncomeAmount(String(source.amount));
                  }}
                  onDraftChange={setDraftIncomeAmount}
                  onSave={async () => {
                    const v = parseFloat(draftIncomeAmount);
                    if (!Number.isFinite(v) || v < 0) return;
                    await onSaveIncomeOverride(source.id, paycheck.date, v);
                    setEditingIncomeKey(null);
                  }}
                  onCancel={() => setEditingIncomeKey(null)}
                  onClear={() => onClearIncomeOverride(source.id, paycheck.date)}
                />
              );
            })}
            <div className="flex items-center justify-between py-2 px-3 bg-(--color-bg-tertiary) rounded-lg font-semibold">
              <span>Total Income</span>
              <span className="font-mono text-success-600 dark:text-success-500">
                +{formatCurrency(paycheck.totalIncome)}
              </span>
            </div>
          </div>
        </div>

        {visibleBills.length > 0 && (
          <div>
            <h4 className="text-sm font-medium text-(--color-text-secondary) mb-2 flex items-center gap-2">
              <Receipt className="w-4 h-4" />
              Bills to Pay ({visibleBills.length})
              <span className="text-xs text-(--color-text-muted)">• Drag bills to move between paychecks</span>
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
                return aMonthDiff !== bMonthDiff ? aMonthDiff - bMonthDiff : a.dueDay - b.dueDay;
              }).map((bill, idx) => (
                <PaycheckBillRow
                  key={idx}
                  bill={bill}
                  paycheckDate={paycheck.date}
                  formatCurrency={formatCurrency}
                  onSkipBill={onSkipBill}
                  onUnskipBill={onUnskipBill}
                  isSkipping={skippingBill === `${bill.billId}-${bill.billDate}`}
                  isUnskipping={unskippingBill === `${bill.billId}-${bill.billDate}`}
                  onRestoreBill={onRestoreBill}
                  isRestoring={restoringBill === `${bill.billId}-${bill.billDate}`}
                  onDragStart={onDragStart}
                  onDragEnd={onDragEnd}
                  draggedBill={draggedBill}
                  billAssignments={billAssignments}
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
        )}

        {paycheck.goalDeposits && paycheck.goalDeposits.length > 0 && (
          <div>
            <h4 className="text-sm font-medium text-(--color-text-secondary) mb-2 flex items-center gap-2">
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
                <div className="flex items-center justify-between py-2 px-3 bg-(--color-bg-tertiary) rounded-lg font-semibold">
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
            <h4 className="text-sm font-medium text-(--color-text-secondary) mb-2 flex items-center gap-2">
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

        <div className="flex items-center justify-between py-3 px-4 bg-(--color-bg-secondary) rounded-lg border border-(--color-border)">
          <span className="font-semibold">Budget Remaining</span>
          <span className={clsx(
            'text-2xl font-mono font-bold',
            paycheck.budgetRemaining < 0 || paycheck.hasUnpayableBills
              ? 'text-danger-500'
              : paycheck.isShortfall
                ? 'text-warning-600 dark:text-warning-500'
                : 'text-success-500'
          )}>
            {formatCurrency(paycheck.budgetRemaining)}
          </span>
        </div>

        <p className="text-xs text-(--color-text-muted) text-center">
          Savings Balance: {formatCurrency(paycheck.totalSavings)}
        </p>
      </div>
    </div>
  );
}
