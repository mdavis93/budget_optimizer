import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  ReactNode,
} from 'react';
import {
  Bill,
  BillAssignment,
  BillInput,
  Debt,
  DebtInput,
  DebtWithAmortization,
  GoalProjection,
  Income,
  IncomeInput,
  IncomeOverride,
  ProposedFix,
  SavingsGoal,
  SavingsGoalInput,
  SkippedBill,
} from '../types';
import {
  DraftBudgetFields,
  DraftDomain,
  DraftOverlay,
  DraftState,
  DRAFT_DOMAIN_LABELS,
  budgetToDraftFields,
  createDraftId,
  createEmptyDraftState,
} from '../types/draft';
import { useAuth } from './AuthContext';
import { useBudget } from './BudgetContext';
import { useToast } from '../components/Toast';
import {
  computeDirtyDomains,
  persistDomains,
} from '../utils/draftPersist';

interface DraftContextValue {
  draft: DraftState;
  dirtyDomains: Set<DraftDomain>;
  hasUnsavedChanges: boolean;
  isDraftMode: boolean;
  isLoading: boolean;
  isSaving: boolean;

  incomes: Income[];
  bills: Bill[];
  debts: Debt[];
  goals: SavingsGoal[];
  skippedBills: SkippedBill[];
  billAssignments: BillAssignment[];
  incomeOverrides: IncomeOverride[];
  budgetFields: DraftBudgetFields | null;

  isDomainDirty: (domain: DraftDomain) => boolean;
  buildDraftOverlay: () => DraftOverlay | undefined;

  saveDomain: (domain: DraftDomain) => Promise<boolean>;
  saveAll: () => Promise<boolean>;
  discardDomain: (domain: DraftDomain) => void;
  discardAll: () => void;
  reloadSnapshot: () => Promise<void>;

  createIncome: (input: IncomeInput) => boolean;
  updateIncome: (id: string, input: IncomeInput) => boolean;
  deleteIncome: (id: string) => boolean;
  createBill: (input: BillInput) => boolean;
  updateBill: (id: string, input: BillInput) => boolean;
  deleteBill: (id: string) => boolean;
  createDebt: (input: DebtInput) => boolean;
  updateDebt: (id: string, input: Partial<DebtInput>) => boolean;
  deleteDebt: (id: string) => boolean;
  createGoal: (input: SavingsGoalInput) => boolean;
  updateGoal: (id: string, input: Partial<SavingsGoalInput>) => boolean;
  deleteGoal: (id: string) => boolean;
  skipBill: (billId: string, skipDate: string) => boolean;
  unskipBill: (billId: string, skipDate: string) => boolean;
  assignBill: (billId: string, billDueDate: string, paycheckDate: string) => boolean;
  removeBillAssignment: (billId: string, billDueDate: string) => boolean;
  setIncomeOverride: (incomeId: string, paycheckDate: string, amount: number) => boolean;
  removeIncomeOverride: (incomeId: string, paycheckDate: string) => boolean;
  applyReconciliationFixes: (fixes: ProposedFix[]) => boolean;
  updateBudgetFields: (updates: Partial<DraftBudgetFields>) => boolean;

  getDebtsWithAmortization: () => Promise<DebtWithAmortization[]>;
  getGoalProjections: () => Promise<GoalProjection[]>;
}

const DraftContext = createContext<DraftContextValue | null>(null);

const nowIso = () => new Date().toISOString();

