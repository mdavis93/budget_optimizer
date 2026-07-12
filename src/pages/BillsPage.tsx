import { useState, useMemo } from 'react';
import { Plus, Pencil, Trash2, Receipt, AlertTriangle } from 'lucide-react';
import { useDraftActions, useDraftData } from '../context/DraftContext';
import { Bill, BillInput, Income, PRIORITY_LABELS, CATEGORY_OPTIONS } from '../types';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
import clsx from 'clsx';
import { getMonthlyBillEquivalent } from '../utils/cadence';
import { formatCurrency } from '../utils/formatCurrency';

interface BillFormProps {
  bill?: Bill;
  incomes: Income[];
  onSubmit: (data: BillInput) => void;
  onCancel: () => void;
}

function BillForm({ bill, incomes, onSubmit, onCancel }: BillFormProps) {
  const [creditorName, setCreditorName] = useState(bill?.creditorName ?? '');
  const [budgetedAmount, setBudgetedAmount] = useState(bill?.budgetedAmount?.toString() ?? '');
  const [dueDay, setDueDay] = useState(bill?.dueDay?.toString() ?? '1');
  const [category, setCategory] = useState(bill?.category ?? '');
  const [isRecurring, setIsRecurring] = useState(bill?.isRecurring ?? true);
  const [priority, setPriority] = useState<Bill['priority']>(bill?.priority ?? 'normal');
  const [preferredIncomeSourceId, setPreferredIncomeSourceId] = useState(bill?.preferredIncomeSourceId ?? '');
  const [isIncomeAttached, setIsIncomeAttached] = useState(bill?.isIncomeAttached ?? false);

  const activeIncomes = incomes.filter(inc => inc.isActive);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      creditorName,
      budgetedAmount: parseFloat(budgetedAmount),
      dueDay: isIncomeAttached ? 1 : parseInt(dueDay),
      category: category || undefined,
      isRecurring,
      priority,
      preferredIncomeSourceId: preferredIncomeSourceId || undefined,
      isIncomeAttached,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="bill-creditor-name" className="label">Creditor / Vendor Name</label>
        <input
          id="bill-creditor-name"
          type="text"
          value={creditorName}
          onChange={(e) => setCreditorName(e.target.value)}
          className="input"
          placeholder="e.g., Electric Company, Netflix"
          required
        />
      </div>

      <div>
        <label htmlFor="bill-budgeted-amount" className="label">Budgeted Amount</label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-(--color-text-muted)">$</span>
          <input
            id="bill-budgeted-amount"
            type="number"
            step="0.01"
            min="0"
            value={budgetedAmount}
            onChange={(e) => setBudgetedAmount(e.target.value)}
            className="input pl-7"
            placeholder="0.00"
            required
          />
        </div>
      </div>

      <div>
        <label className="label">Expense Type</label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setIsIncomeAttached(false)}
            className={clsx(
              'px-3 py-2 rounded-lg text-sm font-medium transition-colors border',
              !isIncomeAttached
                ? 'bg-primary-500 text-white border-primary-500'
                : 'border-(--color-border) hover:bg-(--color-bg-tertiary)'
            )}
          >
            Due Date Based
          </button>
          <button
            type="button"
            onClick={() => setIsIncomeAttached(true)}
            className={clsx(
              'px-3 py-2 rounded-lg text-sm font-medium transition-colors border',
              isIncomeAttached
                ? 'bg-primary-500 text-white border-primary-500'
                : 'border-(--color-border) hover:bg-(--color-bg-tertiary)'
            )}
          >
            Per Paycheck
          </button>
        </div>
        <p className="text-xs text-(--color-text-muted) mt-1">
          {isIncomeAttached 
            ? 'This expense occurs every time the selected income is received'
            : 'This bill is due on a specific day each month'}
        </p>
      </div>

      {isIncomeAttached ? (
        <div>
          <label htmlFor="bill-attached-income" className="label">Attach to Income Source</label>
          <select
            id="bill-attached-income"
            value={preferredIncomeSourceId}
            onChange={(e) => setPreferredIncomeSourceId(e.target.value)}
            className="input"
            required
          >
            <option value="">Select an income source</option>
            {activeIncomes.map((income) => (
              <option key={income.id} value={income.id}>{income.sourceName}</option>
            ))}
          </select>
          <p className="text-xs text-(--color-text-muted) mt-1">
            This expense will automatically appear on every paycheck from this source
          </p>
        </div>
      ) : (
        <>
          <div>
            <label htmlFor="bill-due-day" className="label">Due Day of Month</label>
            <select
              id="bill-due-day"
              value={dueDay}
              onChange={(e) => setDueDay(e.target.value)}
              className="input"
            >
              {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                <option key={day} value={day}>
                  {day}{day === 1 ? 'st' : day === 2 ? 'nd' : day === 3 ? 'rd' : 'th'}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="bill-preferred-income" className="label">Preferred Income Source (Optional)</label>
            <select
              id="bill-preferred-income"
              value={preferredIncomeSourceId}
              onChange={(e) => setPreferredIncomeSourceId(e.target.value)}
              className="input"
            >
              <option value="">Any paycheck (based on due date)</option>
              {activeIncomes.map((income) => (
                <option key={income.id} value={income.id}>{income.sourceName}</option>
              ))}
            </select>
            <p className="text-xs text-(--color-text-muted) mt-1">
              Optionally assign this bill to paychecks from a specific income source
            </p>
          </div>
        </>
      )}

      <div>
        <label htmlFor="bill-category" className="label">Category (Optional)</label>
        <select
          id="bill-category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="input"
        >
          <option value="">Select a category</option>
          {CATEGORY_OPTIONS.map((cat) => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="label">Priority</label>
        <div className="grid grid-cols-4 gap-2">
          {(['critical', 'high', 'normal', 'low'] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPriority(p)}
              className={clsx(
                'px-3 py-2 rounded-lg text-sm font-medium transition-colors border',
                priority === p
                  ? p === 'critical'
                    ? 'bg-danger-500 text-white border-danger-500'
                    : p === 'high'
                    ? 'bg-warning-500 text-white border-warning-500'
                    : p === 'normal'
                    ? 'bg-primary-500 text-white border-primary-500'
                    : 'bg-(--color-text-muted) text-white border-(--color-text-muted)'
                  : 'border-(--color-border) hover:bg-(--color-bg-tertiary)'
              )}
            >
              {PRIORITY_LABELS[p]}
            </button>
          ))}
        </div>
        <p className="text-xs text-(--color-text-muted) mt-1">
          Critical bills (rent, utilities) are prioritized in scheduling
        </p>
      </div>

      <div className="flex items-center gap-3 p-3 rounded-lg bg-(--color-bg-tertiary)">
        <input
          type="checkbox"
          id="isRecurring"
          checked={isRecurring}
          onChange={(e) => setIsRecurring(e.target.checked)}
          className="w-4 h-4 rounded-sm border-(--color-border)"
        />
        <label htmlFor="isRecurring" className="text-sm">
          Recurring monthly bill
        </label>
      </div>

      <div className="flex gap-3 pt-2">
        <button type="button" onClick={onCancel} className="btn-secondary flex-1">
          Cancel
        </button>
        <button type="submit" className="btn-primary flex-1">
          {bill ? 'Update' : 'Add'} Bill
        </button>
      </div>
    </form>
  );
}

