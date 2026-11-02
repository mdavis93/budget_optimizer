import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { SavingsGoal, SavingsGoalInput } from '../types';
import { Target, Plus } from 'lucide-react';
import { format } from 'date-fns';
import Modal from '../components/Modal';
import GoalCard from '../components/goals/GoalCard';
import GoalForm, { GoalFormValues } from '../components/goals/GoalForm';
import { useDraftData, useDraftActions, useSchedule } from '../context/DraftContext';
import { MAX_SAVINGS_GOALS, nextAvailableGoalPriority } from '@shared/goalPriority';

const INITIAL_FORM_VALUES: GoalFormValues = {
  name: '',
  targetAmount: 0,
  targetDate: '',
  alreadySaved: 0,
  priority: 1,
};

export default function GoalsPage() {
  const { goals, incomes, bills, budgetFields } = useDraftData();
  const { createGoal, updateGoal, deleteGoal } = useDraftActions();
  const {
    generateSchedule,
    schedule,
    scheduleStartDate,
    scheduleMonths,
    isViewportReady,
    scheduleStartingBalance,
    scheduleInputHash,
    isLoading,
  } = useSchedule();
  const navigate = useNavigate();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingGoal, setEditingGoal] = useState<SavingsGoal | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<GoalFormValues>(INITIAL_FORM_VALUES);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const loadSchedule = async () => {
      if (isMounted) {
        await generateSchedule(scheduleStartDate, scheduleMonths, scheduleStartingBalance);
      }
    };

    if (isViewportReady && (incomes.length > 0 || bills.length > 0 || goals.length > 0)) {
      void loadSchedule();
    }

    return () => {
      isMounted = false;
    };
  }, [
    incomes,
    bills,
    generateSchedule,
    scheduleStartDate,
    scheduleMonths,
    isViewportReady,
    scheduleStartingBalance,
    scheduleInputHash,
    goals.length,
  ]);

  const resetForm = () => setFormValues(INITIAL_FORM_VALUES);

  const handleOpenCreate = () => {
    const defaultDate = new Date();
    defaultDate.setMonth(defaultDate.getMonth() + 6);
    setFormValues({
      ...INITIAL_FORM_VALUES,
      targetDate: format(defaultDate, 'yyyy-MM-dd'),
      priority: nextAvailableGoalPriority(goals),
    });
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

  const handleCreate = (event: React.FormEvent) => {
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
      if (createGoal(input)) {
        setShowCreateModal(false);
        resetForm();
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdate = (event: React.FormEvent) => {
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
      if (updateGoal(editingGoal.id, updates)) {
        setEditingGoal(null);
        resetForm();
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = (id: string) => {
    if (deleteGoal(id)) {
      setDeleteConfirm(null);
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

  const showPageSpinner =
    isViewportReady && isLoading && !schedule && goals.length > 0;

  if (showPageSpinner) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500" />
      </div>
    );
  }

  const minCashOnHand = budgetFields?.minCashOnHand ?? 100;
  const projections = schedule?.goalProjections ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Savings Goals</h2>
          <p className="text-(--color-text-secondary)">
            Goals are funded as early as savings rules allow. The per-paycheck figure is
            what you need to stay on deadline.
          </p>
        </div>

        {goals.length < MAX_SAVINGS_GOALS && (
          <button onClick={handleOpenCreate} className="btn btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" />
            Add Goal
          </button>
        )}
      </div>

      {goals.length === 0 ? (
        <div className="card text-center py-12">
          <Target className="w-12 h-12 mx-auto text-(--color-text-muted) mb-4" />
          <h3 className="text-lg font-medium mb-2">No savings goals yet</h3>
          <p className="text-(--color-text-secondary) mb-4">
            Create a goal to start tracking your savings targets
          </p>
          <button onClick={handleOpenCreate} className="btn btn-primary inline-flex items-center gap-2">
            <Plus className="w-4 h-4" />
            Create Your First Goal
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {[...goals]
            .sort((a, b) => a.priority - b.priority || a.createdAt.localeCompare(b.createdAt))
            .map((goal) => (
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
        <p className="text-(--color-text-secondary) mb-6">
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
