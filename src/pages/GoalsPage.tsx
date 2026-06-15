import { useState, useEffect, useCallback, useId } from 'react';
import { useNavigate } from 'react-router-dom';
import { SavingsGoal, SavingsGoalInput, GoalProjection } from '../types';
import { Target, Plus, Pencil, Trash2 } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import clsx from 'clsx';
import Modal from '../components/Modal';
import GoalAchievabilityPanel from '../components/goals/GoalAchievabilityPanel';
import { useDraftData, useDraftActions } from '../context/DraftContext';
import { useBudget } from '../context/BudgetContext';
import { buildGoalAchievabilityMessaging } from '../utils/goalAchievabilityMessaging';

export default function GoalsPage() {
  const { goals, dirtyDomains, budgetFields } = useDraftData();
  const {
    getGoalProjections,
    reloadSnapshot,
    createGoal,
    updateGoal,
    deleteGoal,
  } = useDraftActions();
  const navigate = useNavigate();
  const { isQuickBudget } = useBudget();
  const [projections, setProjections] = useState<GoalProjection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingGoal, setEditingGoal] = useState<SavingsGoal | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  
  const [formName, setFormName] = useState('');
  const [formAmount, setFormAmount] = useState(0);
  const [formDate, setFormDate] = useState('');
  const [formSaved, setFormSaved] = useState(0);
  const [formPriority, setFormPriority] = useState(1);
  const [isSaving, setIsSaving] = useState(false);

  const nameInputId = useId();
  const amountInputId = useId();
  const dateInputId = useId();
  const savedInputId = useId();
  const priorityInputId = useId();

  const loadProjections = useCallback(async () => {
    try {
      const data = await getGoalProjections();
      setProjections(data);
    } catch {
      // Projections will remain empty on error
    }
  }, [getGoalProjections]);

  useEffect(() => {
    let isMounted = true;

    const doLoad = async () => {
      setIsLoading(true);
      try {
        if (isQuickBudget) {
          await reloadSnapshot();
        }
        if (isMounted) {
          await loadProjections();
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void doLoad();
    return () => { isMounted = false; };
  }, [goals, dirtyDomains.size, isQuickBudget, reloadSnapshot, loadProjections]);

  const refreshData = useCallback(async () => {
    await loadProjections();
  }, [loadProjections]);

  const resetForm = () => {
    setFormName('');
    setFormAmount(0);
    setFormDate('');
    setFormSaved(0);
    setFormPriority(1);
  };

  const handleOpenCreate = () => {
    resetForm();
    const defaultDate = new Date();
    defaultDate.setMonth(defaultDate.getMonth() + 6);
    setFormDate(format(defaultDate, 'yyyy-MM-dd'));
    setShowCreateModal(true);
  };

  const handleOpenEdit = (goal: SavingsGoal) => {
    setFormName(goal.name);
    setFormAmount(goal.targetAmount);
    setFormDate(goal.targetDate);
    setFormSaved(goal.alreadySaved);
    setFormPriority(goal.priority);
    setEditingGoal(goal);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim() || formAmount <= 0 || !formDate) return;

    setIsSaving(true);
    try {
      const input: SavingsGoalInput = {
        name: formName.trim(),
        targetAmount: formAmount,
        targetDate: formDate,
        alreadySaved: formSaved,
        priority: formPriority,
      };
      if (isQuickBudget) {
        const result = await window.electronAPI.goals.create(input);
        if (result.success) {
          await reloadSnapshot();
          setShowCreateModal(false);
          resetForm();
          await refreshData();
        }
      } else if (createGoal(input)) {
        setShowCreateModal(false);
        resetForm();
        await refreshData();
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingGoal || !formName.trim() || formAmount <= 0 || !formDate) return;

    setIsSaving(true);
    try {
      const updates = {
        name: formName.trim(),
        targetAmount: formAmount,
        targetDate: formDate,
        alreadySaved: formSaved,
        priority: formPriority,
      };
      if (isQuickBudget) {
        const result = await window.electronAPI.goals.update(editingGoal.id, updates);
        if (result.success) {
          await reloadSnapshot();
          setEditingGoal(null);
          resetForm();
          await refreshData();
        }
      } else if (updateGoal(editingGoal.id, updates)) {
        setEditingGoal(null);
        resetForm();
        await refreshData();
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (isQuickBudget) {
      const result = await window.electronAPI.goals.delete(id);
      if (result.success) {
        await reloadSnapshot();
        setDeleteConfirm(null);
        await refreshData();
      }
    } else if (deleteGoal(id)) {
      setDeleteConfirm(null);
      await refreshData();
    }
  };

  const getProjection = (goalId: string): GoalProjection | undefined => {
    return projections.find(p => p.goalId === goalId);
  };

  const minCashOnHand = budgetFields?.minCashOnHand ?? 100;

  const handleViewSchedule = useCallback(
    (link: { goalId: string; highlightPaycheckDate?: string }) => {
      const params = new URLSearchParams();
      params.set('goalId', link.goalId);
      if (link.highlightPaycheckDate) {
        params.set('paycheck', link.highlightPaycheckDate);
      }
      navigate(`/schedule?${params.toString()}`);
    },
    [navigate]
  );

  const getProgressBarColor = () => 'bg-purple-500';

  const formatCurrency = (amount: number) => {
    return amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Savings Goals</h2>
          <p className="text-[var(--color-text-secondary)]">
            See whether your goals fit your real paycheck schedule — and how much room you have left.
          </p>
        </div>
        
        <button
          onClick={handleOpenCreate}
          className="btn btn-primary flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Add Goal
        </button>
      </div>

      {goals.length === 0 ? (
        <div className="card text-center py-12">
          <Target className="w-12 h-12 mx-auto text-[var(--color-text-muted)] mb-4" />
          <h3 className="text-lg font-medium mb-2">No savings goals yet</h3>
          <p className="text-[var(--color-text-secondary)] mb-4">
            Create a goal to start tracking your savings targets
          </p>
          <button
            onClick={handleOpenCreate}
            className="btn btn-primary inline-flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Create Your First Goal
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {goals.map((goal) => {
            const projection = getProjection(goal.id);
            const remainingAmount = goal.targetAmount - goal.alreadySaved;
            const messaging = projection
              ? buildGoalAchievabilityMessaging(goal, projection, minCashOnHand)
              : null;
            const statusPercentColor =
              projection && projection.achievabilityPercent >= 100
                ? 'text-success-600 dark:text-success-400'
                : projection && projection.achievabilityPercent >= 50
                  ? 'text-warning-600 dark:text-warning-400'
                  : 'text-danger-600 dark:text-danger-400';
            
            return (
              <div key={goal.id} className="card">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-[var(--color-surface-hover)]">
                      <Target className="w-5 h-5 text-[var(--color-text-muted)]" />
                    </div>
                    <div>
                      <h3 className="font-semibold">{goal.name}</h3>
                      <p className="text-sm text-[var(--color-text-secondary)]">
                        Priority: {goal.priority}
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleOpenEdit(goal)}
                      className="p-2 hover:bg-[var(--color-surface-hover)] rounded-lg transition-colors"
                      aria-label={`Edit ${goal.name}`}
                    >
                      <Pencil className="w-4 h-4 text-[var(--color-text-muted)]" />
                    </button>
                    <button
                      onClick={() => setDeleteConfirm(goal.id)}
                      className="p-2 hover:bg-danger-100 dark:hover:bg-danger-900/30 rounded-lg transition-colors"
                      aria-label={`Delete ${goal.name}`}
                    >
                      <Trash2 className="w-4 h-4 text-danger-500" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                  <div>
                    <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wide">Target</p>
                    <p className="font-semibold">{formatCurrency(goal.targetAmount)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wide">Already Saved</p>
                    <p className="font-semibold">{formatCurrency(goal.alreadySaved)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wide">Remaining</p>
                    <p className="font-semibold">{formatCurrency(remainingAmount)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wide">Deadline</p>
                    <p className="font-semibold">{format(parseISO(goal.targetDate), 'MMM yyyy')}</p>
                  </div>
                </div>

                {projection ? (
                  <>
                    <div className="mb-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium">Achievability</span>
                        <span className={clsx('text-sm font-semibold', statusPercentColor)}>
                          {projection.achievabilityPercent}%
                        </span>
                      </div>
                      <div className="relative w-full bg-[var(--color-surface-hover)] rounded-full h-5">
                        <div
                          className={clsx('h-5 rounded-full transition-all', getProgressBarColor())}
                          style={{ width: `${Math.min(100, projection.achievabilityPercent)}%` }}
                        />
                        {projection.achievabilityPercent < 90 && (
                          <span
                            className="absolute inset-0 flex items-center justify-center text-xs font-medium"
                            style={{
                              color: projection.achievabilityPercent > 30 ? 'white' : 'var(--color-text-secondary)',
                              textShadow: projection.achievabilityPercent > 30 ? '0 1px 2px rgba(0,0,0,0.3)' : 'none',
                            }}
                          >
                            {formatCurrency(goal.alreadySaved + (projection.actualAllocation || 0))} allocated
                          </span>
                        )}
                      </div>
                    </div>

                    <GoalAchievabilityPanel
                      goal={goal}
                      projection={projection}
                      messaging={messaging}
                      minCashOnHand={minCashOnHand}
                      isLoading={false}
                      onViewSchedule={handleViewSchedule}
                      onEditGoal={() => handleOpenEdit(goal)}
                    />
                  </>
                ) : (
                  <GoalAchievabilityPanel
                    goal={goal}
                    projection={null}
                    messaging={null}
                    isLoading
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Create Modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Create Savings Goal"
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label htmlFor={nameInputId} className="block text-sm font-medium mb-1">Goal Name</label>
            <input
              id={nameInputId}
              type="text"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              className="input w-full"
              placeholder="e.g., Hawaii Trip"
              required
            />
          </div>
          
          <div>
            <label htmlFor={amountInputId} className="block text-sm font-medium mb-1">Target Amount</label>
            <input
              id={amountInputId}
              type="number"
              value={formAmount || ''}
              onChange={(e) => setFormAmount(parseFloat(e.target.value) || 0)}
              className="input w-full"
              placeholder="0.00"
              min="0"
              step="0.01"
              required
            />
          </div>
          
          <div>
            <label htmlFor={dateInputId} className="block text-sm font-medium mb-1">Target Date</label>
            <input
              id={dateInputId}
              type="date"
              value={formDate}
              onChange={(e) => setFormDate(e.target.value)}
              className="input w-full"
              required
            />
          </div>
          
          <div>
            <label htmlFor={savedInputId} className="block text-sm font-medium mb-1">Already Saved (Optional)</label>
            <input
              id={savedInputId}
              type="number"
              value={formSaved || ''}
              onChange={(e) => setFormSaved(parseFloat(e.target.value) || 0)}
              className="input w-full"
              placeholder="0.00"
              min="0"
              step="0.01"
            />
            <p className="text-xs text-[var(--color-text-muted)] mt-1">
              Amount you've already set aside for this goal
            </p>
          </div>
          
          <div>
            <label htmlFor={priorityInputId} className="block text-sm font-medium mb-1">Priority</label>
            <select
              id={priorityInputId}
              value={formPriority}
              onChange={(e) => setFormPriority(parseInt(e.target.value))}
              className="input w-full"
            >
              <option value={1}>1 - Highest</option>
              <option value={2}>2 - High</option>
              <option value={3}>3 - Medium</option>
              <option value={4}>4 - Low</option>
              <option value={5}>5 - Lowest</option>
            </select>
            <p className="text-xs text-[var(--color-text-muted)] mt-1">
              Higher priority goals are funded first
            </p>
          </div>
          
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={() => setShowCreateModal(false)}
              className="btn btn-secondary flex-1"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving || !formName.trim() || formAmount <= 0 || !formDate}
              className="btn btn-primary flex-1"
            >
              {isSaving ? 'Creating...' : 'Create Goal'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Edit Modal */}
      <Modal
        isOpen={!!editingGoal}
        onClose={() => setEditingGoal(null)}
        title="Edit Savings Goal"
      >
        <form onSubmit={handleUpdate} className="space-y-4">
          <div>
            <label htmlFor={`edit-${nameInputId}`} className="block text-sm font-medium mb-1">Goal Name</label>
            <input
              id={`edit-${nameInputId}`}
              type="text"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              className="input w-full"
              required
            />
          </div>
          
          <div>
            <label htmlFor={`edit-${amountInputId}`} className="block text-sm font-medium mb-1">Target Amount</label>
            <input
              id={`edit-${amountInputId}`}
              type="number"
              value={formAmount || ''}
              onChange={(e) => setFormAmount(parseFloat(e.target.value) || 0)}
              className="input w-full"
              min="0"
              step="0.01"
              required
            />
          </div>
          
          <div>
            <label htmlFor={`edit-${dateInputId}`} className="block text-sm font-medium mb-1">Target Date</label>
            <input
              id={`edit-${dateInputId}`}
              type="date"
              value={formDate}
              onChange={(e) => setFormDate(e.target.value)}
              className="input w-full"
              required
            />
          </div>
          
          <div>
            <label htmlFor={`edit-${savedInputId}`} className="block text-sm font-medium mb-1">Already Saved</label>
            <input
              id={`edit-${savedInputId}`}
              type="number"
              value={formSaved || ''}
              onChange={(e) => setFormSaved(parseFloat(e.target.value) || 0)}
              className="input w-full"
              min="0"
              step="0.01"
            />
          </div>
          
          <div>
            <label htmlFor={`edit-${priorityInputId}`} className="block text-sm font-medium mb-1">Priority</label>
            <select
              id={`edit-${priorityInputId}`}
              value={formPriority}
              onChange={(e) => setFormPriority(parseInt(e.target.value))}
              className="input w-full"
            >
              <option value={1}>1 - Highest</option>
              <option value={2}>2 - High</option>
              <option value={3}>3 - Medium</option>
              <option value={4}>4 - Low</option>
              <option value={5}>5 - Lowest</option>
            </select>
          </div>
          
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={() => setEditingGoal(null)}
              className="btn btn-secondary flex-1"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving || !formName.trim() || formAmount <= 0 || !formDate}
              className="btn btn-primary flex-1"
            >
              {isSaving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        title="Delete Goal"
      >
        <p className="text-[var(--color-text-secondary)] mb-6">
          Are you sure you want to delete this goal? This action cannot be undone.
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => setDeleteConfirm(null)}
            className="btn btn-secondary flex-1"
          >
            Cancel
          </button>
          <button
            onClick={() => deleteConfirm && handleDelete(deleteConfirm)}
            className="btn bg-danger-500 hover:bg-danger-600 text-white flex-1"
          >
            Delete
          </button>
        </div>
      </Modal>
    </div>
  );
}
