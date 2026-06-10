import { useState, useEffect } from 'react';
import { useBudget } from '../context/BudgetContext';
import { useDraft } from '../context/DraftContext';
import { useUnsavedChangesGuard } from '../hooks/useUnsavedChangesGuard';
import { Budget } from '../types';
import { Briefcase, Plus, Pencil, Trash2, Check, X, Zap, ArrowRight } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import clsx from 'clsx';

export default function BudgetsPage() {
  const {
    budgets,
    currentBudget,
    isQuickBudget,
    isLoading,
    loadBudgets,
    createBudget,
    updateBudget,
    deleteBudget,
    switchBudget,
    startQuickBudget,
    endQuickBudget,
  } = useBudget();
  const draft = useDraft();
  const { guardAction, unsavedDialog } = useUnsavedChangesGuard();

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newBudgetName, setNewBudgetName] = useState('');
  const [newBudgetBalance, setNewBudgetBalance] = useState(0);
  const [newTargetCash, setNewTargetCash] = useState(250);
  const [newMinCash, setNewMinCash] = useState(100);
  const [isCreating, setIsCreating] = useState(false);
  const [editingBudget, setEditingBudget] = useState<Budget | null>(null);
  const [editName, setEditName] = useState('');
  const [editBalance, setEditBalance] = useState(0);
  const [editTargetCash, setEditTargetCash] = useState(250);
  const [editMinCash, setEditMinCash] = useState(100);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  useEffect(() => {
    loadBudgets();
  }, [loadBudgets]);

  const handleCreateBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBudgetName.trim()) return;

    setIsCreating(true);
    try {
      await createBudget(newBudgetName.trim(), newBudgetBalance, newTargetCash, newMinCash);
      setNewBudgetName('');
      setNewBudgetBalance(0);
      setNewTargetCash(250);
      setNewMinCash(100);
      setShowCreateForm(false);
    } finally {
      setIsCreating(false);
    }
  };

  const handleStartEdit = (budget: Budget) => {
    setEditingBudget(budget);
    setEditName(budget.name);
    setEditBalance(budget.startingBalance);
    setEditTargetCash(budget.targetCashOnHand);
    setEditMinCash(budget.minCashOnHand);
  };

  const handleSaveEdit = async () => {
    if (!editingBudget || !editName.trim()) return;

    if (editingBudget.id === currentBudget?.id && draft.isDraftMode) {
      draft.updateBudgetFields({
        name: editName.trim(),
        startingBalance: editBalance,
        targetCashOnHand: editTargetCash,
        minCashOnHand: editMinCash,
      });
    } else {
      await updateBudget(editingBudget.id, {
        name: editName.trim(),
        startingBalance: editBalance,
        targetCashOnHand: editTargetCash,
        minCashOnHand: editMinCash,
      });
    }
    setEditingBudget(null);
  };

  const handleDelete = async (id: string) => {
    const success = await deleteBudget(id);
    if (success) {
      setDeleteConfirm(null);
    }
  };

  const handleSwitchToBudget = async (id: string) => {
    guardAction(async () => {
      if (isQuickBudget) {
        await endQuickBudget();
      }
      await switchBudget(id);
    }, 'switch budgets');
  };

  const isCurrent = (id: string) => currentBudget?.id === id && !isQuickBudget;

  return (
    <div className="space-y-6">
      {unsavedDialog}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Budgets</h2>
          <p className="text-[var(--color-text-secondary)]">
            Manage your budgets and switch between them
          </p>
        </div>
        
        <button
          onClick={() => setShowCreateForm(true)}
          className="btn btn-primary flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          New Budget
        </button>
      </div>

      {isQuickBudget && (
        <div className="p-4 rounded-lg border border-warning-400 dark:border-warning-600 bg-warning-50 dark:bg-warning-900">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Zap className="w-5 h-5 text-warning-700 dark:text-warning-200" />
              <div>
                <h3 className="font-semibold text-warning-900 dark:text-warning-100">
                  Quick Budget Active
                </h3>
                <p className="text-sm text-warning-800 dark:text-warning-200">
                  You're in a temporary session. Switch to a saved budget to persist your data.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {showCreateForm && (
        <div className="card">
          <h3 className="font-semibold mb-4">Create New Budget</h3>
          <form onSubmit={handleCreateBudget} className="space-y-4">
            <div>
              <label htmlFor="budgets-new-name" className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">
                Budget Name
              </label>
              <input
                id="budgets-new-name"
                type="text"
                value={newBudgetName}
                onChange={(e) => setNewBudgetName(e.target.value)}
                placeholder="e.g., Personal, Client: Smith, Side Business"
                className="input w-full"
                autoFocus
              />
            </div>
            <div>
              <label htmlFor="budgets-new-balance" className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">
                Starting Balance
              </label>
              <input
                id="budgets-new-balance"
                type="number"
                value={newBudgetBalance}
                onChange={(e) => setNewBudgetBalance(parseFloat(e.target.value) || 0)}
                placeholder="0"
                className="input w-full"
                min="0"
                step="0.01"
              />
              <p className="text-xs text-[var(--color-text-muted)] mt-1">
                Initial account balance for schedule projections
              </p>
            </div>
            <div>
              <label htmlFor="budgets-new-target" className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">
                Target Cash on Hand
              </label>
              <input
                id="budgets-new-target"
                type="number"
                value={newTargetCash}
                onChange={(e) => setNewTargetCash(parseFloat(e.target.value) || 0)}
                placeholder="250"
                className="input w-full"
                min="0"
                step="1"
              />
              <p className="text-xs text-[var(--color-text-muted)] mt-1">
                Budget remaining target per paycheck (excess goes to savings)
              </p>
            </div>
            <div>
              <label htmlFor="budgets-new-min" className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">
                Minimum Cash on Hand
              </label>
              <input
                id="budgets-new-min"
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
                onClick={() => {
                  setShowCreateForm(false);
                  setNewBudgetName('');
                  setNewBudgetBalance(0);
                  setNewTargetCash(250);
                  setNewMinCash(100);
                }}
                className="btn btn-secondary"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!newBudgetName.trim() || isCreating}
                className="btn btn-primary"
              >
                {isCreating ? 'Creating...' : 'Create Budget'}
              </button>
            </div>
          </form>
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-8 text-[var(--color-text-muted)]">
          Loading budgets...
        </div>
      ) : budgets.length === 0 ? (
        <div className="text-center py-16 text-[var(--color-text-muted)]">
          <Briefcase className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>No budgets yet. Create your first budget to get started.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {budgets.map((budget) => (
            <div
              key={budget.id}
              className={clsx(
                'card',
                isCurrent(budget.id) && 'ring-2 ring-primary-500'
              )}
            >
              {editingBudget?.id === budget.id ? (
                <div className="space-y-3">
                  <div>
                    <label htmlFor={`edit-name-${budget.id}`} className="block text-sm text-[var(--color-text-secondary)] mb-1">
                      Name
                    </label>
                    <input
                      id={`edit-name-${budget.id}`}
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
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
                      value={editBalance}
                      onChange={(e) => setEditBalance(parseFloat(e.target.value) || 0)}
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
                      value={editTargetCash}
                      onChange={(e) => setEditTargetCash(parseFloat(e.target.value) || 0)}
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
                      value={editMinCash}
                      onChange={(e) => setEditMinCash(parseFloat(e.target.value) || 0)}
                      className="input w-full"
                      min="0"
                      step="1"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setEditingBudget(null)}
                      className="btn btn-secondary btn-sm"
                    >
                      <X className="w-4 h-4" />
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveEdit}
                      disabled={!editName.trim()}
                      className="btn btn-primary btn-sm"
                    >
                      <Check className="w-4 h-4" />
                      Save
                    </button>
                  </div>
                </div>
              ) : deleteConfirm === budget.id ? (
                <div className="flex items-center justify-between">
                  <p className="text-danger-500">
                    Delete "{budget.name}"? This cannot be undone.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setDeleteConfirm(null)}
                      className="btn btn-secondary btn-sm"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => handleDelete(budget.id)}
                      className="btn btn-danger btn-sm"
                    >
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
                        {isCurrent(budget.id) && (
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
                    {!isCurrent(budget.id) && (
                      <button
                        onClick={() => handleSwitchToBudget(budget.id)}
                        className="btn btn-primary btn-sm flex items-center gap-1"
                      >
                        <ArrowRight className="w-4 h-4" />
                        Switch
                      </button>
                    )}
                    <button
                      onClick={() => handleStartEdit(budget)}
                      className="btn btn-ghost btn-sm"
                      aria-label={`Edit ${budget.name}`}
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    {!isCurrent(budget.id) && budgets.length > 1 && (
                      <button
                        onClick={() => setDeleteConfirm(budget.id)}
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
          ))}
        </div>
      )}

      <div className="card border-warning-400 dark:border-warning-600 bg-warning-50 dark:bg-warning-900">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Zap className="w-5 h-5 text-warning-700 dark:text-warning-200" />
            <div>
              <h3 className="font-semibold text-warning-900 dark:text-warning-100">
                Quick Budget
              </h3>
              <p className="text-sm text-warning-800 dark:text-warning-200">
                Start a temporary session for one-time consultations. Data is not saved.
              </p>
            </div>
          </div>
          <button
            onClick={startQuickBudget}
            disabled={isQuickBudget}
            className={clsx(
              'btn btn-sm',
              isQuickBudget ? 'btn-secondary opacity-50' : 'bg-warning-600 hover:bg-warning-700 text-white'
            )}
          >
            {isQuickBudget ? 'Active' : 'Start'}
          </button>
        </div>
      </div>
    </div>
  );
}
