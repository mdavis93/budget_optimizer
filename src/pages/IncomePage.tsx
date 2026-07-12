import { useState } from 'react';
import { Plus, Pencil, Trash2, Wallet, ToggleLeft, ToggleRight } from 'lucide-react';
import { useDraftActions, useDraftData } from '../context/DraftContext';
import { Income, IncomeInput, CADENCE_LABELS } from '../types';
import { getMonthlyIncomeEquivalent } from '../utils/cadence';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
import { format, parseISO } from 'date-fns';
import clsx from 'clsx';
import { formatCurrency } from '../utils/formatCurrency';

interface IncomeFormProps {
  income?: Income;
  onSubmit: (data: IncomeInput) => void;
  onCancel: () => void;
}

function IncomeForm({ income, onSubmit, onCancel }: IncomeFormProps) {
  const [sourceName, setSourceName] = useState(income?.sourceName ?? '');
  const [amount, setAmount] = useState(income?.amount?.toString() ?? '');
  const [cadence, setCadence] = useState<Income['cadence']>(income?.cadence ?? 'biweekly');
  const [startDate, setStartDate] = useState(
    income?.startDate 
      ? format(parseISO(income.startDate), 'yyyy-MM-dd')
      : format(new Date(), 'yyyy-MM-dd')
  );
  const [hasEndDate, setHasEndDate] = useState(!!income?.endDate);
  const [endDate, setEndDate] = useState(
    income?.endDate ? format(parseISO(income.endDate), 'yyyy-MM-dd') : ''
  );
  const [isActive, setIsActive] = useState(income?.isActive ?? true);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      sourceName,
      amount: parseFloat(amount),
      cadence,
      startDate,
      ...(hasEndDate && endDate ? { endDate } : {}),
      isActive,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="income-source-name" className="label">Income Source Name</label>
        <input
          id="income-source-name"
          type="text"
          value={sourceName}
          onChange={(e) => setSourceName(e.target.value)}
          className="input"
          placeholder="e.g., Primary Job, Side Hustle"
          required
        />
      </div>

      <div>
        <label htmlFor="income-amount" className="label">Amount</label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]">$</span>
          <input
            id="income-amount"
            type="number"
            step="0.01"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="input pl-7"
            placeholder="0.00"
            required
          />
        </div>
      </div>

      <div>
        <label htmlFor="income-cadence" className="label">Payment Frequency</label>
        <select
          id="income-cadence"
          value={cadence}
          onChange={(e) => setCadence(e.target.value as Income['cadence'])}
          className="input"
        >
          <option value="weekly">Weekly</option>
          <option value="biweekly">Bi-weekly (every 2 weeks)</option>
          <option value="semimonthly">Semi-monthly (1st and 15th)</option>
          <option value="monthly">Monthly</option>
        </select>
      </div>

      <div>
        <label htmlFor="income-start-date" className="label">Start Date (First Payment)</label>
        <input
          id="income-start-date"
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="input"
          required
        />
      </div>

      <div className="flex items-center justify-between p-3 rounded-lg bg-[var(--color-bg-tertiary)]">
        <span className="text-sm">Set an end date (last payment)</span>
        <button
          type="button"
          onClick={() => setHasEndDate(!hasEndDate)}
          className={clsx(
            'transition-colors',
            hasEndDate ? 'text-primary-500' : 'text-[var(--color-text-muted)]'
          )}
          aria-pressed={hasEndDate}
        >
          {hasEndDate ? <ToggleRight className="w-8 h-8" /> : <ToggleLeft className="w-8 h-8" />}
        </button>
      </div>

      {hasEndDate && (
        <div>
          <label htmlFor="income-end-date" className="label">Ends On (Last Payment)</label>
          <input
            id="income-end-date"
            type="date"
            value={endDate}
            min={startDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="input"
            required={hasEndDate}
          />
        </div>
      )}

      <div className="flex items-center justify-between p-3 rounded-lg bg-[var(--color-bg-tertiary)]">
        <span className="text-sm">Active Income Source</span>
        <button
          type="button"
          onClick={() => setIsActive(!isActive)}
          className={clsx(
            'transition-colors',
            isActive ? 'text-success-500' : 'text-[var(--color-text-muted)]'
          )}
        >
          {isActive ? <ToggleRight className="w-8 h-8" /> : <ToggleLeft className="w-8 h-8" />}
        </button>
      </div>

      <div className="flex gap-3 pt-2">
        <button type="button" onClick={onCancel} className="btn-secondary flex-1">
          Cancel
        </button>
        <button type="submit" className="btn-primary flex-1">
          {income ? 'Update' : 'Add'} Income
        </button>
      </div>
    </form>
  );
}

