import { useState, useEffect, useCallback, useMemo, memo } from 'react';
import { format, parseISO } from 'date-fns';
import { CreditCard, Plus, Pencil, Trash2, TrendingDown, Calendar, DollarSign, Percent, ChevronDown } from 'lucide-react';
import { DebtAmortizationChart, ChartSuspense } from '../components/charts/lazyCharts';
import { CHART_COLORS } from '../components/charts/chartTheme';
import { useData } from '../context/DataContext';
import { useDraft } from '../context/DraftContext';
import { useBudget } from '../context/BudgetContext';
import { Bill, DebtInput, DebtWithAmortization } from '../types';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
import clsx from 'clsx';

type TimePeriod = 3 | 6 | 12 | 'max';

type DebtSortMode = 'name' | 'dueDay' | 'minPayment' | 'balance';

/** Group key from `Prefix: Rest` on linked bill name; ungrouped → Other (rendered last). */
function creditorPrefixGroupKey(creditorName: string): string {
  const i = creditorName.indexOf(':');
  if (i === -1) return 'Other';
  const prefix = creditorName.slice(0, i).trim();
  return prefix.length > 0 ? prefix : 'Other';
}

function compareTrackedDebts(a: DebtWithAmortization, b: DebtWithAmortization, mode: DebtSortMode): number {
  const billA = a.bill;
  const billB = b.bill;
  if (!billA && !billB) return 0;
  if (!billA) return 1;
  if (!billB) return -1;
  const nameA = billA.creditorName;
  const nameB = billB.creditorName;
  if (mode === 'name') {
    return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
  }
  if (mode === 'dueDay') {
    if (billA.dueDay !== billB.dueDay) return billA.dueDay - billB.dueDay;
    return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
  }
  if (mode === 'minPayment') {
    if (a.debt.monthlyPayment !== b.debt.monthlyPayment) return a.debt.monthlyPayment - b.debt.monthlyPayment;
    return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
  }
  if (b.debt.principalBalance !== a.debt.principalBalance) return b.debt.principalBalance - a.debt.principalBalance;
  return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
}

function compareUntrackedBills(a: Bill, b: Bill, mode: DebtSortMode): number {
  const nameA = a.creditorName;
  const nameB = b.creditorName;
  if (mode === 'name') {
    return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
  }
  if (mode === 'dueDay') {
    if (a.dueDay !== b.dueDay) return a.dueDay - b.dueDay;
    return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
  }
  if (mode === 'minPayment') {
    if (a.budgetedAmount !== b.budgetedAmount) return a.budgetedAmount - b.budgetedAmount;
    return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
  }
  if (b.budgetedAmount !== a.budgetedAmount) return b.budgetedAmount - a.budgetedAmount;
  return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
}

function sortGroupKeys(keys: string[]): string[] {
  return [...keys].sort((a, b) => {
    if (a === 'Other') return 1;
    if (b === 'Other') return -1;
    return a.localeCompare(b, undefined, { sensitivity: 'base' });
  });
}

interface DebtFormProps {
  debt?: DebtWithAmortization;
  bills: Bill[];
  existingDebtBillIds: Set<string>;
  preselectedBill?: Bill;
  onSubmit: (data: DebtInput) => void;
  onCancel: () => void;
}

