import { Pencil } from 'lucide-react';
import { PaycheckEntry } from '../../types';

interface PaycheckIncomeRowProps {
  source: PaycheckEntry['incomeSources'][number];
  rowKey: string;
  overridden: boolean;
  isEditing: boolean;
  isSaving: boolean;
  draftIncomeAmount: string;
  formatCurrency: (amount: number) => string;
  onEdit: () => void;
  onDraftChange: (value: string) => void;
  onSave: () => Promise<void>;
  onCancel: () => void;
  onClear: () => Promise<void>;
}

export default function PaycheckIncomeRow({
  source,
  rowKey,
  overridden,
  isEditing,
  isSaving,
  draftIncomeAmount,
  formatCurrency,
  onEdit,
  onDraftChange,
  onSave,
  onCancel,
  onClear,
}: PaycheckIncomeRowProps) {
  return (
    <div
      key={rowKey}
      className="py-2 px-3 bg-success-50 dark:bg-success-500/10 rounded-lg space-y-2"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{source.name}</span>
        <div className="flex items-center gap-2">
          {!isEditing && (
            <>
              <span className="font-mono font-semibold text-success-600 dark:text-success-500">
                +{formatCurrency(source.amount)}
              </span>
              {overridden && (
                <span className="text-xs text-amber-700 dark:text-amber-400 font-medium">
                  Adjusted
                </span>
              )}
              <button
                type="button"
                title="Edit gross income for this paycheck"
                onClick={onEdit}
                className="p-1.5 rounded-md text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]"
              >
                <Pencil className="w-4 h-4" />
              </button>
              {overridden && (
                <button
                  type="button"
                  className="text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline"
                  onClick={onClear}
                  disabled={isSaving}
                >
                  Clear
                </button>
              )}
            </>
          )}
        </div>
      </div>
      {isEditing && (
        <div className="flex flex-wrap items-end gap-2 pt-1 border-t border-success-200/60 dark:border-success-500/20">
          <div className="flex-1 min-w-[140px]">
            <label className="text-xs text-[var(--color-text-muted)] block mb-0.5">
              Gross for this paycheck
            </label>
            <input
              type="number"
              min={0}
              step="0.01"
              className="input w-full"
              value={draftIncomeAmount}
              onChange={(e) => onDraftChange(e.target.value)}
              disabled={isSaving}
            />
          </div>
          <button
            type="button"
            className="btn-primary text-sm"
            disabled={isSaving}
            onClick={onSave}
          >
            Save
          </button>
          <button
            type="button"
            className="btn-secondary text-sm"
            disabled={isSaving}
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