export default function IncomePage() {
  const { incomes } = useDraftData();
  const { createIncome, updateIncome, deleteIncome } = useDraftActions();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingIncome, setEditingIncome] = useState<Income | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleCreate = async (data: IncomeInput) => {
    const success = await createIncome(data);
    if (success) {
      setIsFormOpen(false);
    }
  };

  const handleUpdate = async (data: IncomeInput) => {
    if (!editingIncome) return;
    const success = await updateIncome(editingIncome.id, data);
    if (success) {
      setEditingIncome(null);
    }
  };

  const handleDelete = async () => {
    if (!deletingId) return;
    await deleteIncome(deletingId);
    setDeletingId(null);
  };

  const totalMonthlyIncome = incomes
    .filter(i => i.isActive)
    .reduce((sum, i) => sum + getMonthlyIncomeEquivalent(i), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Income Sources</h2>
          <p className="text-[var(--color-text-secondary)]">
            Manage your income sources and payment schedules
          </p>
        </div>
        <button onClick={() => setIsFormOpen(true)} className="btn-primary">
          <Plus className="w-5 h-5 mr-2" />
          Add Income
        </button>
      </div>

      {incomes.length > 0 && (
        <div className="card bg-success-50 dark:bg-success-500/10 border-success-200 dark:border-success-800">
          <div className="flex items-center justify-between">
            <span className="text-success-700 dark:text-success-400">Total Monthly Income (estimated)</span>
            <span className="text-2xl font-semibold text-success-600 dark:text-success-500">
              {formatCurrency(totalMonthlyIncome)}
            </span>
          </div>
        </div>
      )}

      {incomes.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="No income sources"
          description="Add your income sources to start tracking your budget and generating payment schedules."
          action={{
            label: 'Add Income',
            onClick: () => setIsFormOpen(true),
          }}
        />
      ) : (
        <div className="grid gap-4">
          {incomes.map((income) => (
            <div
              key={income.id}
              className={clsx(
                'card flex items-center justify-between',
                !income.isActive && 'opacity-60'
              )}
            >
              <div className="flex items-center gap-4">
                <div className={clsx(
                  'p-3 rounded-lg',
                  income.isActive 
                    ? 'bg-success-100 dark:bg-success-500/20' 
                    : 'bg-[var(--color-bg-tertiary)]'
                )}>
                  <Wallet className={clsx(
                    'w-6 h-6',
                    income.isActive 
                      ? 'text-success-600 dark:text-success-500' 
                      : 'text-[var(--color-text-muted)]'
                  )} />
                </div>
                <div>
                  <h3 className="font-medium">{income.sourceName}</h3>
                  <p className="text-sm text-[var(--color-text-secondary)]">
                    {CADENCE_LABELS[income.cadence]} • Starting {format(parseISO(income.startDate), 'MMM d, yyyy')}
                    {income.endDate && (
                      <> • Ending {format(parseISO(income.endDate), 'MMM d, yyyy')}</>
                    )}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-6">
                <div className="text-right">
                  <p className="text-lg font-semibold">{formatCurrency(income.amount)}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    ~{formatCurrency(getMonthlyIncomeEquivalent(income))}/mo
                  </p>
                </div>
                
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setEditingIncome(income)}
                    aria-label={`Edit ${income.sourceName}`}
                    className="p-2 rounded-lg hover:bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)]"
                  >
                    <Pencil className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => setDeletingId(income.id)}
                    aria-label={`Delete ${income.sourceName}`}
                    className="p-2 rounded-lg hover:bg-danger-50 dark:hover:bg-danger-500/10 text-danger-500"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        title="Add Income Source"
      >
        <IncomeForm
          onSubmit={handleCreate}
          onCancel={() => setIsFormOpen(false)}
        />
      </Modal>

      <Modal
        isOpen={!!editingIncome}
        onClose={() => setEditingIncome(null)}
        title="Edit Income Source"
      >
        {editingIncome && (
          <IncomeForm
            income={editingIncome}
            onSubmit={handleUpdate}
            onCancel={() => setEditingIncome(null)}
          />
        )}
      </Modal>

      <ConfirmDialog
        isOpen={!!deletingId}
        onClose={() => setDeletingId(null)}
        onConfirm={handleDelete}
        title="Delete Income Source"
        message="Are you sure you want to delete this income source? This action cannot be undone."
        confirmText="Delete"
        variant="danger"
      />
    </div>
  );
}
