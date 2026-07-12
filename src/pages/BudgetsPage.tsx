import { useState, useEffect } from 'react';
import { useBudget } from '../context/BudgetContext';
import { useDraft } from '../context/DraftContext';
import { useUnsavedChangesGuard } from '../hooks/useUnsavedChangesGuard';
import { Budget } from '../types';
import { Briefcase, Plus, Zap } from 'lucide-react';
import { useToast } from '../components/Toast';
import clsx from 'clsx';
import BudgetCard from '../components/budgets/BudgetCard';
import CreateBudgetForm, { BudgetFormValues } from '../components/budgets/CreateBudgetForm';

const INITIAL_BUDGET_VALUES: BudgetFormValues = {
  name: '',
  startingBalance: 0,
  targetCashOnHand: 250,
  minCashOnHand: 100,
};

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
  const { showToast } = useToast();
  const { guardAction, unsavedDialog } = useUnsavedChangesGuard();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newBudgetValues, setNewBudgetValues] = useState<BudgetFormValues>(INITIAL_BUDGET_VALUES);
  const [isCreating, setIsCreating] = useState(false);
  const [editingBudget, setEditingBudget] = useState<Budget | null>(null);
  const [editValues, setEditValues] = useState<BudgetFormValues>(INITIAL_BUDGET_VALUES);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  useEffect(() => {
    loadBudgets();
  }, [loadBudgets]);

  const resetCreateForm = () => {
    setShowCreateForm(false);
    setNewBudgetValues(INITIAL_BUDGET_VALUES);
  };

  const handleCreateBudget = async (event: React.FormEvent) => {
    event.preventDefault();
    const { name, startingBalance, targetCashOnHand, minCashOnHand } = newBudgetValues;
    if (!name.trim()) return;

    setIsCreating(true);
    try {
      await createBudget(name.trim(), startingBalance, targetCashOnHand, minCashOnHand);
      resetCreateForm();
    } finally {
      setIsCreating(false);
    }
  };

  const handleStartEdit = (budget: Budget) => {
    setEditingBudget(budget);
    setEditValues({
      name: budget.name,
      startingBalance: budget.startingBalance,
      targetCashOnHand: budget.targetCashOnHand,
      minCashOnHand: budget.minCashOnHand,
    });
  };

  const handleSaveEdit = async () => {
    const { name, startingBalance, targetCashOnHand, minCashOnHand } = editValues;
    if (!editingBudget || !name.trim()) return;

    if (editingBudget.id === currentBudget?.id && draft.isDraftMode) {
      draft.updateBudgetFields({
        name: name.trim(),
        startingBalance,
        targetCashOnHand,
        minCashOnHand,
      });
    } else {
      const savedName = name.trim();
      await updateBudget(editingBudget.id, {
        name: savedName,
        startingBalance,
        targetCashOnHand,
        minCashOnHand,
      });
      showToast('success', `${savedName} settings saved`);
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
          <p className="text-sm text-[var(--color-text-muted)] mt-2 max-w-2xl">
            Edit budget settings here. Switch to a budget to edit its incomes, bills, and schedule.
          </p>
        </div>

        <button onClick={() => setShowCreateForm(true)} className="btn btn-primary flex items-center gap-2">
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
                <h3 className="font-semibold text-warning-900 dark:text-warning-100">Quick Budget Active</h3>
                <p className="text-sm text-warning-800 dark:text-warning-200">
                  You're in a temporary session. Switch to a saved budget to persist your data.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {showCreateForm && (
        <CreateBudgetForm
          values={newBudgetValues}
          onChange={setNewBudgetValues}
          onSubmit={handleCreateBudget}
          onCancel={resetCreateForm}
          isCreating={isCreating}
        />
      )}

      {isLoading ? (
        <div className="text-center py-8 text-[var(--color-text-muted)]">Loading budgets...</div>
      ) : budgets.length === 0 ? (
        <div className="text-center py-16 text-[var(--color-text-muted)]">
          <Briefcase className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>No budgets yet. Create your first budget to get started.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {budgets.map((budget) => (
            <BudgetCard
              key={budget.id}
              budget={budget}
              isCurrent={isCurrent(budget.id)}
              budgetCount={budgets.length}
              isEditing={editingBudget?.id === budget.id}
              editValues={editValues}
              isDeleteConfirming={deleteConfirm === budget.id}
              onEditValuesChange={setEditValues}
              onStartEdit={handleStartEdit}
              onCancelEdit={() => setEditingBudget(null)}
              onSaveEdit={handleSaveEdit}
              onConfirmDelete={() => setDeleteConfirm(budget.id)}
              onCancelDelete={() => setDeleteConfirm(null)}
              onDelete={handleDelete}
              onSwitch={handleSwitchToBudget}
            />
          ))}
        </div>
      )}

      <div className="card border-warning-400 dark:border-warning-600 bg-warning-50 dark:bg-warning-900">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Zap className="w-5 h-5 text-warning-700 dark:text-warning-200" />
            <div>
              <h3 className="font-semibold text-warning-900 dark:text-warning-100">Quick Budget</h3>
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
