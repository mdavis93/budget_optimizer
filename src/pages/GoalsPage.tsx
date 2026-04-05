import { useState, useEffect, useCallback, useId } from 'react';
import { useData } from '../context/DataContext';
import { SavingsGoal, SavingsGoalInput, GoalProjection } from '../types';
import { Target, Plus, Pencil, Trash2, Check, TrendingUp, AlertTriangle, Calendar, DollarSign, Lightbulb } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import clsx from 'clsx';
import Modal from '../components/Modal';

export default function GoalsPage() {
  const { schedule, generateSchedule } = useData();
  
  const [goals, setGoals] = useState<SavingsGoal[]>([]);
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

  const loadGoals = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await window.electronAPI.goals.getAll();
      if (result.success && result.data) {
        setGoals(result.data);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    
    const doLoad = async () => {
      setIsLoading(true);
      try {
        const result = await window.electronAPI.goals.getAll();
        if (isMounted && result.success && result.data) {
          setGoals(result.data);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };
    
    doLoad();
    return () => { isMounted = false; };
  }, []);

  useEffect(() => {
    if (schedule?.goalProjections) {
      setProjections(schedule.goalProjections);
    }
  }, [schedule?.goalProjections]);

  const refreshData = useCallback(async () => {
    await loadGoals();
    const today = new Date();
    const startDate = format(today, 'yyyy-MM-dd');
    await generateSchedule(startDate, 12, 0);
  }, [loadGoals, generateSchedule]);

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
      const result = await window.electronAPI.goals.create(input);
      if (result.success) {
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
      const result = await window.electronAPI.goals.update(editingGoal.id, {
        name: formName.trim(),
        targetAmount: formAmount,
        targetDate: formDate,
        alreadySaved: formSaved,
        priority: formPriority,
      });
      if (result.success) {
        setEditingGoal(null);
        resetForm();
        await refreshData();
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const result = await window.electronAPI.goals.delete(id);
    if (result.success) {
      setDeleteConfirm(null);
      await refreshData();
    }
  };

  const getProjection = (goalId: string): GoalProjection | undefined => {
    return projections.find(p => p.goalId === goalId);
  };

  const getStatusColor = (status: GoalProjection['status']) => {
    switch (status) {
      case 'achievable':
        return 'text-success-700 dark:text-success-400';
      case 'partial':
        return 'text-warning-700 dark:text-warning-400';
      case 'impossible':
        return 'text-danger-700 dark:text-danger-400';
    }
  };

  const getStatusBgColor = (status: GoalProjection['status']) => {
    switch (status) {
      case 'achievable':
        return 'bg-success-100 dark:bg-success-900/30';
      case 'partial':
        return 'bg-warning-100 dark:bg-warning-900/30';
      case 'impossible':
        return 'bg-danger-100 dark:bg-danger-900/30';
    }
  };

  const getProgressBarColor = (percent: number) => {
    if (percent >= 100) return 'bg-success-500';
    if (percent >= 50) return 'bg-warning-500';
    return 'bg-danger-500';
  };

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
            Set targets and track achievability based on your budget
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
            
            return (
              <div key={goal.id} className="card">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className={clsx(
                      'w-10 h-10 rounded-lg flex items-center justify-center',
                      projection ? getStatusBgColor(projection.status) : 'bg-[var(--color-surface-hover)]'
                    )}>
                      <Target className={clsx(
                        'w-5 h-5',
                        projection ? getStatusColor(projection.status) : 'text-[var(--color-text-muted)]'
                      )} />
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

                {projection && (
                  <>
                    <div className="mb-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium">Achievability</span>
                        <span className={clsx('text-sm font-semibold', getStatusColor(projection.status))}>
                          {projection.achievabilityPercent}%
                        </span>
                      </div>
                      <div className="w-full bg-[var(--color-surface-hover)] rounded-full h-3">
                        <div
                          className={clsx('h-3 rounded-full transition-all', getProgressBarColor(projection.achievabilityPercent))}
                          style={{ width: `${Math.min(100, projection.achievabilityPercent)}%` }}
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-4 text-sm text-[var(--color-text-secondary)] mb-3">
                      <div className="flex items-center gap-1">
                        <Calendar className="w-4 h-4" />
                        <span>{projection.paycheckCount} paychecks</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <DollarSign className="w-4 h-4" />
                        <span>{formatCurrency(projection.requiredPerPaycheck)}/paycheck needed</span>
                      </div>
                      {projection.availablePerPaycheck > 0 && (
                        <div className="flex items-center gap-1">
                          <TrendingUp className="w-4 h-4" />
                          <span>{formatCurrency(projection.availablePerPaycheck)}/paycheck available</span>
                        </div>
                      )}
                    </div>

                    {projection.status === 'achievable' && (
                      <div className="flex items-center gap-2 text-sm text-success-700 dark:text-success-400">
                        <Check className="w-4 h-4" />
                        <span>Fully achievable with your current budget</span>
                      </div>
                    )}

                    {projection.status === 'partial' && projection.suggestions.length > 0 && (
                      <div className="mt-3 p-3 bg-warning-50 dark:bg-warning-900/20 rounded-lg">
                        <div className="flex items-center gap-2 mb-2">
                          <Lightbulb className="w-4 h-4 text-warning-700 dark:text-warning-400" />
                          <span className="text-sm font-medium text-warning-800 dark:text-warning-300">Suggestions</span>
                        </div>
                        <ul className="space-y-1">
                          {projection.suggestions.map((suggestion, idx) => (
                            <li key={idx} className="text-sm text-warning-700 dark:text-warning-400">
                              {suggestion.description}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {projection.status === 'impossible' && (
                      <div className="mt-3 p-3 bg-danger-50 dark:bg-danger-900/20 rounded-lg">
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 text-danger-700 dark:text-danger-400" />
                          <span className="text-sm text-danger-800 dark:text-danger-300">
                            No surplus available for this goal. Increase priority or adjust other goals.
                          </span>
                        </div>
                      </div>
                    )}
                  </>
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
