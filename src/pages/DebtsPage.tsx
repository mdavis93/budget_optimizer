import { useState, useEffect, useCallback, useMemo } from 'react';
import { differenceInCalendarMonths, parseISO } from 'date-fns';
import { CreditCard, Plus, ChevronDown } from 'lucide-react';
import { useDraftActions, useDraftData, useDraftStatus, useSchedule } from '../context/DraftContext';
import { useBudget } from '../context/BudgetContext';
import { reportError } from '../utils/reportError';
import { formatCurrency } from '../utils/formatCurrency';
import { Bill, DEBT_CATEGORY, DebtInput, DebtWithAmortization } from '../types';
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

function monthsUntilPayoff(startIso: string | undefined, payoffIso: string | null, fallback: number): number {
  if (!startIso || !payoffIso) return fallback;
  const months = differenceInCalendarMonths(parseISO(payoffIso), parseISO(startIso));
  if (!Number.isFinite(months)) return fallback;
  if (months > 0) return months;
  return parseISO(payoffIso).getTime() >= parseISO(startIso).getTime() ? 1 : fallback;
}

export default function DebtsPage() {
  const { debts, bills, budgetFields, incomes = [] } = useDraftData();
  const { isDraftMode } = useDraftStatus();
  const {
    schedule,
    generateSchedule,
    scheduleStartDate,
    scheduleMonths,
    scheduleStartingBalance,
    isViewportReady,
    scheduleInputHash,
  } = useSchedule();
  const { currentBudget, updateBudget } = useBudget();
  const {
    getDebtsWithAmortization,
    createDebt,
    updateDebt,
    deleteDebt: removeDebt,
    updateBudgetFields,
  } = useDraftActions();
  const debtPlan = schedule?.debtPlan;
  const accelerateDebtPayoff = budgetFields
    ? budgetFields.accelerateDebtPayoff === true
    : currentBudget?.accelerateDebtPayoff === true;

  const setAccelerateDebtPayoff = (enabled: boolean) => {
    if (isDraftMode) {
      updateBudgetFields({ accelerateDebtPayoff: enabled });
      return;
    }
    if (currentBudget) {
      void updateBudget(currentBudget.id, { accelerateDebtPayoff: enabled });
    }
  };
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
    } catch (error) {
      void reportError('renderer:DebtsPage.loadDebts', error);
    } finally {
      setIsLoading(false);
    }
  }, [getDebtsWithAmortization]);

  useEffect(() => {
    void loadDebts();
  }, [loadDebts, debts, bills]);

  useEffect(() => {
    if (!isViewportReady || typeof generateSchedule !== 'function') return;
    if (incomes.length === 0 && bills.length === 0) return;
    if (!scheduleStartDate) return;
    void generateSchedule(scheduleStartDate, scheduleMonths, scheduleStartingBalance);
  }, [
    bills,
    generateSchedule,
    incomes,
    isViewportReady,
    scheduleInputHash,
    scheduleMonths,
    scheduleStartDate,
    scheduleStartingBalance,
  ]);

  const existingDebtBillIds = useMemo(
    () => new Set(debtsWithAmortization.map((d) => d.debt.billId)),
    [debtsWithAmortization]
  );

  const debtBills = useMemo(() => bills.filter((b) => b.category === DEBT_CATEGORY), [bills]);

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
      if (createDebt(data)) {
        await loadDebts();
        setIsModalOpen(false);
        setPreselectedBill(null);
      }
    } catch (error) {
      void reportError('renderer:DebtsPage.handleCreateDebt', error);
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
      if (updateDebt(editingDebt.debt.id, data)) {
        await loadDebts();
        setEditingDebt(null);
      }
    } catch (error) {
      void reportError('renderer:DebtsPage.handleUpdateDebt', error);
    }
  };

  const handleDeleteDebt = async () => {
    if (!deleteDebt) return;

    try {
      if (removeDebt(deleteDebt.debt.id)) {
        await loadDebts();
        setDeleteDebt(null);
      }
    } catch (error) {
      void reportError('renderer:DebtsPage.handleDeleteDebt', error);
    }
  };

  const totalBalance = debtsWithAmortization.reduce((sum, d) => sum + d.debt.principalBalance, 0);
  const baselineCardInterest = debtsWithAmortization.reduce((sum, d) => sum + (d.amortization?.totalInterest || 0), 0);
  const baselineMaxMonths = Math.max(...debtsWithAmortization.map(d => d.amortization?.monthsToPayoff || 0), 0);
  const showAccelerated = accelerateDebtPayoff && (debtPlan?.debts.length ?? 0) > 0 && debtPlan?.variant !== 'disabled';
  const totalInterest = showAccelerated
    ? debtsWithAmortization.reduce((sum, debt) => {
        const row = debtPlan?.debts.find((item) => item.debtId === debt.debt.id);
        return sum + (row ? row.acceleratedInterest : (debt.amortization?.totalInterest || 0));
      }, 0)
    : baselineCardInterest;
  const maxPayoffMonths = showAccelerated
    ? Math.max(
        ...debtsWithAmortization.map((debt) => {
          const row = debtPlan?.debts.find((item) => item.debtId === debt.debt.id);
          return monthsUntilPayoff(
            schedule?.startDate,
            row?.acceleratedPayoffDate ?? null,
            debt.amortization?.monthsToPayoff || 0
          );
        }),
        0
      )
    : baselineMaxMonths;

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
          <p className="text-(--color-text-muted) mt-1">
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
          <span className="text-sm text-(--color-text-muted)">Sort:</span>
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
                  : 'bg-(--color-bg-tertiary) text-(--color-text-secondary) hover:bg-(--color-bg-secondary)'
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {debtPlan && debtPlan.totalInterestSaved > 0 && !accelerateDebtPayoff && (
        <div className="card p-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-medium">Accelerated payoff would save {formatCurrency(debtPlan.totalInterestSaved)}</p>
            <p className="text-sm text-(--color-text-muted)">Turn it on to apply extra debt payments in the schedule.</p>
          </div>
          <button type="button" className="btn-primary" onClick={() => setAccelerateDebtPayoff(true)}>
            Turn on accelerated payoff
          </button>
        </div>
      )}

      {accelerateDebtPayoff && (
        <div className="card p-4 flex flex-wrap items-center justify-between gap-3">
          <p className="font-medium">
            Accelerated payoff is on
            {debtPlan && debtPlan.totalInterestSaved > 0
              ? ` and saves ${formatCurrency(debtPlan.totalInterestSaved)} in interest`
              : ''}
          </p>
          <button type="button" className="btn-secondary" onClick={() => setAccelerateDebtPayoff(false)}>
            Turn off accelerated payoff
          </button>
        </div>
      )}

      {debtsWithAmortization.length > 0 && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="card p-4">
              <p className="text-sm text-(--color-text-muted)">Total Debt Balance</p>
              <p className="text-2xl font-bold text-danger-400">
                {formatCurrency(totalBalance)}
              </p>
            </div>
            <div className="card p-4">
              <p className="text-sm text-(--color-text-muted)">Total Interest (All Debts)</p>
              <p className="text-2xl font-bold text-warning-400">
                {formatCurrency(totalInterest)}
              </p>
            </div>
            <div className="card p-4">
              <p className="text-sm text-(--color-text-muted)">Longest Payoff</p>
              <p className="text-2xl font-bold">
                {maxPayoffMonths > 0 ? `${maxPayoffMonths} months` : '—'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-(--color-text-muted)">View:</span>
            {([3, 6, 12, 'max'] as const).map((period) => (
              <button
                key={period}
                onClick={() => setTimePeriod(period)}
                className={clsx(
                  'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                  timePeriod === period
                    ? 'bg-primary-500 text-white'
                    : 'bg-(--color-bg-tertiary) text-(--color-text-secondary) hover:bg-(--color-bg-secondary)'
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
                <h2 className="text-sm font-medium text-(--color-text-muted) uppercase tracking-wide">
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
                    className="group rounded-lg border border-(--color-border) bg-(--color-bg-primary) overflow-hidden"
                  >
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
                      <div className="flex items-center gap-2 min-w-0">
                        <ChevronDown className="h-4 w-4 shrink-0 text-(--color-text-muted) transition-transform group-open:rotate-180" />
                        <span className="font-medium truncate">{group.key}</span>
                        <span className="text-xs text-(--color-text-muted)">({group.items.length})</span>
                      </div>
                    </summary>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 border-t border-(--color-border) px-4 pb-4 pt-3">
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
                <h2 className="text-sm font-medium text-(--color-text-muted) uppercase tracking-wide">
                  Tracking ({debtsWithAmortization.length})
                </h2>
              )}
              <div className="space-y-3">
                {trackedDebtGroups.map((group) => (
                  <details
                    key={`tracked-${group.key}`}
                    className="group rounded-lg border border-(--color-border) bg-(--color-bg-primary) overflow-hidden"
                  >
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
                      <div className="flex items-center gap-2 min-w-0">
                        <ChevronDown className="h-4 w-4 shrink-0 text-(--color-text-muted) transition-transform group-open:rotate-180" />
                        <span className="font-medium truncate">{group.key}</span>
                        <span className="text-xs text-(--color-text-muted)">({group.items.length})</span>
                      </div>
                      <span className="text-xs text-(--color-text-muted) shrink-0 tabular-nums">
                        {formatCurrency(
                          group.items.reduce((sum, d) => sum + d.debt.principalBalance, 0)
                        )}{' '}
                        balance
                      </span>
                    </summary>
                    <div className="space-y-4 border-t border-(--color-border) px-4 pb-4 pt-3">
                      {group.items.map((debtData) => (
                        <DebtCard
                          key={debtData.debt.id}
                          debtData={debtData}
                          timePeriod={timePeriod}
                          planDebt={debtPlan?.debts.find((row) => row.debtId === debtData.debt.id)}
                          excludedReason={debtPlan?.excluded.find((row) => row.debtId === debtData.debt.id)?.reason}
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