function DebtForm({ debt, bills, existingDebtBillIds, preselectedBill, onSubmit, onCancel }: DebtFormProps) {
  const [billId, setBillId] = useState(debt?.debt.billId ?? preselectedBill?.id ?? '');
  const [principalBalance, setPrincipalBalance] = useState(debt?.debt.principalBalance?.toString() ?? '');
  const [apr, setApr] = useState(debt?.debt.apr ? (debt.debt.apr * 100).toString() : '');
  const [monthlyPayment, setMonthlyPayment] = useState(() => {
    if (debt?.debt.monthlyPayment) return debt.debt.monthlyPayment.toString();
    if (preselectedBill) return preselectedBill.budgetedAmount.toString();
    return '';
  });

  const isPreselected = !!preselectedBill;
  const debtBills = bills.filter(b => 
    b.category === 'Debt' && 
    (b.id === debt?.debt.billId || b.id === preselectedBill?.id || !existingDebtBillIds.has(b.id))
  );

  // Get the selected bill to calculate extra payment
  const selectedBill = bills.find(b => b.id === billId);
  const extraPayment = selectedBill && monthlyPayment 
    ? Math.max(0, selectedBill.budgetedAmount - parseFloat(monthlyPayment || '0'))
    : 0;

  const handleBillChange = (newBillId: string) => {
    setBillId(newBillId);
    const newSelectedBill = bills.find(b => b.id === newBillId);
    if (newSelectedBill && !monthlyPayment) {
      setMonthlyPayment(newSelectedBill.budgetedAmount.toString());
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      billId,
      principalBalance: parseFloat(principalBalance),
      apr: parseFloat(apr) / 100,
      monthlyPayment: parseFloat(monthlyPayment),
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="debt-bill" className="label">Linked Bill</label>
        <select
          id="debt-bill"
          value={billId}
          onChange={(e) => handleBillChange(e.target.value)}
          className="input"
          required
          disabled={!!debt || isPreselected}
        >
          <option value="">Select a debt bill...</option>
          {debtBills.map((bill) => (
            <option key={bill.id} value={bill.id}>
              {bill.creditorName} (${bill.budgetedAmount.toFixed(2)}/mo)
            </option>
          ))}
        </select>
        {debtBills.length === 0 && !isPreselected && (
          <p className="text-sm text-warning-500 mt-1">
            No debt bills available. Create a bill with category "Debt" first.
          </p>
        )}
      </div>

      <div>
        <label htmlFor="debt-principal" className="label">Remaining Balance (Principal)</label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]">$</span>
          <input
            id="debt-principal"
            type="number"
            step="0.01"
            min="0"
            value={principalBalance}
            onChange={(e) => setPrincipalBalance(e.target.value)}
            className="input pl-7"
            placeholder="0.00"
            required
          />
        </div>
      </div>

      <div>
        <label htmlFor="debt-apr" className="label">Annual Percentage Rate (APR)</label>
        <div className="relative">
          <input
            id="debt-apr"
            type="number"
            step="0.01"
            min="0"
            max="100"
            value={apr}
            onChange={(e) => setApr(e.target.value)}
            className="input pr-7"
            placeholder="0.00"
            required
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]">%</span>
        </div>
      </div>

      <div>
        <label htmlFor="debt-monthly-payment" className="label">Monthly Payment</label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]">$</span>
          <input
            id="debt-monthly-payment"
            type="number"
            step="0.01"
            min="0"
            value={monthlyPayment}
            onChange={(e) => setMonthlyPayment(e.target.value)}
            className="input pl-7"
            placeholder="0.00"
            required
          />
        </div>
        <p className="text-xs text-[var(--color-text-muted)] mt-1">
          The amount you pay each month toward this debt
        </p>
      </div>

      {selectedBill && monthlyPayment && (
        <div className="p-3 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)]">
          <p className="text-sm font-medium text-[var(--color-text-secondary)]">Extra Payment (auto-calculated)</p>
          <p className={clsx(
            'text-lg font-semibold',
            extraPayment > 0 ? 'text-success-400' : 'text-[var(--color-text-muted)]'
          )}>
            {extraPayment > 0 ? `+$${extraPayment.toFixed(2)}/mo` : 'None'}
          </p>
          <p className="text-xs text-[var(--color-text-muted)] mt-1">
            Based on bill budget (${selectedBill.budgetedAmount.toFixed(2)}) minus minimum payment.
            To pay extra, increase the budgeted amount on the linked bill.
          </p>
        </div>
      )}

      <div className="flex justify-end gap-3 pt-4">
        <button type="button" onClick={onCancel} className="btn-secondary">
          Cancel
        </button>
        <button type="submit" className="btn-primary" disabled={!billId || debtBills.length === 0}>
          {debt ? 'Update' : 'Add'} Debt
        </button>
      </div>
    </form>
  );
}

interface DebtCardProps {
  debtData: DebtWithAmortization;
  timePeriod: TimePeriod;
  onEdit: () => void;
  onDelete: () => void;
}

