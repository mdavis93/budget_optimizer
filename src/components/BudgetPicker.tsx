import { useState, useEffect } from 'react';
import { useBudget } from '../context/BudgetContext';
import { Briefcase, Plus, Zap, Calendar, DollarSign } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import clsx from 'clsx';

interface BudgetPickerProps {
  onBudgetSelected: () => void;
}

export default function BudgetPicker({ onBudgetSelected }: BudgetPickerProps) {
  const { budgets, loadBudgets, isLoading, switchBudget, startQuickBudget, createBudget } = useBudget();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newBudgetName, setNewBudgetName] = useState('');
  const [newBudgetBalance, setNewBudgetBalance] = useState(0);
  const [newTargetCash, setNewTargetCash] = useState(250);
  const [newMinCash, setNewMinCash] = useState(100);
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    loadBudgets();
  }, [loadBudgets]);

  const handleSelectBudget = async (budgetId: string) => {
    await switchBudget(budgetId);
    onBudgetSelected();
  };

  const handleStartQuickBudget = async () => {
    await startQuickBudget();
    onBudgetSelected();
  };

  const handleCreateBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBudgetName.trim()) return;

    setIsCreating(true);
    try {
      const budget = await createBudget(newBudgetName.trim(), newBudgetBalance, newTargetCash, newMinCash);
      await switchBudget(budget.id);
      onBudgetSelected();
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-bg-primary)] p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary-100 dark:bg-primary-900/30 mb-4">
            <Briefcase className="w-8 h-8 text-primary-600 dark:text-primary-400" />
          </div>
          <h1 className="text-2xl font-bold">Select a Budget</h1>
          <p className="text-[var(--color-text-secondary)] mt-2">
            Choose a budget to work with or create a new one
          </p>
        </div>

        {isLoading ? (
          <div className="text-center py-8 text-[var(--color-text-muted)]">
            Loading budgets...
          </div>
        ) : (
          <div className="space-y-3">
            {budgets.map((budget) => (
              <button
                key={budget.id}
                onClick={() => handleSelectBudget(budget.id)}
                className="w-full p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] hover:border-primary-500 hover:bg-[var(--color-bg-tertiary)] transition-colors text-left group"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center">
                      <Briefcase className="w-5 h-5 text-primary-600 dark:text-primary-400" />
                    </div>
                    <div>
                      <h3 className="font-semibold group-hover:text-primary-500 transition-colors">
                        {budget.name}
                      </h3>
                      <div className="flex items-center gap-3 text-xs text-[var(--color-text-muted)]">
                        <span>{budget.incomeCount} income{budget.incomeCount !== 1 ? 's' : ''}</span>
                        <span>·</span>
                        <span>{budget.billCount} bill{budget.billCount !== 1 ? 's' : ''}</span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right text-xs text-[var(--color-text-muted)]">
                    <div className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {format(parseISO(budget.updatedAt), 'MMM d')}
                    </div>
                    <div className="flex items-center gap-1 mt-1">
                      <DollarSign className="w-3 h-3" />
                      {budget.startingBalance.toLocaleString()} balance
                    </div>
                    <div className="mt-1">
                      ${budget.targetCashOnHand.toLocaleString()} target · ${budget.minCashOnHand.toLocaleString()} min
                    </div>
                  </div>
                </div>
              </button>
            ))}

            {showCreateForm ? (
              <form onSubmit={handleCreateBudget} className="p-4 rounded-lg border border-primary-500 bg-[var(--color-bg-secondary)]">
                <h3 className="font-semibold mb-3">Create New Budget</h3>
                <div className="space-y-3">
                  <div>
                    <label htmlFor="picker-budget-name" className="block text-sm text-[var(--color-text-secondary)] mb-1">
                      Budget Name
                    </label>
                    <input
                      id="picker-budget-name"
                      type="text"
                      value={newBudgetName}
                      onChange={(e) => setNewBudgetName(e.target.value)}
                      placeholder="e.g., Personal, Client: Smith"
                      className="input w-full"
                      autoFocus
                    />
                  </div>
                  <div>
                    <label htmlFor="picker-starting-balance" className="block text-sm text-[var(--color-text-secondary)] mb-1">
                      Starting Balance
                    </label>
                    <input
                      id="picker-starting-balance"
                      type="number"
                      value={newBudgetBalance}
                      onChange={(e) => setNewBudgetBalance(parseFloat(e.target.value) || 0)}
                      placeholder="0"
                      className="input w-full"
                      min="0"
                      step="0.01"
                    />
                  </div>
                  <div>
                    <label htmlFor="picker-target-cash" className="block text-sm text-[var(--color-text-secondary)] mb-1">
                      Target Cash on Hand
                    </label>
                    <input
                      id="picker-target-cash"
                      type="number"
                      value={newTargetCash}
                      onChange={(e) => setNewTargetCash(parseFloat(e.target.value) || 0)}
                      placeholder="250"
                      className="input w-full"
                      min="0"
                      step="1"
                    />
                    <p className="text-xs text-[var(--color-text-muted)] mt-1">
                      Excess over this amount goes to savings
                    </p>
                  </div>
                  <div>
                    <label htmlFor="picker-min-cash" className="block text-sm text-[var(--color-text-secondary)] mb-1">
                      Minimum Cash on Hand
                    </label>
                    <input
                      id="picker-min-cash"
                      type="number"
                      value={newMinCash}
                      onChange={(e) => setNewMinCash(parseFloat(e.target.value) || 0)}
                      placeholder="100"
                      className="input w-full"
                      min="0"
                      step="1"
                    />
                    <p className="text-xs text-[var(--color-text-muted)] mt-1">
                      Protected floor for pocket cash (goals cannot consume below this)
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setShowCreateForm(false)}
                      className="btn btn-secondary flex-1"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={!newBudgetName.trim() || isCreating}
                      className="btn btn-primary flex-1"
                    >
                      {isCreating ? 'Creating...' : 'Create & Open'}
                    </button>
                  </div>
                </div>
              </form>
            ) : (
              <button
                onClick={() => setShowCreateForm(true)}
                className="w-full p-4 rounded-lg border border-dashed border-[var(--color-border)] hover:border-primary-500 hover:bg-[var(--color-bg-tertiary)] transition-colors text-left flex items-center gap-3"
              >
                <div className="w-10 h-10 rounded-full bg-[var(--color-bg-tertiary)] flex items-center justify-center">
                  <Plus className="w-5 h-5 text-[var(--color-text-muted)]" />
                </div>
                <div>
                  <h3 className="font-medium">Create New Budget</h3>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    Start a new budget from scratch
                  </p>
                </div>
              </button>
            )}

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-[var(--color-border)]" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-[var(--color-bg-primary)] px-2 text-[var(--color-text-muted)]">
                  or
                </span>
              </div>
            </div>

            <button
              onClick={handleStartQuickBudget}
              className={clsx(
                'w-full p-4 rounded-lg border transition-colors text-left flex items-center gap-3',
                'border-warning-400 dark:border-warning-600',
                'bg-warning-50 dark:bg-warning-900',
                'hover:bg-warning-100 dark:hover:bg-warning-800'
              )}
            >
              <div className="w-10 h-10 rounded-full bg-warning-200 dark:bg-warning-700 flex items-center justify-center">
                <Zap className="w-5 h-5 text-warning-800 dark:text-warning-100" />
              </div>
              <div>
                <h3 className="font-medium text-warning-900 dark:text-warning-100">
                  Quick Budget
                </h3>
                <p className="text-xs text-warning-800 dark:text-warning-200">
                  Temporary session - data will not be saved
                </p>
              </div>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
