import { useState, useEffect, useCallback, useMemo } from 'react';
import { CreditCard, Plus, ChevronDown } from 'lucide-react';
import { useData } from '../context/DataContext';
import { useDraftData, useDraftActions } from '../context/DraftContext';
import { useBudget } from '../context/BudgetContext';
import { Bill, DebtInput, DebtWithAmortization } from '../types';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
import clsx from 'clsx';
import {
  DebtForm,
  DebtCard,
  UnsetupDebtCard,
  compareTrackedDebts,
  compareUntrackedBills,
  creditorPrefixGroupKey,
  sortGroupKeys,
  type DebtSortMode,
  type TimePeriod,
} from '../components/debts';

export default function DebtsPage() {
  const { bills } = useData();
  const { debts } = useDraftData();
  const {
    getDebtsWithAmortization,
    reloadSnapshot,
    createDebt,
    updateDebt,
    deleteDebt: removeDebt,
  } = useDraftActions();
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
      const data = await getDebtsWithAmortization();
      setDebtsWithAmortization(data);
    } catch {
      // Error loading debts
    } finally {
      setIsLoading(false);
    }
  }, [getDebtsWithAmortization]);

  useEffect(() => {
    void loadDebts();
  }, [loadDebts, debts, bills]);

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
          await reloadSnapshot();
          await loadDebts();
          setIsModalOpen(false);
          setPreselectedBill(null);
        }
      } else if (createDebt(data)) {
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
          await reloadSnapshot();
          await loadDebts();
          setEditingDebt(null);
        }
      } else if (updateDebt(editingDebt.debt.id, data)) {
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
          await reloadSnapshot();
          await loadDebts();
          setDeleteDebt(null);
        }
      } else if (removeDebt(deleteDebt.debt.id)) {
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