const DebtCard = memo(function DebtCard({ debtData, timePeriod, onEdit, onDelete }: DebtCardProps) {
  const { debt, bill, amortization } = debtData;
  
  if (!bill || !amortization) {
    return null;
  }

  // Calculate extra payment from bill budget vs minimum payment
  const extraPayment = Math.max(0, bill.budgetedAmount - debt.monthlyPayment);

  const monthsToShow = timePeriod === 'max' ? amortization.monthsToPayoff : Math.min(timePeriod, amortization.monthsToPayoff);
  const paymentsToShow = amortization.payments.slice(0, monthsToShow);
  
  const chartData = paymentsToShow.map((payment) => ({
    name: format(parseISO(payment.date), 'MMM yy'),
    principal: payment.principal,
    interest: payment.interest,
    payment: payment.payment,
  }));

  const displayedInterest = paymentsToShow.reduce((sum, p) => sum + p.interest, 0);
  const displayedPrincipal = paymentsToShow.reduce((sum, p) => sum + p.principal, 0);

  return (
    <div className="card p-6 space-y-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-danger-500/10 flex items-center justify-center">
            <CreditCard className="w-5 h-5 text-danger-400" />
          </div>
          <div>
            <h3 className="font-semibold text-lg">{bill.creditorName}</h3>
            <p className="text-sm text-[var(--color-text-muted)]">
              ${debt.monthlyPayment.toFixed(2)}/mo min payment
              {extraPayment > 0 && (
                <span className="text-success-400">
                  {' '}+ ${extraPayment.toFixed(2)} extra
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onEdit}
            className="p-2 rounded-lg hover:bg-[var(--color-bg-tertiary)] transition-colors"
            aria-label="Edit debt"
          >
            <Pencil className="w-4 h-4 text-[var(--color-text-muted)]" />
          </button>
          <button
            onClick={onDelete}
            className="p-2 rounded-lg hover:bg-danger-500/10 transition-colors"
            aria-label="Delete debt"
          >
            <Trash2 className="w-4 h-4 text-danger-400" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-[var(--color-text-muted)]">
            <DollarSign className="w-4 h-4" />
            <span className="text-xs">Balance</span>
          </div>
          <p className="text-lg font-semibold">${debt.principalBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-[var(--color-text-muted)]">
            <Percent className="w-4 h-4" />
            <span className="text-xs">APR</span>
          </div>
          <p className="text-lg font-semibold">{(debt.apr * 100).toFixed(2)}%</p>
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-[var(--color-text-muted)]">
            <Calendar className="w-4 h-4" />
            <span className="text-xs">Payoff Date</span>
          </div>
          <p className="text-lg font-semibold">
            {amortization.monthsToPayoff > 0 
              ? format(parseISO(amortization.payoffDate), 'MMM yyyy')
              : 'Never'}
          </p>
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-[var(--color-text-muted)]">
            <TrendingDown className="w-4 h-4" />
            <span className="text-xs">Total Interest</span>
          </div>
          <p className="text-lg font-semibold text-danger-400">
            ${amortization.totalInterest.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </p>
        </div>
      </div>

      <div className="pt-4 border-t border-[var(--color-border)]">
        <div className="flex items-center justify-between mb-4">
          <h4 className="font-medium">Payment Breakdown</h4>
          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded" style={{ backgroundColor: CHART_COLORS.principal }} />
              <span>Principal: ${displayedPrincipal.toFixed(2)}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded" style={{ backgroundColor: CHART_COLORS.interest }} />
              <span>Interest: ${displayedInterest.toFixed(2)}</span>
            </div>
          </div>
        </div>
        
        <div className="h-48">
          <ChartSuspense heightClass="h-48">
            <DebtAmortizationChart data={chartData} />
          </ChartSuspense>
        </div>

        <div className="mt-4 p-3 rounded-lg bg-[var(--color-bg-tertiary)] text-sm">
          <div className="flex justify-between">
            <span className="text-[var(--color-text-muted)]">Total Payments ({amortization.monthsToPayoff} months)</span>
            <span className="font-medium">${amortization.totalPayments.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-[var(--color-text-muted)]">Amount Over Principal</span>
            <span className="font-medium text-danger-400">
              +${(amortization.totalPayments - amortization.totalPrincipal).toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
});

interface UnsetupDebtCardProps {
  bill: Bill;
  onClick: () => void;
}

function UnsetupDebtCard({ bill, onClick }: UnsetupDebtCardProps) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left p-4 rounded-lg border-2 border-dashed border-[var(--color-border)] hover:border-primary-500/50 hover:bg-[var(--color-bg-tertiary)] transition-all group"
    >
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-[var(--color-bg-tertiary)] flex items-center justify-center opacity-60 group-hover:opacity-100 transition-opacity">
          <CreditCard className="w-5 h-5 text-[var(--color-text-muted)]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-4">
            <h3 className="font-medium text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)] truncate transition-colors">
              {bill.creditorName}
            </h3>
            <span className="text-sm text-[var(--color-text-muted)] whitespace-nowrap">
              ${bill.budgetedAmount.toFixed(2)}/mo
            </span>
          </div>
          <p className="text-sm text-[var(--color-text-muted)] mt-0.5">
            Click to add remaining balance and APR
          </p>
        </div>
        <div className="ml-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <Plus className="w-5 h-5 text-primary-500" />
        </div>
      </div>
    </button>
  );
}

export default function DebtsPage() {
  const { bills } = useData();
  const draft = useDraft();
  const { isQuickBudget } = useBudget();
  const [debtsWithAmortization, setDebtsWithAmortization] = useState<DebtWithAmortization[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [timePeriod, setTimePeriod] = useState<TimePeriod>(12);
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingDebt, setEditingDebt] = useState<DebtWithAmortization | null>(null);
  const [deleteDebt, setDeleteDebt] = useState<DebtWithAmortization | null>(null);
  const [preselectedBill, setPreselectedBill] = useState<Bill | null>(null);
  const [debtSort, setDebtSort] = useState<DebtSortMode>('name');

  const loadDebts = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await draft.getDebtsWithAmortization();
      setDebtsWithAmortization(data);
    } catch {
      // Error loading debts
    } finally {
      setIsLoading(false);
    }
  }, [draft]);

  useEffect(() => {
    void loadDebts();
  }, [loadDebts, draft.debts, bills]);

  const existingDebtBillIds = useMemo(
    () => new Set(debtsWithAmortization.map((d) => d.debt.billId)),
    [debtsWithAmortization]
  );

  const debtBills = useMemo(() => bills.filter((b) => b.category === 'Debt'), [bills]);

  const untrackedDebtBills = useMemo(
    () => debtBills.filter((b) => !existingDebtBillIds.has(b.id)),
    [debtBills, existingDebtBillIds]
  );

  const hasDebtBills = debtBills.length > 0;
  const hasAnyContent = debtsWithAmortization.length > 0 || untrackedDebtBills.length > 0;

  const trackedDebtGroups = useMemo(() => {
    const map = new Map<string, DebtWithAmortization[]>();
    for (const d of debtsWithAmortization) {
      const key = d.bill ? creditorPrefixGroupKey(d.bill.creditorName) : 'Other';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(d);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => compareTrackedDebts(a, b, debtSort));
    }
    return sortGroupKeys([...map.keys()]).map((key) => ({ key, items: map.get(key)! }));
  }, [debtsWithAmortization, debtSort]);

  const untrackedBillGroups = useMemo(() => {
    const map = new Map<string, Bill[]>();
    for (const bill of untrackedDebtBills) {
      const key = creditorPrefixGroupKey(bill.creditorName);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(bill);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => compareUntrackedBills(a, b, debtSort));
    }
    return sortGroupKeys([...map.keys()]).map((key) => ({ key, items: map.get(key)! }));
  }, [untrackedDebtBills, debtSort]);

  const handleCreateDebt = async (data: DebtInput) => {
    try {
      if (isQuickBudget) {
        const result = await window.electronAPI.debts.create(data);
        if (result.success) {
          await draft.reloadSnapshot();
          await loadDebts();
          setIsModalOpen(false);
          setPreselectedBill(null);
        }
      } else if (draft.createDebt(data)) {
        await loadDebts();
        setIsModalOpen(false);
        setPreselectedBill(null);
      }
    } catch {
      // Error creating debt
    }
  };

  const handleSetupDebt = (bill: Bill) => {
    setPreselectedBill(bill);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setPreselectedBill(null);
  };

  const handleUpdateDebt = async (data: DebtInput) => {
    if (!editingDebt) return;

    try {
      if (isQuickBudget) {
        const result = await window.electronAPI.debts.update(editingDebt.debt.id, data);
        if (result.success) {
          await draft.reloadSnapshot();
          await loadDebts();
          setEditingDebt(null);
        }
      } else if (draft.updateDebt(editingDebt.debt.id, data)) {
        await loadDebts();
        setEditingDebt(null);
      }
    } catch {
      // Error updating debt
    }
  };

  const handleDeleteDebt = async () => {
    if (!deleteDebt) return;

    try {
      if (isQuickBudget) {
        const result = await window.electronAPI.debts.delete(deleteDebt.debt.id);
        if (result.success) {
          await draft.reloadSnapshot();
          await loadDebts();
          setDeleteDebt(null);
        }
      } else if (draft.deleteDebt(deleteDebt.debt.id)) {
        await loadDebts();
        setDeleteDebt(null);
      }
    } catch {
      // Error deleting debt
    }
  };

  const totalBalance = debtsWithAmortization.reduce((sum, d) => sum + d.debt.principalBalance, 0);
  const totalInterest = debtsWithAmortization.reduce((sum, d) => sum + (d.amortization?.totalInterest || 0), 0);
  const maxPayoffMonths = Math.max(...debtsWithAmortization.map(d => d.amortization?.monthsToPayoff || 0), 0);

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
          <h1 className="text-2xl font-bold">Debt Tracking</h1>
          <p className="text-[var(--color-text-muted)] mt-1">
            Track your debt payoff progress and see amortization projections
          </p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)} 
          className="btn-primary"
          disabled={untrackedDebtBills.length === 0}
          title={
            !hasDebtBills 
              ? 'Create a bill with category "Debt" first' 
              : untrackedDebtBills.length === 0 
                ? 'All debt bills are being tracked'
                : ''
          }
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Debt
        </button>
      </div>

      {hasAnyContent && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-[var(--color-text-muted)]">Sort:</span>
          {(
            [
              ['name', 'A–Z'],
              ['dueDay', 'Due'],
              ['minPayment', 'Min pay'],
              ['balance', 'Balance'],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              onClick={() => setDebtSort(mode)}
              className={clsx(
                'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                debtSort === mode
                  ? 'bg-primary-500 text-white'
                  : 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)]'
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {debtsWithAmortization.length > 0 && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="card p-4">
              <p className="text-sm text-[var(--color-text-muted)]">Total Debt Balance</p>
              <p className="text-2xl font-bold text-danger-400">
                ${totalBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </p>
            </div>
            <div className="card p-4">
              <p className="text-sm text-[var(--color-text-muted)]">Total Interest (All Debts)</p>
              <p className="text-2xl font-bold text-warning-400">
                ${totalInterest.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </p>
            </div>
            <div className="card p-4">
              <p className="text-sm text-[var(--color-text-muted)]">Longest Payoff</p>
              <p className="text-2xl font-bold">
                {maxPayoffMonths > 0 ? `${maxPayoffMonths} months` : '—'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-[var(--color-text-muted)]">View:</span>
            {([3, 6, 12, 'max'] as const).map((period) => (
              <button
                key={period}
                onClick={() => setTimePeriod(period)}
                className={clsx(
                  'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                  timePeriod === period
                    ? 'bg-primary-500 text-white'
                    : 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)]'
                )}
              >
                {period === 'max' ? 'MAX' : `${period} mo`}
              </button>
            ))}
          </div>
        </>
      )}

      {!hasAnyContent ? (
        <EmptyState
          icon={CreditCard}
          title="No debts to track"
          description="Create a bill with category 'Debt' first, then you can track its payoff here."
        />
      ) : (
        <div className="space-y-6">
          {untrackedDebtBills.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-medium text-[var(--color-text-muted)] uppercase tracking-wide">
                  Finish Setting Up Your Debts
                </h2>
                <span className="text-xs px-2 py-0.5 rounded-full bg-warning-500/10 text-warning-400 font-medium">
                  {untrackedDebtBills.length}
                </span>
              </div>
              <div className="space-y-3">
                {untrackedBillGroups.map((group) => (
                  <details
                    key={`untracked-${group.key}`}
                    className="group rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] overflow-hidden"
                  >
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
                      <div className="flex items-center gap-2 min-w-0">
                        <ChevronDown className="h-4 w-4 shrink-0 text-[var(--color-text-muted)] transition-transform group-open:rotate-180" />
                        <span className="font-medium truncate">{group.key}</span>
                        <span className="text-xs text-[var(--color-text-muted)]">({group.items.length})</span>
                      </div>
                    </summary>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 border-t border-[var(--color-border)] px-4 pb-4 pt-3">
                      {group.items.map((bill) => (
                        <UnsetupDebtCard
                          key={bill.id}
                          bill={bill}
                          onClick={() => handleSetupDebt(bill)}
                        />
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            </div>
          )}

          {debtsWithAmortization.length > 0 && (
            <div className="space-y-4">
              {untrackedDebtBills.length > 0 && (
                <h2 className="text-sm font-medium text-[var(--color-text-muted)] uppercase tracking-wide">
                  Tracking ({debtsWithAmortization.length})
                </h2>
              )}
              <div className="space-y-3">
                {trackedDebtGroups.map((group) => (
                  <details
                    key={`tracked-${group.key}`}
                    className="group rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] overflow-hidden"
                  >
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
                      <div className="flex items-center gap-2 min-w-0">
                        <ChevronDown className="h-4 w-4 shrink-0 text-[var(--color-text-muted)] transition-transform group-open:rotate-180" />
                        <span className="font-medium truncate">{group.key}</span>
                        <span className="text-xs text-[var(--color-text-muted)]">({group.items.length})</span>
                      </div>
                      <span className="text-xs text-[var(--color-text-muted)] shrink-0 tabular-nums">
                        $
                        {group.items
                          .reduce((sum, d) => sum + d.debt.principalBalance, 0)
                          .toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
                        balance
                      </span>
                    </summary>
                    <div className="space-y-4 border-t border-[var(--color-border)] px-4 pb-4 pt-3">
                      {group.items.map((debtData) => (
                        <DebtCard
                          key={debtData.debt.id}
                          debtData={debtData}
                          timePeriod={timePeriod}
                          onEdit={() => setEditingDebt(debtData)}
                          onDelete={() => setDeleteDebt(debtData)}
                        />
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <Modal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        title={preselectedBill ? `Set Up: ${preselectedBill.creditorName}` : 'Add Debt'}
      >
        <DebtForm
          bills={bills}
          existingDebtBillIds={existingDebtBillIds}
          preselectedBill={preselectedBill ?? undefined}
          onSubmit={handleCreateDebt}
          onCancel={handleCloseModal}
        />
      </Modal>

      <Modal
        isOpen={!!editingDebt}
        onClose={() => setEditingDebt(null)}
        title="Edit Debt"
      >
        {editingDebt && (
          <DebtForm
            debt={editingDebt}
            bills={bills}
            existingDebtBillIds={existingDebtBillIds}
            onSubmit={handleUpdateDebt}
            onCancel={() => setEditingDebt(null)}
          />
        )}
      </Modal>

      <ConfirmDialog
        isOpen={!!deleteDebt}
        onClose={() => setDeleteDebt(null)}
        onConfirm={handleDeleteDebt}
        title="Delete Debt"
        message={`Are you sure you want to delete the debt tracking for "${deleteDebt?.bill?.creditorName}"? The linked bill will remain.`}
        confirmText="Delete"
        variant="danger"
      />
    </div>
  );
}
