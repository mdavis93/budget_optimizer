import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { SavingsGoal, SavingsGoalInput, GoalProjection } from '../types';
import { Target, Plus } from 'lucide-react';
import { format } from 'date-fns';
import Modal from '../components/Modal';
import GoalCard from '../components/goals/GoalCard';
import GoalForm, { GoalFormValues } from '../components/goals/GoalForm';
import { useDraftData, useDraftStatus, useDraftActions } from '../context/DraftContext';
import { useBudget } from '../context/BudgetContext';

const INITIAL_FORM_VALUES: GoalFormValues = {
  name: '',
  targetAmount: 0,
  targetDate: '',
  alreadySaved: 0,
  priority: 1,
};

export default function GoalsPage() {
  const { goals, budgetFields } = useDraftData();
  const { dirtyDomains } = useDraftStatus();
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
  const [formValues, setFormValues] = useState<GoalFormValues>(INITIAL_FORM_VALUES);
  const [isSaving, setIsSaving] = useState(false);

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

  const resetForm = () => setFormValues(INITIAL_FORM_VALUES);

  const handleOpenCreate = () => {
    const defaultDate = new Date();
    defaultDate.setMonth(defaultDate.getMonth() + 6);
    setFormValues({ ...INITIAL_FORM_VALUES, targetDate: format(defaultDate, 'yyyy-MM-dd') });
    setShowCreateModal(true);
  };

  const handleOpenEdit = (goal: SavingsGoal) => {
    setFormValues({
      name: goal.name,
      targetAmount: goal.targetAmount,
      targetDate: goal.targetDate,
      alreadySaved: goal.alreadySaved,
      priority: goal.priority,
    });
    setEditingGoal(goal);
  };

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    const { name, targetAmount, targetDate, alreadySaved, priority } = formValues;
    if (!name.trim() || targetAmount <= 0 || !targetDate) return;

    setIsSaving(true);
    try {
      const input: SavingsGoalInput = {
        name: name.trim(),
        targetAmount,
        targetDate,
        alreadySaved,
        priority,
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

  const handleUpdate = async (event: React.FormEvent) => {
    event.preventDefault();
    const { name, targetAmount, targetDate, alreadySaved, priority } = formValues;
    if (!editingGoal || !name.trim() || targetAmount <= 0 || !targetDate) return;

    setIsSaving(true);
    try {
      const updates = {
        name: name.trim(),
        targetAmount,
        targetDate,
        alreadySaved,
        priority,
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500" />
      </div>
    );
  }

  const minCashOnHand = budgetFields?.minCashOnHand ?? 100;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Savings Goals</h2>
          <p className="text-[var(--color-text-secondary)]">
            See whether your goals fit your real paycheck schedule — and how much room you have left.
          </p>
        </div>

        <button onClick={handleOpenCreate} className="btn btn-primary flex items-center gap-2">
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
          <button onClick={handleOpenCreate} className="btn btn-primary inline-flex items-center gap-2">
            <Plus className="w-4 h-4" />
            Create Your First Goal
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {goals.map((goal) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              projection={projections.find((projection) => projection.goalId === goal.id)}
              minCashOnHand={minCashOnHand}
              onEdit={handleOpenEdit}
              onDelete={setDeleteConfirm}
              onViewSchedule={handleViewSchedule}
            />
          ))}
        </div>
      )}

      <Modal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} title="Create Savings Goal">
        <GoalForm
          values={formValues}
          onChange={setFormValues}
          onSubmit={handleCreate}
          onCancel={() => setShowCreateModal(false)}
          isSaving={isSaving}
          mode="create"
          idPrefix="create"
        />
      </Modal>

      <Modal isOpen={!!editingGoal} onClose={() => setEditingGoal(null)} title="Edit Savings Goal">
        <GoalForm
          values={formValues}
          onChange={setFormValues}
          onSubmit={handleUpdate}
          onCancel={() => setEditingGoal(null)}
          isSaving={isSaving}
          mode="edit"
          idPrefix="edit"
        />
      </Modal>

      <Modal isOpen={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} title="Delete Goal">
        <p className="text-[var(--color-text-secondary)] mb-6">
          Are you sure you want to delete this goal? This action cannot be undone.
        </p>
        <div className="flex gap-3">
          <button onClick={() => setDeleteConfirm(null)} className="btn btn-secondary flex-1">
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
