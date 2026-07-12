import { ArrowRight, Briefcase, Check, Pencil, Trash2, X } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import clsx from 'clsx';
import { Budget, BudgetWithStats } from '../../types';
import { BudgetFormValues } from './CreateBudgetForm';

interface BudgetCardProps {
  budget: BudgetWithStats;
  isCurrent: boolean;
  budgetCount: number;
  isEditing: boolean;
  editValues: BudgetFormValues;
  isDeleteConfirming: boolean;
  onEditValuesChange: (values: BudgetFormValues) => void;
  onStartEdit: (budget: Budget) => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  onDelete: (budgetId: string) => void;
  onSwitch: (budgetId: string) => void;
}

export default function BudgetCard({
  budget,
  isCurrent,
  budgetCount,
  isEditing,
  editValues,
  isDeleteConfirming,
  onEditValuesChange,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onConfirmDelete,
  onCancelDelete,
  onDelete,
  onSwitch,
}: BudgetCardProps) {
  return (
    <div className={clsx('card', isCurrent && 'ring-2 ring-primary-500')}>
      {isEditing ? (
        <div className="space-y-3">
          <div>
            <label htmlFor={`edit-name-${budget.id}`} className="block text-sm text-[var(--color-text-secondary)] mb-1">
              Name
            </label>
            <input
              id={`edit-name-${budget.id}`}
              type="text"
              value={editValues.name}
              onChange={(event) => onEditValuesChange({ ...editValues, name: event.target.value })}
              className="input w-full"
              autoFocus
            />
          </div>
          <div>
            <label htmlFor={`edit-balance-${budget.id}`} className="block text-sm text-[var(--color-text-secondary)] mb-1">
              Starting Balance
            </label>
            <input
              id={`edit-balance-${budget.id}`}
              type="number"
              value={editValues.startingBalance}
              onChange={(event) => onEditValuesChange({ ...editValues, startingBalance: parseFloat(event.target.value) || 0 })}
              className="input w-full"
              min="0"
              step="0.01"
            />
          </div>
          <div>
            <label htmlFor={`edit-target-${budget.id}`} className="block text-sm text-[var(--color-text-secondary)] mb-1">
              Target Cash on Hand
            </label>
            <input
              id={`edit-target-${budget.id}`}
              type="number"
              value={editValues.targetCashOnHand}
              onChange={(event) => onEditValuesChange({ ...editValues, targetCashOnHand: parseFloat(event.target.value) || 0 })}
              className="input w-full"
              min="0"
              step="1"
            />
          </div>
          <div>
            <label htmlFor={`edit-min-${budget.id}`} className="block text-sm text-[var(--color-text-secondary)] mb-1">
              Minimum Cash on Hand
            </label>
            <input
              id={`edit-min-${budget.id}`}
              type="number"
              value={editValues.minCashOnHand}
              onChange={(event) => onEditValuesChange({ ...editValues, minCashOnHand: parseFloat(event.target.value) || 0 })}
              className="input w-full"
              min="0"
              step="1"
            />
          </div>
          <div className="flex gap-2">
            <button onClick={onCancelEdit} className="btn btn-secondary btn-sm">
              <X className="w-4 h-4" />
              Cancel
            </button>
            <button onClick={onSaveEdit} disabled={!editValues.name.trim()} className="btn btn-primary btn-sm">
              <Check className="w-4 h-4" />
              Save
            </button>
          </div>
        </div>
      ) : isDeleteConfirming ? (
        <div className="flex items-center justify-between">
          <p className="text-danger-500">
            Delete "{budget.name}"? This cannot be undone.
          </p>
          <div className="flex gap-2">
            <button onClick={onCancelDelete} className="btn btn-secondary btn-sm">
              Cancel
            </button>
            <button onClick={() => onDelete(budget.id)} className="btn btn-danger btn-sm">
              Delete
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center">
              <Briefcase className="w-6 h-6 text-primary-600 dark:text-primary-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold">{budget.name}</h3>
                {isCurrent && (
                  <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300">
                    Current
                  </span>
                )}
              </div>
              <div className="flex items-center gap-4 text-sm text-[var(--color-text-muted)]">
                <span>{budget.incomeCount} income{budget.incomeCount !== 1 ? 's' : ''}</span>
                <span>·</span>
                <span>{budget.billCount} bill{budget.billCount !== 1 ? 's' : ''}</span>
                <span>·</span>
                <span>${budget.startingBalance.toLocaleString()} starting</span>
                <span>·</span>
                <span>${budget.targetCashOnHand.toLocaleString()} target</span>
                <span>·</span>
                <span>${budget.minCashOnHand.toLocaleString()} min</span>
              </div>
              <p className="text-xs text-[var(--color-text-muted)] mt-1">
                Updated {format(parseISO(budget.updatedAt), 'MMM d, yyyy')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!isCurrent && (
              <button onClick={() => onSwitch(budget.id)} className="btn btn-primary btn-sm flex items-center gap-1">
                <ArrowRight className="w-4 h-4" />
                Switch
              </button>
            )}
            <button onClick={() => onStartEdit(budget)} className="btn btn-ghost btn-sm" aria-label={`Edit ${budget.name}`}>
              <Pencil className="w-4 h-4" />
            </button>
            {!isCurrent && budgetCount > 1 && (
              <button
                onClick={onConfirmDelete}
                className="btn btn-ghost btn-sm text-danger-500 hover:bg-danger-50 dark:hover:bg-danger-900/20"
                aria-label={`Delete ${budget.name}`}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