export function DraftProvider({ children }: { children: ReactNode }) {
  const { isUnlocked } = useAuth();
  const { currentBudget, isQuickBudget, hasBudgetSelected, refreshCurrentBudget, loadBudgets } = useBudget();
  const { showToast } = useToast();

  const [committed, setCommitted] = useState<DraftState>(createEmptyDraftState());
  const [draft, setDraft] = useState<DraftState>(createEmptyDraftState());
  const [dirtyDomains, setDirtyDomains] = useState<Set<DraftDomain>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const isDraftMode = !isQuickBudget && hasBudgetSelected;

  const finalizeSave = useCallback(async (
    result: { nextDraft: DraftState; nextCommitted: DraftState },
    savedDomains: DraftDomain[]
  ) => {
    setCommitted(result.nextCommitted);
    setDraft(result.nextDraft);
    setDirtyDomains(computeDirtyDomains(result.nextCommitted, result.nextDraft));
    if (savedDomains.includes('budget')) {
      await refreshCurrentBudget();
      await loadBudgets();
    }
  }, [refreshCurrentBudget, loadBudgets]);

  const reloadSnapshot = useCallback(async () => {
    if (!isUnlocked || !hasBudgetSelected) {
      const empty = createEmptyDraftState();
      setCommitted(empty);
      setDraft(empty);
      setDirtyDomains(new Set());
      return;
    }

    if (isQuickBudget) {
      const [incomesResult, billsResult, goalsResult, skippedResult, assignmentsResult, overridesResult] =
        await Promise.all([
          window.electronAPI.income.getAll(),
          window.electronAPI.bills.getAll(),
          window.electronAPI.goals.getAll(),
          window.electronAPI.skippedBills.getAll(),
          window.electronAPI.billAssignments.getAll(),
          window.electronAPI.incomeOverrides.getAll(),
        ]);

      const snapshot: DraftState = {
        incomes: incomesResult.data ?? [],
        bills: billsResult.data ?? [],
        debts: [],
        goals: goalsResult.data ?? [],
        skippedBills: skippedResult.data ?? [],
        billAssignments: assignmentsResult.data ?? [],
        incomeOverrides: overridesResult.data ?? [],
        budget: null,
      };

      if (currentBudget) {
        const debtsResult = await window.electronAPI.debts.getAll();
        snapshot.debts = debtsResult.data ?? [];
      }

      setCommitted(snapshot);
      setDraft(structuredClone(snapshot));
      setDirtyDomains(new Set());
      return;
    }

    setIsLoading(true);
    try {
      const [incomesResult, billsResult, goalsResult, skippedResult, assignmentsResult, overridesResult, debtsResult] =
        await Promise.all([
          window.electronAPI.income.getAll(),
          window.electronAPI.bills.getAll(),
          window.electronAPI.goals.getAll(),
          window.electronAPI.skippedBills.getAll(),
          window.electronAPI.billAssignments.getAll(),
          window.electronAPI.incomeOverrides.getAll(),
          currentBudget ? window.electronAPI.debts.getAll() : Promise.resolve({ success: true, data: [] as Debt[] }),
        ]);

      const snapshot: DraftState = {
        incomes: incomesResult.data ?? [],
        bills: billsResult.data ?? [],
        debts: debtsResult.data ?? [],
        goals: goalsResult.data ?? [],
        skippedBills: skippedResult.data ?? [],
        billAssignments: assignmentsResult.data ?? [],
        incomeOverrides: overridesResult.data ?? [],
        budget: currentBudget ? budgetToDraftFields(currentBudget) : null,
      };

      setCommitted(snapshot);
      setDraft(structuredClone(snapshot));
      setDirtyDomains(new Set());
    } finally {
      setIsLoading(false);
    }
  }, [isUnlocked, hasBudgetSelected, isQuickBudget, currentBudget]);

  useEffect(() => {
    reloadSnapshot();
  }, [reloadSnapshot, currentBudget?.id, isQuickBudget]);

  useEffect(() => {
    if (isDraftMode) {
      setDirtyDomains(computeDirtyDomains(committed, draft));
    }
  }, [committed, draft, isDraftMode]);

  const updateDraft = useCallback((updater: (prev: DraftState) => DraftState) => {
    setDraft((prev) => updater(prev));
  }, []);

  const markDirty = useCallback((domain: DraftDomain) => {
    setDirtyDomains((prev) => new Set(prev).add(domain));
  }, []);

  const buildDraftOverlay = useCallback((): DraftOverlay | undefined => {
    if (!isDraftMode || dirtyDomains.size === 0) return undefined;

    return {
      incomes: draft.incomes,
      bills: draft.bills,
      goals: draft.goals,
      debts: draft.debts,
      skippedBills: draft.skippedBills,
      billAssignments: draft.billAssignments,
      incomeOverrides: draft.incomeOverrides,
      startingBalance: draft.budget?.startingBalance,
      targetCashOnHand: draft.budget?.targetCashOnHand,
      minCashOnHand: draft.budget?.minCashOnHand,
      minSavingsPerPaycheck: draft.budget?.minSavingsPerPaycheck,
    };
  }, [isDraftMode, dirtyDomains.size, draft]);

  const saveDomain = useCallback(async (domain: DraftDomain): Promise<boolean> => {
    if (!isDraftMode) return true;
    if (!dirtyDomains.has(domain)) return true;

    setIsSaving(true);
    try {
      const result = await persistDomains(committed, draft, [domain], currentBudget?.id ?? null);
      if (!result.success) {
        showToast('error', result.error || 'Failed to save changes');
        return false;
      }

      await finalizeSave(result, [domain]);
      showToast('success', `${DRAFT_DOMAIN_LABELS[domain]} changes saved`);
      return true;
    } finally {
      setIsSaving(false);
    }
  }, [isDraftMode, dirtyDomains, committed, draft, currentBudget?.id, showToast, finalizeSave]);

  const saveAll = useCallback(async (): Promise<boolean> => {
    if (!isDraftMode || dirtyDomains.size === 0) return true;

    setIsSaving(true);
    try {
      const result = await persistDomains(
        committed,
        draft,
        Array.from(dirtyDomains),
        currentBudget?.id ?? null
      );
      if (!result.success) {
        showToast('error', result.error || 'Failed to save changes');
        return false;
      }

      await finalizeSave(result, Array.from(dirtyDomains));
      showToast('success', 'All changes saved');
      return true;
    } finally {
      setIsSaving(false);
    }
  }, [isDraftMode, dirtyDomains, committed, draft, currentBudget?.id, showToast, finalizeSave]);

  const discardDomain = useCallback((domain: DraftDomain) => {
    if (!isDraftMode) return;

    setDraft((prev) => {
      const next = { ...prev };
      if (domain === 'income') next.incomes = structuredClone(committed.incomes);
      if (domain === 'bills') next.bills = structuredClone(committed.bills);
      if (domain === 'debts') next.debts = structuredClone(committed.debts);
      if (domain === 'goals') next.goals = structuredClone(committed.goals);
      if (domain === 'schedule') {
        next.skippedBills = structuredClone(committed.skippedBills);
        next.billAssignments = structuredClone(committed.billAssignments);
        next.incomeOverrides = structuredClone(committed.incomeOverrides);
      }
      if (domain === 'budget' && committed.budget) {
        next.budget = structuredClone(committed.budget);
      }
      return next;
    });
  }, [isDraftMode, committed]);

  const discardAll = useCallback(() => {
    if (!isDraftMode) return;
    setDraft(structuredClone(committed));
    setDirtyDomains(new Set());
  }, [isDraftMode, committed]);

  const createIncome = useCallback((input: IncomeInput): boolean => {
    if (isQuickBudget) return false;
    const newIncome: Income = {
      id: createDraftId(),
      ...input,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    if (isDraftMode) {
      updateDraft((prev) => ({ ...prev, incomes: [...prev.incomes, newIncome] }));
      markDirty('income');
      return true;
    }
    return false;
  }, [isDraftMode, isQuickBudget, updateDraft, markDirty]);

  const updateIncome = useCallback((id: string, input: IncomeInput): boolean => {
    if (isQuickBudget) return false;
    if (isDraftMode) {
      updateDraft((prev) => ({
        ...prev,
        incomes: prev.incomes.map((income) =>
          income.id === id ? { ...income, ...input, updatedAt: nowIso() } : income
        ),
      }));
      markDirty('income');
      return true;
    }
    return false;
  }, [isDraftMode, isQuickBudget, updateDraft, markDirty]);

  const deleteIncome = useCallback((id: string): boolean => {
    if (isQuickBudget) return false;
    if (isDraftMode) {
      updateDraft((prev) => ({
        ...prev,
        incomes: prev.incomes.filter((income) => income.id !== id),
      }));
      markDirty('income');
      return true;
    }
    return false;
  }, [isDraftMode, isQuickBudget, updateDraft, markDirty]);

  const createBill = useCallback((input: BillInput): boolean => {
    if (isQuickBudget) return false;
    const newBill: Bill = {
      id: createDraftId(),
      ...input,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    if (isDraftMode) {
      updateDraft((prev) => ({ ...prev, bills: [...prev.bills, newBill] }));
      markDirty('bills');
      return true;
    }
    return false;
  }, [isDraftMode, isQuickBudget, updateDraft, markDirty]);

  const updateBill = useCallback((id: string, input: BillInput): boolean => {
    if (isQuickBudget) return false;
    if (isDraftMode) {
      updateDraft((prev) => ({
        ...prev,
        bills: prev.bills.map((bill) =>
          bill.id === id ? { ...bill, ...input, updatedAt: nowIso() } : bill
        ),
      }));
      markDirty('bills');
      return true;
    }
    return false;
  }, [isDraftMode, isQuickBudget, updateDraft, markDirty]);

  const deleteBill = useCallback((id: string): boolean => {
    if (isQuickBudget) return false;
    if (isDraftMode) {
      updateDraft((prev) => {
        const hadDebt = prev.debts.some((debt) => debt.billId === id);
        const next = {
          ...prev,
          bills: prev.bills.filter((bill) => bill.id !== id),
          debts: prev.debts.filter((debt) => debt.billId !== id),
        };
        if (hadDebt) {
          setDirtyDomains((domains) => new Set(domains).add('debts'));
        }
        return next;
      });
      markDirty('bills');
      return true;
    }
    return false;
  }, [isDraftMode, isQuickBudget, updateDraft, markDirty]);

  const createDebt = useCallback((input: DebtInput): boolean => {
    if (isQuickBudget || !currentBudget) return false;
    const newDebt: Debt = {
      id: createDraftId(),
      budgetId: currentBudget.id,
      ...input,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    if (isDraftMode) {
      updateDraft((prev) => ({ ...prev, debts: [...prev.debts, newDebt] }));
      markDirty('debts');
      return true;
    }
    return false;
  }, [isDraftMode, isQuickBudget, currentBudget, updateDraft, markDirty]);

  const updateDebt = useCallback((id: string, input: Partial<DebtInput>): boolean => {
    if (isQuickBudget) return false;
    if (isDraftMode) {
      updateDraft((prev) => ({
        ...prev,
        debts: prev.debts.map((debt) =>
          debt.id === id ? { ...debt, ...input, updatedAt: nowIso() } : debt
        ),
      }));
      markDirty('debts');
      return true;
    }
    return false;
  }, [isDraftMode, isQuickBudget, updateDraft, markDirty]);

  const deleteDebt = useCallback((id: string): boolean => {
    if (isQuickBudget) return false;
    if (isDraftMode) {
      updateDraft((prev) => ({
        ...prev,
        debts: prev.debts.filter((debt) => debt.id !== id),
      }));
      markDirty('debts');
      return true;
    }
    return false;
  }, [isDraftMode, isQuickBudget, updateDraft, markDirty]);

  const createGoal = useCallback((input: SavingsGoalInput): boolean => {
    if (isQuickBudget || !currentBudget) return false;
    const newGoal: SavingsGoal = {
      id: createDraftId(),
      budgetId: currentBudget.id,
      name: input.name,
      targetAmount: input.targetAmount,
      targetDate: input.targetDate,
      alreadySaved: input.alreadySaved ?? 0,
      priority: input.priority ?? 1,
      createdAt: nowIso(),
    };
    if (isDraftMode) {
      updateDraft((prev) => ({ ...prev, goals: [...prev.goals, newGoal] }));
      markDirty('goals');
      return true;
    }
    return false;
  }, [isDraftMode, isQuickBudget, currentBudget, updateDraft, markDirty]);

  const updateGoal = useCallback((id: string, input: Partial<SavingsGoalInput>): boolean => {
    if (isQuickBudget) return false;
    if (isDraftMode) {
      updateDraft((prev) => ({
        ...prev,
        goals: prev.goals.map((goal) =>
          goal.id === id ? { ...goal, ...input } : goal
        ),
      }));
      markDirty('goals');
      return true;
    }
    return false;
  }, [isDraftMode, isQuickBudget, updateDraft, markDirty]);

  const deleteGoal = useCallback((id: string): boolean => {
    if (isQuickBudget) return false;
    if (isDraftMode) {
      updateDraft((prev) => ({
        ...prev,
        goals: prev.goals.filter((goal) => goal.id !== id),
      }));
      markDirty('goals');
      return true;
    }
    return false;
  }, [isDraftMode, isQuickBudget, updateDraft, markDirty]);

  const skipBill = useCallback((billId: string, skipDate: string): boolean => {
    if (isQuickBudget) return false;
    if (isDraftMode) {
      updateDraft((prev) => {
        const key = `${billId}-${skipDate}`;
        const exists = prev.skippedBills.some((sb) => `${sb.billId}-${sb.skipDate}` === key);
        if (exists) return prev;
        const newSkip: SkippedBill = {
          id: createDraftId(),
          billId,
          skipDate,
          createdAt: nowIso(),
        };
        return { ...prev, skippedBills: [...prev.skippedBills, newSkip] };
      });
      markDirty('schedule');
      return true;
    }
    return false;
  }, [isDraftMode, isQuickBudget, updateDraft, markDirty]);

  const unskipBill = useCallback((billId: string, skipDate: string): boolean => {
    if (isQuickBudget) return false;
    if (isDraftMode) {
      updateDraft((prev) => ({
        ...prev,
        skippedBills: prev.skippedBills.filter(
          (sb) => !(sb.billId === billId && sb.skipDate === skipDate)
        ),
      }));
      markDirty('schedule');
      return true;
    }
    return false;
  }, [isDraftMode, isQuickBudget, updateDraft, markDirty]);

  const assignBill = useCallback((billId: string, billDueDate: string, paycheckDate: string): boolean => {
    if (isQuickBudget) return false;
    if (isDraftMode) {
      updateDraft((prev) => {
        const filtered = prev.billAssignments.filter(
          (a) => !(a.billId === billId && a.billDueDate === billDueDate)
        );
        const assignment: BillAssignment = {
          id: createDraftId(),
          billId,
          billDueDate,
          paycheckDate,
          createdAt: nowIso(),
        };
        return { ...prev, billAssignments: [...filtered, assignment] };
      });
      markDirty('schedule');
      return true;
    }
    return false;
  }, [isDraftMode, isQuickBudget, updateDraft, markDirty]);

  const removeBillAssignment = useCallback((billId: string, billDueDate: string): boolean => {
    if (isQuickBudget) return false;
    if (isDraftMode) {
      updateDraft((prev) => ({
        ...prev,
        billAssignments: prev.billAssignments.filter(
          (a) => !(a.billId === billId && a.billDueDate === billDueDate)
        ),
      }));
      markDirty('schedule');
      return true;
    }
    return false;
  }, [isDraftMode, isQuickBudget, updateDraft, markDirty]);

  const setIncomeOverride = useCallback((incomeId: string, paycheckDate: string, amount: number): boolean => {
    if (isQuickBudget) return false;
    if (isDraftMode) {
      updateDraft((prev) => {
        const filtered = prev.incomeOverrides.filter(
          (o) => !(o.incomeId === incomeId && o.paycheckDate === paycheckDate)
        );
        const override: IncomeOverride = {
          id: createDraftId(),
          incomeId,
          paycheckDate,
          amount,
          createdAt: nowIso(),
        };
        return { ...prev, incomeOverrides: [...filtered, override] };
      });
      markDirty('schedule');
      return true;
    }
    return false;
  }, [isDraftMode, isQuickBudget, updateDraft, markDirty]);

  const removeIncomeOverride = useCallback((incomeId: string, paycheckDate: string): boolean => {
    if (isQuickBudget) return false;
    if (isDraftMode) {
      updateDraft((prev) => ({
        ...prev,
        incomeOverrides: prev.incomeOverrides.filter(
          (o) => !(o.incomeId === incomeId && o.paycheckDate === paycheckDate)
        ),
      }));
      markDirty('schedule');
      return true;
    }
    return false;
  }, [isDraftMode, isQuickBudget, updateDraft, markDirty]);

  const applyReconciliationFixes = useCallback((fixes: ProposedFix[]): boolean => {
    if (isQuickBudget) return false;
    if (isDraftMode) {
      updateDraft((prev) => {
        const next = { ...prev };
        for (const fix of fixes) {
          if (fix.type === 'move_bill' && fix.toPaycheckDate) {
            next.billAssignments = [
              ...next.billAssignments.filter(
                (a) => !(a.billId === fix.billId && a.billDueDate === fix.billDueDate)
              ),
              {
                id: createDraftId(),
                billId: fix.billId,
                billDueDate: fix.billDueDate,
                paycheckDate: fix.toPaycheckDate,
                createdAt: nowIso(),
              },
            ];
          } else if (fix.type === 'skip_bill') {
            const key = `${fix.billId}-${fix.fromPaycheckDate}`;
            const exists = next.skippedBills.some((sb) => `${sb.billId}-${sb.skipDate}` === key);
            if (!exists) {
              next.skippedBills = [
                ...next.skippedBills,
                {
                  id: createDraftId(),
                  billId: fix.billId,
                  skipDate: fix.fromPaycheckDate,
                  createdAt: nowIso(),
                },
              ];
            }
          }
        }
        return next;
      });
      markDirty('schedule');
      return true;
    }
    return false;
  }, [isDraftMode, isQuickBudget, updateDraft, markDirty]);

  const updateBudgetFields = useCallback((updates: Partial<DraftBudgetFields>): boolean => {
    if (isQuickBudget || !draft.budget) return false;
    if (isDraftMode) {
      updateDraft((prev) => ({
        ...prev,
        budget: prev.budget ? { ...prev.budget, ...updates } : prev.budget,
      }));
      markDirty('budget');
      return true;
    }
    return false;
  }, [isDraftMode, isQuickBudget, draft.budget, updateDraft, markDirty]);

  const getDebtsWithAmortization = useCallback(async (): Promise<DebtWithAmortization[]> => {
    const overlay = buildDraftOverlay();
    const result = await window.electronAPI.debts.getAllWithAmortization(overlay);
    if (result.success && result.data) {
      return result.data as DebtWithAmortization[];
    }
    return [];
  }, [buildDraftOverlay]);

  const getGoalProjections = useCallback(async (): Promise<GoalProjection[]> => {
    const overlay = buildDraftOverlay();
    const result = await window.electronAPI.goals.getProjections(overlay);
    if (result.success && result.data) {
      return result.data as GoalProjection[];
    }
    return [];
  }, [buildDraftOverlay]);

  const isDomainDirty = useCallback((domain: DraftDomain) => dirtyDomains.has(domain), [dirtyDomains]);

  const value = useMemo(() => ({
    draft,
    dirtyDomains,
    hasUnsavedChanges: dirtyDomains.size > 0 && isDraftMode,
    isDraftMode,
    isLoading,
    isSaving,
    incomes: draft.incomes,
    bills: draft.bills,
    debts: draft.debts,
    goals: draft.goals,
    skippedBills: draft.skippedBills,
    billAssignments: draft.billAssignments,
    incomeOverrides: draft.incomeOverrides,
    budgetFields: draft.budget,
    isDomainDirty,
    buildDraftOverlay,
    saveDomain,
    saveAll,
    discardDomain,
    discardAll,
    reloadSnapshot,
    createIncome,
    updateIncome,
    deleteIncome,
    createBill,
    updateBill,
    deleteBill,
    createDebt,
    updateDebt,
    deleteDebt,
    createGoal,
    updateGoal,
    deleteGoal,
    skipBill,
    unskipBill,
    assignBill,
    removeBillAssignment,
    setIncomeOverride,
    removeIncomeOverride,
    applyReconciliationFixes,
    updateBudgetFields,
    getDebtsWithAmortization,
    getGoalProjections,
  }), [
    draft,
    dirtyDomains,
    isDraftMode,
    isLoading,
    isSaving,
    isDomainDirty,
    buildDraftOverlay,
    saveDomain,
    saveAll,
    discardDomain,
    discardAll,
    reloadSnapshot,
    createIncome,
    updateIncome,
    deleteIncome,
    createBill,
    updateBill,
    deleteBill,
    createDebt,
    updateDebt,
    deleteDebt,
    createGoal,
    updateGoal,
    deleteGoal,
    skipBill,
    unskipBill,
    assignBill,
    removeBillAssignment,
    setIncomeOverride,
    removeIncomeOverride,
    applyReconciliationFixes,
    updateBudgetFields,
    getDebtsWithAmortization,
    getGoalProjections,
  ]);

  return <DraftContext.Provider value={value}>{children}</DraftContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useDraft() {
  const context = useContext(DraftContext);
  if (!context) {
    throw new Error('useDraft must be used within a DraftProvider');
  }
  return context;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useDraftOptional() {
  return useContext(DraftContext);
}