type BillSortMode = 'amount' | 'dueDate' | 'default';

export default function BillsPage() {
  const { bills, incomes } = useDraftData();
  const { createBill, updateBill, deleteBill } = useDraftActions();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingBill, setEditingBill] = useState<Bill | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [billSort, setBillSort] = useState<BillSortMode>('default');

  const handleCreate = async (data: BillInput) => {
    const success = await createBill(data);
    if (success) {
      setIsFormOpen(false);
    }
  };

  const handleUpdate = async (data: BillInput) => {
    if (!editingBill) return;
    const success = await updateBill(editingBill.id, data);
    if (success) {
      setEditingBill(null);
    }
  };

  const handleDelete = async () => {
    if (!deletingId) return;
    await deleteBill(deletingId);
    setDeletingId(null);
  };

  const filteredBills = useMemo(() =>
    filterCategory === 'all' 
      ? bills 
      : bills.filter(b => b.category === filterCategory),
    [bills, filterCategory]
  );

  const hasIncomeAttachedBills = useMemo(
    () => bills.some((b) => b.isIncomeAttached),
    [bills]
  );

  const totalMonthlyBills = useMemo(
    () => bills.reduce((sum, b) => sum + getMonthlyBillEquivalent(b, incomes), 0),
    [bills, incomes]
  );
  
  const criticalBills = useMemo(() => 
    bills.filter(b => b.priority === 'critical'),
    [bills]
  );

  const categories = useMemo(() => 
    [...new Set(bills.map(b => b.category).filter(Boolean))],
    [bills]
  );

  const sortedBills = useMemo(() => {
    const priorityOrder = { critical: 0, high: 1, normal: 2, low: 3 };
    const nameCmp = (a: Bill, b: Bill) => a.creditorName.localeCompare(b.creditorName, undefined, { sensitivity: 'base' });

    return [...filteredBills].sort((a, b) => {
      if (billSort === 'amount') {
        if (b.budgetedAmount !== a.budgetedAmount) return b.budgetedAmount - a.budgetedAmount;
        return nameCmp(a, b);
      }
      if (billSort === 'dueDate') {
        const aPay = !!a.isIncomeAttached;
        const bPay = !!b.isIncomeAttached;
        if (aPay !== bPay) return aPay ? -1 : 1;
        if (aPay && bPay) return nameCmp(a, b);
        if (a.dueDay !== b.dueDay) return a.dueDay - b.dueDay;
        return nameCmp(a, b);
      }
      // default — priority, then due day, then name
      const pa = priorityOrder[a.priority];
      const pb = priorityOrder[b.priority];
      if (pa !== pb) return pa - pb;
      if (a.dueDay !== b.dueDay) return a.dueDay - b.dueDay;
      return nameCmp(a, b);
    });
  }, [filteredBills, billSort]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Bills & Expenses</h2>
          <p className="text-(--color-text-secondary)">
            Manage your recurring bills and expenses
          </p>
        </div>
        <button onClick={() => setIsFormOpen(true)} className="btn-primary">
          <Plus className="w-5 h-5 mr-2" />
          Add Bill
        </button>
      </div>

      {bills.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="card bg-danger-50 dark:bg-danger-500/10 border-danger-200 dark:border-danger-800">
            <div className="flex items-center justify-between">
              <span className="text-danger-700 dark:text-danger-400">
                Total Monthly Bills{hasIncomeAttachedBills ? ' (estimated)' : ''}
              </span>
              <span className="text-2xl font-semibold text-danger-600 dark:text-danger-500">
                {formatCurrency(totalMonthlyBills)}
              </span>
            </div>
          </div>
          
          {criticalBills.length > 0 && (
            <div className="card bg-warning-100 dark:bg-warning-900 border-warning-300 dark:border-warning-700">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-warning-700 dark:text-warning-200" />
                  <span className="text-warning-900 dark:text-warning-100">Critical Bills</span>
                </div>
                <span className="text-2xl font-semibold text-warning-800 dark:text-warning-100">
                  {criticalBills.length}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {categories.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-(--color-text-secondary)">Filter:</span>
          <button
            onClick={() => setFilterCategory('all')}
            className={clsx(
              'px-3 py-1 rounded-full text-sm transition-colors',
              filterCategory === 'all'
                ? 'bg-primary-500 text-white'
                : 'bg-(--color-bg-tertiary) hover:bg-(--color-border)'
            )}
          >
            All
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setFilterCategory(cat!)}
              className={clsx(
                'px-3 py-1 rounded-full text-sm transition-colors',
                filterCategory === cat
                  ? 'bg-primary-500 text-white'
                  : 'bg-(--color-bg-tertiary) hover:bg-(--color-border)'
              )}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {bills.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-(--color-text-secondary)">Sort:</span>
          {(['amount', 'dueDate', 'default'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setBillSort(mode)}
              className={clsx(
                'px-3 py-1 rounded-full text-sm transition-colors',
                billSort === mode
                  ? 'bg-primary-500 text-white'
                  : 'bg-(--color-bg-tertiary) hover:bg-(--color-border)'
              )}
            >
              {mode === 'amount' ? 'Amount' : mode === 'dueDate' ? 'Due date' : 'Default'}
            </button>
          ))}
        </div>
      )}

      {bills.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="No bills added"
          description="Add your bills and recurring expenses to generate an optimized payment schedule."
          action={{
            label: 'Add Bill',
            onClick: () => setIsFormOpen(true),
          }}
        />
      ) : (
        <div className="grid gap-4">
          {sortedBills.map((bill) => (
            <div key={bill.id} className="card flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className={clsx(
                  'p-3 rounded-lg',
                  bill.priority === 'critical' && 'bg-danger-100 dark:bg-danger-500/20',
                  bill.priority === 'high' && 'bg-warning-100 dark:bg-warning-500/20',
                  bill.priority === 'normal' && 'bg-primary-100 dark:bg-primary-500/20',
                  bill.priority === 'low' && 'bg-(--color-bg-tertiary)'
                )}>
                  <Receipt className={clsx(
                    'w-6 h-6',
                    bill.priority === 'critical' && 'text-danger-600 dark:text-danger-500',
                    bill.priority === 'high' && 'text-warning-600 dark:text-warning-500',
                    bill.priority === 'normal' && 'text-primary-600 dark:text-primary-500',
                    bill.priority === 'low' && 'text-(--color-text-muted)'
                  )} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium">{bill.creditorName}</h3>
                    <span className={clsx(
                      'text-xs font-medium px-2 py-0.5 rounded-full',
                      bill.priority === 'critical' && 'bg-danger-100 text-danger-700 dark:bg-danger-900 dark:text-danger-200',
                      bill.priority === 'high' && 'bg-warning-100 text-warning-800 dark:bg-warning-900 dark:text-warning-200',
                      bill.priority === 'normal' && 'bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-200',
                      bill.priority === 'low' && 'bg-(--color-bg-tertiary) text-(--color-text-secondary)'
                    )}>
                      {PRIORITY_LABELS[bill.priority]}
                    </span>
                  </div>
                  <p className="text-sm text-(--color-text-secondary)">
                    {bill.isIncomeAttached ? (
                      <span className="text-primary-500 font-medium">
                        Per Paycheck: {incomes.find(i => i.id === bill.preferredIncomeSourceId)?.sourceName || 'Unknown'}
                      </span>
                    ) : (
                      <>
                        Due: {bill.dueDay}{bill.dueDay === 1 ? 'st' : bill.dueDay === 2 ? 'nd' : bill.dueDay === 3 ? 'rd' : 'th'} of each month
                        {bill.preferredIncomeSourceId && (
                          <span className="text-primary-500">
                            {' • '}Paid with: {incomes.find(i => i.id === bill.preferredIncomeSourceId)?.sourceName || 'Unknown'}
                          </span>
                        )}
                      </>
                    )}
                    {bill.category && ` • ${bill.category}`}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-6">
                <div className="text-right">
                  <p className="text-lg font-semibold">{formatCurrency(bill.budgetedAmount)}</p>
                  <p className="text-xs text-(--color-text-muted)">
                    {bill.isIncomeAttached ? 'Per Paycheck' : bill.isRecurring ? 'Monthly' : 'One-time'}
                  </p>
                </div>
                
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setEditingBill(bill)}
                    aria-label={`Edit ${bill.creditorName}`}
                    className="p-2 rounded-lg hover:bg-(--color-bg-tertiary) text-(--color-text-secondary)"
                  >
                    <Pencil className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => setDeletingId(bill.id)}
                    aria-label={`Delete ${bill.creditorName}`}
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
        title="Add Bill"
      >
        <BillForm
          incomes={incomes}
          onSubmit={handleCreate}
          onCancel={() => setIsFormOpen(false)}
        />
      </Modal>

      <Modal
        isOpen={!!editingBill}
        onClose={() => setEditingBill(null)}
        title="Edit Bill"
      >
        {editingBill && (
          <BillForm
            bill={editingBill}
            incomes={incomes}
            onSubmit={handleUpdate}
            onCancel={() => setEditingBill(null)}
          />
        )}
      </Modal>

      <ConfirmDialog
        isOpen={!!deletingId}
        onClose={() => setDeletingId(null)}
        onConfirm={handleDelete}
        title="Delete Bill"
        message="Are you sure you want to delete this bill? This action cannot be undone."
        confirmText="Delete"
        variant="danger"
      />
    </div>
  );
}
