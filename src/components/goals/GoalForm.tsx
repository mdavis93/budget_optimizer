import { useId } from 'react';

export interface GoalFormValues {
  name: string;
  targetAmount: number;
  targetDate: string;
  alreadySaved: number;
  priority: number;
}

interface GoalFormProps {
  values: GoalFormValues;
  onChange: (values: GoalFormValues) => void;
  onSubmit: (event: React.FormEvent) => void;
  onCancel: () => void;
  isSaving: boolean;
  mode: 'create' | 'edit';
  idPrefix: string;
}

export default function GoalForm({
  values,
  onChange,
  onSubmit,
  onCancel,
  isSaving,
  mode,
  idPrefix,
}: GoalFormProps) {
  const nameInputId = useId();
  const amountInputId = useId();
  const dateInputId = useId();
  const savedInputId = useId();
  const priorityInputId = useId();
  const isCreate = mode === 'create';

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label htmlFor={`${idPrefix}-${nameInputId}`} className="block text-sm font-medium mb-1">Goal Name</label>
        <input
          id={`${idPrefix}-${nameInputId}`}
          type="text"
          value={values.name}
          onChange={(event) => onChange({ ...values, name: event.target.value })}
          className="input w-full"
          placeholder={isCreate ? 'e.g., Hawaii Trip' : undefined}
          required
        />
      </div>

      <div>
        <label htmlFor={`${idPrefix}-${amountInputId}`} className="block text-sm font-medium mb-1">Target Amount</label>
        <input
          id={`${idPrefix}-${amountInputId}`}
          type="number"
          value={values.targetAmount || ''}
          onChange={(event) => onChange({ ...values, targetAmount: parseFloat(event.target.value) || 0 })}
          className="input w-full"
          placeholder={isCreate ? '0.00' : undefined}
          min="0"
          step="0.01"
          required
        />
      </div>

      <div>
        <label htmlFor={`${idPrefix}-${dateInputId}`} className="block text-sm font-medium mb-1">Target Date</label>
        <input
          id={`${idPrefix}-${dateInputId}`}
          type="date"
          value={values.targetDate}
          onChange={(event) => onChange({ ...values, targetDate: event.target.value })}
          className="input w-full"
          required
        />
      </div>

      <div>
        <label htmlFor={`${idPrefix}-${savedInputId}`} className="block text-sm font-medium mb-1">
          Already Saved{isCreate && ' (Optional)'}
        </label>
        <input
          id={`${idPrefix}-${savedInputId}`}
          type="number"
          value={values.alreadySaved || ''}
          onChange={(event) => onChange({ ...values, alreadySaved: parseFloat(event.target.value) || 0 })}
          className="input w-full"
          placeholder={isCreate ? '0.00' : undefined}
          min="0"
          step="0.01"
        />
        {isCreate && (
          <p className="text-xs text-(--color-text-muted) mt-1">
            Amount you've already set aside for this goal
          </p>
        )}
      </div>

      <div>
        <label htmlFor={`${idPrefix}-${priorityInputId}`} className="block text-sm font-medium mb-1">Priority</label>
        <select
          id={`${idPrefix}-${priorityInputId}`}
          value={values.priority}
          onChange={(event) => onChange({ ...values, priority: parseInt(event.target.value) })}
          className="input w-full"
        >
          <option value={1}>1 - Highest</option>
          <option value={2}>2 - High</option>
          <option value={3}>3 - Medium</option>
          <option value={4}>4 - Low</option>
          <option value={5}>5 - Lowest</option>
        </select>
        {isCreate && (
          <p className="text-xs text-(--color-text-muted) mt-1">
            Higher priority goals are funded first
          </p>
        )}
      </div>

      <div className="flex gap-3 pt-4">
        <button type="button" onClick={onCancel} className="btn btn-secondary flex-1">
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSaving || !values.name.trim() || values.targetAmount <= 0 || !values.targetDate}
          className="btn btn-primary flex-1"
        >
          {isSaving ? (isCreate ? 'Creating...' : 'Saving...') : (isCreate ? 'Create Goal' : 'Save Changes')}
        </button>
      </div>
    </form>
  );
}
