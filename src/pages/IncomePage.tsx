import { useState } from 'react';
import { Plus, Pencil, Trash2, Wallet, ToggleLeft, ToggleRight, Palmtree } from 'lucide-react';
import { useDraftActions, useDraftData } from '../context/DraftContext';
import { useBudget } from '../context/BudgetContext';
import { Income, IncomeInput, Leave, LeaveInput, CADENCE_LABELS } from '../types';
import { getMonthlyIncomeEquivalent } from '../utils/cadence';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
import { format, parseISO } from 'date-fns';
import clsx from 'clsx';
import { formatCurrency } from '../utils/formatCurrency';

const DEFAULT_TARGET_CASH = 250;
const DEFAULT_MIN_CASH = 100;

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
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-(--color-text-muted)">$</span>
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

      <div className="flex items-center justify-between p-3 rounded-lg bg-(--color-bg-tertiary)">
        <span className="text-sm">Set an end date (last payment)</span>
        <button
          type="button"
          onClick={() => setHasEndDate(!hasEndDate)}
          className={clsx(
            'transition-colors',
            hasEndDate ? 'text-primary-500' : 'text-(--color-text-muted)'
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

      <div className="flex items-center justify-between p-3 rounded-lg bg-(--color-bg-tertiary)">
        <span className="text-sm">Active Income Source</span>
        <button
          type="button"
          onClick={() => setIsActive(!isActive)}
          className={clsx(
            'transition-colors',
            isActive ? 'text-success-500' : 'text-(--color-text-muted)'
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

interface LeaveFormProps {
  leave?: Leave;
  incomes: Income[];
  defaultTargetCashOnHand: number;
  defaultMinCashOnHand: number;
  onSubmit: (data: LeaveInput) => void;
  onCancel: () => void;
}

function LeaveForm({
  leave,
  incomes,
  defaultTargetCashOnHand,
  defaultMinCashOnHand,
  onSubmit,
  onCancel,
}: LeaveFormProps) {
  const [name, setName] = useState(leave?.name ?? '');
  const [type, setType] = useState<Leave['type']>(leave?.type ?? 'unpaid');
  const [incomeId, setIncomeId] = useState(leave?.incomeId ?? incomes[0]?.id ?? '');
  const [startDate, setStartDate] = useState(
    leave?.startDate
      ? format(parseISO(leave.startDate), 'yyyy-MM-dd')
      : format(new Date(), 'yyyy-MM-dd')
  );
  const [endDate, setEndDate] = useState(
    leave?.endDate
      ? format(parseISO(leave.endDate), 'yyyy-MM-dd')
      : format(new Date(), 'yyyy-MM-dd')
  );
  const [targetCashOnHand, setTargetCashOnHand] = useState(
    leave?.type === 'unpaid' && leave.targetCashOnHand !== undefined
      ? String(leave.targetCashOnHand)
      : ''
  );
  const [minCashOnHand, setMinCashOnHand] = useState(
    leave?.type === 'unpaid' && leave.minCashOnHand !== undefined
      ? String(leave.minCashOnHand)
      : ''
  );

  const handleTypeChange = (nextType: Leave['type']) => {
    setType(nextType);
    if (nextType === 'paid') {
      setTargetCashOnHand('');
      setMinCashOnHand('');
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const input: LeaveInput = {
      name: name.trim(),
      type,
      incomeId,
      startDate,
      endDate,
    };
    if (type === 'unpaid') {
      if (targetCashOnHand.trim() !== '') {
        input.targetCashOnHand = parseFloat(targetCashOnHand);
      }
      if (minCashOnHand.trim() !== '') {
        input.minCashOnHand = parseFloat(minCashOnHand);
      }
    }
    onSubmit(input);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="leave-name" className="label">Leave Name</label>
        <input
          id="leave-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="input"
          placeholder="e.g., Vacation, Medical Leave"
          required
        />
      </div>

      <div>
        <label htmlFor="leave-type" className="label">Type</label>
        <select
          id="leave-type"
          value={type}
          onChange={(e) => handleTypeChange(e.target.value as Leave['type'])}
          className="input"
        >
          <option value="paid">Paid (no income change)</option>
          <option value="unpaid">Unpaid (removes matching paychecks)</option>
        </select>
        <p className="mt-1 text-xs text-(--color-text-muted)">
          Unpaid leave removes matching paychecks from the schedule. Paid leave is informational.
          You can still fine-tune amounts on Schedule.
        </p>
      </div>

      <div>
        <label htmlFor="leave-income" className="label">Income Source</label>
        <select
          id="leave-income"
          value={incomeId}
          onChange={(e) => setIncomeId(e.target.value)}
          className="input"
          required
        >
          {incomes.map((income) => (
            <option key={income.id} value={income.id}>
              {income.sourceName}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="leave-start-date" className="label">Start Date</label>
          <input
            id="leave-start-date"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="input"
            required
          />
        </div>
        <div>
          <label htmlFor="leave-end-date" className="label">End Date</label>
          <input
            id="leave-end-date"
            type="date"
            value={endDate}
            min={startDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="input"
            required
          />
        </div>
      </div>

      {type === 'unpaid' && (
        <div className="space-y-3 rounded-lg border border-(--color-border) p-3">
          <div>
            <p className="text-sm font-medium">Temporary cash-on-hand for this leave</p>
            <p className="mt-1 text-xs text-(--color-text-muted)">
              Optional. Applies during the leave window; if unpaid leave removes those paychecks,
              bordering paychecks use these temporary values. Leave blank to keep budget defaults
              ({formatCurrency(defaultTargetCashOnHand)} target · {formatCurrency(defaultMinCashOnHand)} min).
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="leave-target-cash" className="label">Target Cash On-Hand</label>
              <input
                id="leave-target-cash"
                type="number"
                min="0"
                step="0.01"
                value={targetCashOnHand}
                onChange={(e) => setTargetCashOnHand(e.target.value)}
                className="input"
                placeholder={String(defaultTargetCashOnHand)}
              />
            </div>
            <div>
              <label htmlFor="leave-min-cash" className="label">Min Cash On-Hand</label>
              <input
                id="leave-min-cash"
                type="number"
                min="0"
                step="0.01"
                value={minCashOnHand}
                onChange={(e) => setMinCashOnHand(e.target.value)}
                className="input"
                placeholder={String(defaultMinCashOnHand)}
              />
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-3 pt-2">
        <button type="button" onClick={onCancel} className="btn-secondary flex-1">
          Cancel
        </button>
        <button type="submit" className="btn-primary flex-1" disabled={!incomeId}>
          {leave ? 'Update' : 'Add'} Leave
        </button>
      </div>
    </form>
  );
}

export default function IncomePage() {
  const { incomes, leaves, budgetFields } = useDraftData();
  const { currentBudget } = useBudget();
  const {
    createIncome,
    updateIncome,
    deleteIncome,
    createLeave,
    updateLeave,
    deleteLeave,
  } = useDraftActions();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingIncome, setEditingIncome] = useState<Income | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isLeaveFormOpen, setIsLeaveFormOpen] = useState(false);
  const [editingLeave, setEditingLeave] = useState<Leave | null>(null);
  const [deletingLeaveId, setDeletingLeaveId] = useState<string | null>(null);

  const defaultTargetCashOnHand =
    budgetFields?.targetCashOnHand ?? currentBudget?.targetCashOnHand ?? DEFAULT_TARGET_CASH;
  const defaultMinCashOnHand =
    budgetFields?.minCashOnHand ?? currentBudget?.minCashOnHand ?? DEFAULT_MIN_CASH;

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

  const handleCreateLeave = (data: LeaveInput) => {
    if (createLeave(data)) {
      setIsLeaveFormOpen(false);
    }
  };

  const handleUpdateLeave = (data: LeaveInput) => {
    if (!editingLeave) return;
    if (updateLeave(editingLeave.id, data)) {
      setEditingLeave(null);
    }
  };

  const handleDeleteLeave = () => {
    if (!deletingLeaveId) return;
    deleteLeave(deletingLeaveId);
    setDeletingLeaveId(null);
  };

  const incomeNameById = new Map(incomes.map((income) => [income.id, income.sourceName]));

  const totalMonthlyIncome = incomes
    .filter(i => i.isActive)
    .reduce((sum, i) => sum + getMonthlyIncomeEquivalent(i), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Income Sources</h2>
          <p className="text-(--color-text-secondary)">
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
                    : 'bg-(--color-bg-tertiary)'
                )}>
                  <Wallet className={clsx(
                    'w-6 h-6',
                    income.isActive
                      ? 'text-success-600 dark:text-success-500'
                      : 'text-(--color-text-muted)'
                  )} />
                </div>
                <div>
                  <h3 className="font-medium">{income.sourceName}</h3>
                  <p className="text-sm text-(--color-text-secondary)">
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
                  <p className="text-xs text-(--color-text-muted)">
                    ~{formatCurrency(getMonthlyIncomeEquivalent(income))}/mo
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setEditingIncome(income)}
                    aria-label={`Edit ${income.sourceName}`}
                    className="p-2 rounded-lg hover:bg-(--color-bg-tertiary) text-(--color-text-secondary)"
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

      <div className="pt-4 border-t border-(--color-border)">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-xl font-semibold">Leave</h3>
            <p className="text-sm text-(--color-text-secondary)">
              Paid leave is informational. Unpaid leave removes matching paychecks from the schedule.
            </p>
          </div>
          <button
            onClick={() => setIsLeaveFormOpen(true)}
            className="btn-secondary"
            disabled={incomes.length === 0}
          >
            <Plus className="w-5 h-5 mr-2" />
            Add Leave
          </button>
        </div>

        {incomes.length === 0 ? (
          <p className="text-sm text-(--color-text-muted)">Add an income source before recording leave.</p>
        ) : leaves.length === 0 ? (
          <p className="text-sm text-(--color-text-muted)">
            No leave periods yet. Use Add Leave to track vacation or unpaid time off.
          </p>
        ) : (
          <div className="grid gap-3">
            {leaves.map((leave) => (
              <div key={leave.id} className="card flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-lg bg-(--color-bg-tertiary)">
                    <Palmtree className="w-5 h-5 text-(--color-text-secondary)" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="font-medium">{leave.name}</h4>
                      <span className="text-xs text-(--color-text-muted)">
                        {leave.type === 'unpaid' ? 'Unpaid' : 'Paid'}
                      </span>
                    </div>
                    <p className="text-sm text-(--color-text-secondary)">
                      {incomeNameById.get(leave.incomeId) ?? 'Unknown income'} •{' '}
                      {format(parseISO(leave.startDate), 'MMM d, yyyy')} –{' '}
                      {format(parseISO(leave.endDate), 'MMM d, yyyy')}
                    </p>
                    {leave.type === 'unpaid' &&
                      (leave.targetCashOnHand !== undefined || leave.minCashOnHand !== undefined) && (
                        <p className="text-xs text-(--color-text-muted)">
                          {leave.targetCashOnHand !== undefined
                            ? `Target ${formatCurrency(leave.targetCashOnHand)}`
                            : null}
                          {leave.targetCashOnHand !== undefined && leave.minCashOnHand !== undefined
                            ? ' · '
                            : null}
                          {leave.minCashOnHand !== undefined
                            ? `Min ${formatCurrency(leave.minCashOnHand)}`
                            : null}
                        </p>
                      )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setEditingLeave(leave)}
                    aria-label={`Edit ${leave.name}`}
                    className="p-2 rounded-lg hover:bg-(--color-bg-tertiary) text-(--color-text-secondary)"
                  >
                    <Pencil className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => setDeletingLeaveId(leave.id)}
                    aria-label={`Delete ${leave.name}`}
                    className="p-2 rounded-lg hover:bg-danger-50 dark:hover:bg-danger-500/10 text-danger-500"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

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

      <Modal
        isOpen={isLeaveFormOpen}
        onClose={() => setIsLeaveFormOpen(false)}
        title="Add Leave"
      >
        <LeaveForm
          incomes={incomes}
          defaultTargetCashOnHand={defaultTargetCashOnHand}
          defaultMinCashOnHand={defaultMinCashOnHand}
          onSubmit={handleCreateLeave}
          onCancel={() => setIsLeaveFormOpen(false)}
        />
      </Modal>

      <Modal
        isOpen={!!editingLeave}
        onClose={() => setEditingLeave(null)}
        title="Edit Leave"
      >
        {editingLeave && (
          <LeaveForm
            leave={editingLeave}
            incomes={incomes}
            defaultTargetCashOnHand={defaultTargetCashOnHand}
            defaultMinCashOnHand={defaultMinCashOnHand}
            onSubmit={handleUpdateLeave}
            onCancel={() => setEditingLeave(null)}
          />
        )}
      </Modal>

      <ConfirmDialog
        isOpen={!!deletingId}
        onClose={() => setDeletingId(null)}
        onConfirm={handleDelete}
        title="Delete Income Source"
        message="Are you sure you want to delete this income source? Related leave periods will also be removed."
        confirmText="Delete"
        variant="danger"
      />

      <ConfirmDialog
        isOpen={!!deletingLeaveId}
        onClose={() => setDeletingLeaveId(null)}
        onConfirm={handleDeleteLeave}
        title="Delete Leave"
        message="Are you sure you want to delete this leave period?"
        confirmText="Delete"
        variant="danger"
      />
    </div>
  );
}
