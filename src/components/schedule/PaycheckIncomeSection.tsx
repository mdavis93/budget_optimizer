import { useState } from 'react';
import { Landmark, Wallet } from 'lucide-react';
import clsx from 'clsx';
import type { IncomeOverride, PaycheckEntry } from '../../types';
import { isSavingsAndGoalsIncome } from '@shared/incomePurpose';
import PaycheckIncomeRow from './PaycheckIncomeRow';

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

interface PaycheckIncomeSectionProps {
  paycheck: PaycheckEntry;
  formatCurrency: (amount: number) => string;
  incomeOverrides: IncomeOverride[];
  onSaveIncomeOverride: (incomeId: string, paycheckDate: string, amount: number) => Promise<void>;
  onClearIncomeOverride: (incomeId: string, paycheckDate: string) => Promise<void>;
  savingIncomeKey: string | null;
}

export default function PaycheckIncomeSection({
  paycheck,
  formatCurrency,
  incomeOverrides,
  onSaveIncomeOverride,
  onClearIncomeOverride,
  savingIncomeKey,
}: PaycheckIncomeSectionProps) {
  const [editingIncomeKey, setEditingIncomeKey] = useState<string | null>(null);
  const [draftIncomeAmount, setDraftIncomeAmount] = useState('');
  const isReserved = isSavingsAndGoalsIncome(paycheck);

  return (
    <div>
      <h4 className="text-sm font-medium text-(--color-text-secondary) mb-2 flex items-center gap-2">
        {isReserved ? <Landmark className="w-4 h-4" /> : <Wallet className="w-4 h-4" />}
        {isReserved ? 'Savings and goals deposit' : 'Income'}
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
          <span>{isReserved ? 'Deposit total' : 'Total Income'}</span>
          <span className={clsx(
            'font-mono',
            isReserved ? 'text-cyan-700 dark:text-cyan-400' : 'text-success-600 dark:text-success-500'
          )}>
            +{formatCurrency(paycheck.totalIncome)}
          </span>
        </div>
      </div>
    </div>
  );
}
