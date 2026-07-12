export interface BudgetFormValues {
  name: string;
  startingBalance: number;
  targetCashOnHand: number;
  minCashOnHand: number;
}

interface CreateBudgetFormProps {
  values: BudgetFormValues;
  onChange: (values: BudgetFormValues) => void;
  onSubmit: (event: React.FormEvent) => void;
  onCancel: () => void;
  isCreating: boolean;
}

export default function CreateBudgetForm({
  values,
  onChange,
  onSubmit,
  onCancel,
  isCreating,
}: CreateBudgetFormProps) {
  return (
    <div className="card">
      <h3 className="font-semibold mb-4">Create New Budget</h3>
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label htmlFor="budgets-new-name" className="block text-sm font-medium text-(--color-text-secondary) mb-1">
            Budget Name
          </label>
          <input
            id="budgets-new-name"
            type="text"
            value={values.name}
            onChange={(event) => onChange({ ...values, name: event.target.value })}
            placeholder="e.g., Personal, Client: Smith, Side Business"
            className="input w-full"
            autoFocus
          />
        </div>
        <div>
          <label htmlFor="budgets-new-balance" className="block text-sm font-medium text-(--color-text-secondary) mb-1">
            Starting Balance
          </label>
          <input
            id="budgets-new-balance"
            type="number"
            value={values.startingBalance}
            onChange={(event) => onChange({ ...values, startingBalance: parseFloat(event.target.value) || 0 })}
            placeholder="0"
            className="input w-full"
            min="0"
            step="0.01"
          />
          <p className="text-xs text-(--color-text-muted) mt-1">
            Initial account balance for schedule projections
          </p>
        </div>
        <div>
          <label htmlFor="budgets-new-target" className="block text-sm font-medium text-(--color-text-secondary) mb-1">
            Target Cash on Hand
          </label>
          <input
            id="budgets-new-target"
            type="number"
            value={values.targetCashOnHand}
            onChange={(event) => onChange({ ...values, targetCashOnHand: parseFloat(event.target.value) || 0 })}
            placeholder="250"
            className="input w-full"
            min="0"
            step="1"
          />
          <p className="text-xs text-(--color-text-muted) mt-1">
            Budget remaining target per paycheck (excess goes to savings)
          </p>
        </div>
        <div>
          <label htmlFor="budgets-new-min" className="block text-sm font-medium text-(--color-text-secondary) mb-1">
            Minimum Cash on Hand
          </label>
          <input
            id="budgets-new-min"
            type="number"
            value={values.minCashOnHand}
            onChange={(event) => onChange({ ...values, minCashOnHand: parseFloat(event.target.value) || 0 })}
            placeholder="100"
            className="input w-full"
            min="0"
            step="1"
          />
          <p className="text-xs text-(--color-text-muted) mt-1">
            Protected floor for pocket cash (goals cannot consume below this)
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className="btn btn-secondary">
            Cancel
          </button>
          <button type="submit" disabled={!values.name.trim() || isCreating} className="btn btn-primary">
            {isCreating ? 'Creating...' : 'Create Budget'}
          </button>
        </div>
      </form>
    </div>
  );
}
