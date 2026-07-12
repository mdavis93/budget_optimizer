import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
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
  ScheduleData,
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
  copyDraftState,
} from '../types/draft';
import { useAuth } from './AuthContext';
import { useBudget } from './BudgetContext';
import { useToast } from '../components/Toast';
import {
  computeDirtyDomains,
  getRequiredSaveDomains,
  persistDomains,
} from '../utils/draftPersist';
import { format, startOfMonth } from 'date-fns';
import { applyScheduleViewport } from '../utils/scheduleViewport';
import {
  buildScheduleCacheKey,
  SCHEDULE_DEBOUNCE_MS,
  type ScheduleCacheEntry,
} from '../utils/scheduleCache';
import { buildScheduleInputHash } from '../utils/scheduleInputHash';

interface DraftDataContextValue {
  draft: DraftState;
  isLoading: boolean;
  incomes: Income[];
  bills: Bill[];
  debts: Debt[];
  goals: SavingsGoal[];
  skippedBills: SkippedBill[];
  billAssignments: BillAssignment[];
  incomeOverrides: IncomeOverride[];
  budgetFields: DraftBudgetFields | null;
}

interface DraftStatusContextValue {
  dirtyDomains: Set<DraftDomain>;
  hasUnsavedChanges: boolean;
  isDraftMode: boolean;
  isSaving: boolean;
  isDomainDirty: (domain: DraftDomain) => boolean;
}

interface DraftActionsContextValue {
  buildDraftOverlay: () => DraftOverlay | undefined;
  saveDomain: (domain: DraftDomain) => Promise<boolean>;
  saveDomains: (domains: DraftDomain[]) => Promise<boolean>;
  getRequiredSaveDomainsFor: (domain: DraftDomain) => DraftDomain[];
  saveAll: () => Promise<boolean>;
  discardDomain: (domain: DraftDomain) => void;
  discardAll: () => void;
  reloadSnapshot: () => Promise<void>;
  createIncome: (input: IncomeInput) => Promise<boolean>;
  updateIncome: (id: string, input: IncomeInput) => Promise<boolean>;
  deleteIncome: (id: string) => Promise<boolean>;
  createBill: (input: BillInput) => Promise<boolean>;
  updateBill: (id: string, input: BillInput) => Promise<boolean>;
  deleteBill: (id: string) => Promise<boolean>;
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

interface ScheduleContextValue {
  schedule: ScheduleData | null;
  isLoading: boolean;
  error: string | null;
  scheduleStartDate: string;
  scheduleMonths: number;
  scheduleStartingBalance: number;
  scheduleInputHash: string;
  setScheduleStartDate: (date: string) => void;
  setScheduleMonths: (months: number) => void;
  setScheduleStartingBalance: (balance: number) => void;
  generateSchedule: (
    startDate: string,
    months: number,
    startingBalance: number,
    options?: { force?: boolean }
  ) => Promise<ScheduleData | null>;
  clearError: () => void;
}

export type DraftContextValue =
  DraftDataContextValue & DraftStatusContextValue & DraftActionsContextValue;

const DraftDataContext = createContext<DraftDataContextValue | null>(null);
const DraftStatusContext = createContext<DraftStatusContextValue | null>(null);
const DraftActionsContext = createContext<DraftActionsContextValue | null>(null);
const ScheduleContext = createContext<ScheduleContextValue | null>(null);

const nowIso = () => new Date().toISOString();
const defaultScheduleStartDate = () => format(startOfMonth(new Date()), 'yyyy-MM-dd');
const equalDomains = (left: Set<DraftDomain>, right: Set<DraftDomain>) =>
  left.size === right.size && Array.from(left).every((domain) => right.has(domain));

export function DraftProvider({ children }: { children: ReactNode }) {
  const { isUnlocked } = useAuth();
  const { currentBudget, isQuickBudget, hasBudgetSelected, refreshCurrentBudget, loadBudgets } = useBudget();
  const { showToast } = useToast();

  const [committed, setCommitted] = useState<DraftState>(createEmptyDraftState());
  const [draft, setDraft] = useState<DraftState>(createEmptyDraftState());
  const [dirtyDomains, setDirtyDomains] = useState<Set<DraftDomain>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [schedule, setSchedule] = useState<ScheduleData | null>(null);
  const [isScheduleLoading, setIsScheduleLoading] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [scheduleMonths, setScheduleMonthsState] = useState(3);
  const [scheduleStartingBalance, setScheduleStartingBalance] = useState(0);
  const [quickBudgetStartDate, setQuickBudgetStartDate] = useState(defaultScheduleStartDate);

  const fullScheduleRef = useRef<ScheduleData | null>(null);
  const scheduleCacheRef = useRef<ScheduleCacheEntry | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const isDraftMode = !isQuickBudget && hasBudgetSelected;

  const stateRef = useRef({
    draft,
    committed,
    dirtyDomains,
    isDraftMode,
    isQuickBudget,
    currentBudgetId: currentBudget?.id ?? null,
  });
  stateRef.current = {
    draft,
    committed,
    dirtyDomains,
    isDraftMode,
    isQuickBudget,
    currentBudgetId: currentBudget?.id ?? null,
  };

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

  // Privacy lock parks a dirty overlay in memory so unlock can resume simulation.
  // This is not a memory wipe — the login screen only hides the UI.
  const parkedDraftRef = useRef<{
    committed: DraftState;
    draft: DraftState;
    dirtyDomains: DraftDomain[];
    budgetId: string | null;
  } | null>(null);

  const reloadSnapshot = useCallback(async () => {
    if (!isUnlocked) {
      const { dirtyDomains: domains, committed: saved, draft: current, currentBudgetId } =
        stateRef.current;
      if (domains.size > 0) {
        parkedDraftRef.current = {
          committed: copyDraftState(saved),
          draft: copyDraftState(current),
          dirtyDomains: Array.from(domains),
          budgetId: currentBudgetId,
        };
      } else {
        parkedDraftRef.current = null;
        const empty = createEmptyDraftState();
        setCommitted(empty);
        setDraft(empty);
        setDirtyDomains((prev) => (prev.size === 0 ? prev : new Set()));
      }
      return;
    }

    if (!hasBudgetSelected) {
      parkedDraftRef.current = null;
      const empty = createEmptyDraftState();
      setCommitted(empty);
      setDraft(empty);
      setDirtyDomains((prev) => (prev.size === 0 ? prev : new Set()));
      return;
    }

    const parked = parkedDraftRef.current;
    if (
      parked &&
      parked.dirtyDomains.length > 0 &&
      parked.budgetId === (currentBudget?.id ?? null)
    ) {
      parkedDraftRef.current = null;
      setCommitted(parked.committed);
      setDraft(parked.draft);
      setDirtyDomains(new Set(parked.dirtyDomains));
      return;
    }
    parkedDraftRef.current = null;

    setIsLoading(true);
    try {
      const result = await window.electronAPI.budget.getSnapshot();
      if (!result.success || !result.data) {
        return;
      }

      const { incomes, bills, goals, skippedBills, billAssignments, incomeOverrides, debts, budget } =
        result.data;

      const snapshot: DraftState = {
        incomes: incomes ?? [],
        bills: bills ?? [],
        debts: isQuickBudget ? [] : (debts ?? []),
        goals: goals ?? [],
        skippedBills: skippedBills ?? [],
        billAssignments: billAssignments ?? [],
        incomeOverrides: incomeOverrides ?? [],
        budget: isQuickBudget ? null : (budget ? budgetToDraftFields(budget) : null),
      };

      setCommitted(snapshot);
      setDraft(copyDraftState(snapshot));
      setDirtyDomains((prev) => (prev.size === 0 ? prev : new Set()));
    } finally {
      setIsLoading(false);
    }
  }, [isUnlocked, hasBudgetSelected, isQuickBudget, currentBudget?.id]);

  useEffect(() => {
    reloadSnapshot();
  }, [reloadSnapshot, currentBudget?.id, isQuickBudget]);

  useEffect(() => {
    setSchedule(null);
    fullScheduleRef.current = null;
    scheduleCacheRef.current = null;
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, [isUnlocked, hasBudgetSelected, currentBudget?.id]);

  useEffect(() => {
    if (draft.budget?.startingBalance !== undefined) {
      setScheduleStartingBalance(draft.budget.startingBalance);
    } else if (currentBudget?.startingBalance !== undefined) {
      setScheduleStartingBalance(currentBudget.startingBalance);
    }
  }, [draft.budget?.startingBalance, currentBudget?.startingBalance]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (isDraftMode) {
      setDirtyDomains((previous) => {
        const next = computeDirtyDomains(committed, draft);
        return equalDomains(previous, next) ? previous : next;
      });
    }
  }, [committed, draft, isDraftMode]);

  const updateDraft = useCallback((updater: (prev: DraftState) => DraftState) => {
    setDraft((prev) => updater(prev));
  }, []);

  const markDirty = useCallback((domain: DraftDomain) => {
    setDirtyDomains((prev) => (prev.has(domain) ? prev : new Set(prev).add(domain)));
  }, []);

  const buildDraftOverlay = useCallback((): DraftOverlay | undefined => {
    const { draft: currentDraft, dirtyDomains: domains, isDraftMode: draftMode } = stateRef.current;
    if (!draftMode || domains.size === 0) return undefined;

    return {
      incomes: currentDraft.incomes,
      bills: currentDraft.bills,
      goals: currentDraft.goals,
      debts: currentDraft.debts,
      skippedBills: currentDraft.skippedBills,
      billAssignments: currentDraft.billAssignments,
      incomeOverrides: currentDraft.incomeOverrides,
      startingBalance: currentDraft.budget?.startingBalance,
      targetCashOnHand: currentDraft.budget?.targetCashOnHand,
      minCashOnHand: currentDraft.budget?.minCashOnHand,
      minSavingsPerPaycheck: currentDraft.budget?.minSavingsPerPaycheck,
      scheduleStartDate: currentDraft.budget?.scheduleStartDate,
    };
  }, []);

  const saveDomains = useCallback(async (domains: DraftDomain[]): Promise<boolean> => {
    const { isDraftMode: draftMode, dirtyDomains: domainsDirty, committed: saved, draft: currentDraft, currentBudgetId } =
      stateRef.current;
    if (!draftMode) return true;

    const domainsToSave = domains.filter((d) => domainsDirty.has(d));
    if (domainsToSave.length === 0) return true;

    setIsSaving(true);
    try {
      const result = await persistDomains(saved, currentDraft, domainsToSave, currentBudgetId);
      if (!result.success) {
        showToast('error', result.error || 'Failed to save changes');
        return false;
      }

      await finalizeSave(result, domainsToSave);
      const label =
        domainsToSave.length === 1
          ? DRAFT_DOMAIN_LABELS[domainsToSave[0]]
          : `${domainsToSave.length} domains`;
      showToast('success', `${label} changes saved`);
      return true;
    } finally {
      setIsSaving(false);
    }
  }, [showToast, finalizeSave]);

  const saveDomain = useCallback(async (domain: DraftDomain): Promise<boolean> => {
    const { dirtyDomains: domains } = stateRef.current;
    const required = getRequiredSaveDomains(domain, stateRef.current.draft, domains);
    return saveDomains(required);
  }, [saveDomains]);

  const getRequiredSaveDomainsFor = useCallback((domain: DraftDomain): DraftDomain[] => {
    const { draft: currentDraft, dirtyDomains: domains } = stateRef.current;
    return getRequiredSaveDomains(domain, currentDraft, domains);
  }, []);

  const saveAll = useCallback(async (): Promise<boolean> => {
    const { isDraftMode: draftMode, dirtyDomains: domains, committed: saved, draft: currentDraft, currentBudgetId } =
      stateRef.current;
    if (!draftMode || domains.size === 0) return true;

    setIsSaving(true);
    try {
      const result = await persistDomains(
        saved,
        currentDraft,
        Array.from(domains),
        currentBudgetId
      );
      if (!result.success) {
        showToast('error', result.error || 'Failed to save changes');
        return false;
      }

      await finalizeSave(result, Array.from(domains));
      showToast('success', 'All changes saved');
      return true;
    } finally {
      setIsSaving(false);
    }
  }, [showToast, finalizeSave]);

  const discardDomain = useCallback((domain: DraftDomain) => {
    const { isDraftMode: draftMode, committed: saved } = stateRef.current;
    if (!draftMode) return;

    setDraft((prev) => {
      const next = { ...prev };
      if (domain === 'income') next.incomes = structuredClone(saved.incomes);
      if (domain === 'bills') next.bills = structuredClone(saved.bills);
      if (domain === 'debts') next.debts = structuredClone(saved.debts);
      if (domain === 'goals') next.goals = structuredClone(saved.goals);
      if (domain === 'schedule') {
        next.skippedBills = structuredClone(saved.skippedBills);
        next.billAssignments = structuredClone(saved.billAssignments);
        next.incomeOverrides = structuredClone(saved.incomeOverrides);
      }
      if (domain === 'budget' && saved.budget) {
        next.budget = structuredClone(saved.budget);
      }
      return next;
    });
  }, []);

  const discardAll = useCallback(() => {
    const { isDraftMode: draftMode, committed: saved } = stateRef.current;
    if (!draftMode) return;
    setDraft(structuredClone(saved));
    setDirtyDomains(new Set());
  }, []);

  const createIncome = useCallback(async (input: IncomeInput): Promise<boolean> => {
    if (isQuickBudget) {
      try {
        const result = await window.electronAPI.income.create(input);
        if (result.success) {
          await reloadSnapshot();
          return true;
        }
      } catch {
        // The page remains usable; the next successful refresh restores the snapshot.
      }
      return false;
    }
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
  }, [isDraftMode, isQuickBudget, updateDraft, markDirty, reloadSnapshot]);

  const updateIncome = useCallback(async (id: string, input: IncomeInput): Promise<boolean> => {
    if (isQuickBudget) {
      try {
        const result = await window.electronAPI.income.update(id, input);
        if (result.success) {
          await reloadSnapshot();
          return true;
        }
      } catch {
        // The page remains usable; the next successful refresh restores the snapshot.
      }
      return false;
    }
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
  }, [isDraftMode, isQuickBudget, updateDraft, markDirty, reloadSnapshot]);

  const deleteIncome = useCallback(async (id: string): Promise<boolean> => {
    if (isQuickBudget) {
      try {
        const result = await window.electronAPI.income.delete(id);
        if (result.success) {
          await reloadSnapshot();
          return true;
        }
      } catch {
        // The page remains usable; the next successful refresh restores the snapshot.
      }
      return false;
    }
    if (isDraftMode) {
      updateDraft((prev) => ({
        ...prev,
        incomes: prev.incomes.filter((income) => income.id !== id),
      }));
      markDirty('income');
      return true;
    }
    return false;
  }, [isDraftMode, isQuickBudget, updateDraft, markDirty, reloadSnapshot]);

  const createBill = useCallback(async (input: BillInput): Promise<boolean> => {
    if (isQuickBudget) {
      try {
        const result = await window.electronAPI.bills.create(input);
        if (result.success) {
          await reloadSnapshot();
          return true;
        }
      } catch {
        // The page remains usable; the next successful refresh restores the snapshot.
      }
      return false;
    }
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
  }, [isDraftMode, isQuickBudget, updateDraft, markDirty, reloadSnapshot]);

  const updateBill = useCallback(async (id: string, input: BillInput): Promise<boolean> => {
    if (isQuickBudget) {
      try {
        const result = await window.electronAPI.bills.update(id, input);
        if (result.success) {
          await reloadSnapshot();
          return true;
        }
      } catch {
        // The page remains usable; the next successful refresh restores the snapshot.
      }
      return false;
    }
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
  }, [isDraftMode, isQuickBudget, updateDraft, markDirty, reloadSnapshot]);

  const deleteBill = useCallback(async (id: string): Promise<boolean> => {
    if (isQuickBudget) {
      try {
        const result = await window.electronAPI.bills.delete(id);
        if (result.success) {
          await reloadSnapshot();
          return true;
        }
      } catch {
        // The page remains usable; the next successful refresh restores the snapshot.
      }
      return false;
    }
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
  }, [isDraftMode, isQuickBudget, updateDraft, markDirty, reloadSnapshot]);

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

  const scheduleStartDate = isQuickBudget
    ? (currentBudget?.scheduleStartDate ?? quickBudgetStartDate)
    : (draft.budget?.scheduleStartDate ?? defaultScheduleStartDate());

  const scheduleInputHash = useMemo(
    () =>
      buildScheduleInputHash({
        incomes: draft.incomes,
        bills: draft.bills,
        skippedBills: draft.skippedBills,
        billAssignments: draft.billAssignments,
        incomeOverrides: draft.incomeOverrides,
        budgetFields: draft.budget,
      }),
    [draft]
  );

  const setScheduleStartDate = useCallback((date: string) => {
    if (isQuickBudget) {
      setQuickBudgetStartDate(date);
      return;
    }
    updateBudgetFields({ scheduleStartDate: date });
  }, [isQuickBudget, updateBudgetFields]);

  const setScheduleMonths = useCallback((months: number) => {
    setScheduleMonthsState(months);
    if (fullScheduleRef.current) {
      setSchedule(
        applyScheduleViewport(
          fullScheduleRef.current,
          months,
          draft.bills,
          scheduleStartingBalance
        )
      );
    }
  }, [draft.bills, scheduleStartingBalance]);

  const applyScheduleResult = useCallback((data: ScheduleData) => {
    const fullHorizonMonths = data.calculationMonths ?? data.viewportMonths;
    const canonical: ScheduleData = {
      ...data,
      paychecks: data.fullPaychecks,
      viewportMonths: fullHorizonMonths,
    };
    fullScheduleRef.current = canonical;
    if (scheduleCacheRef.current) {
      scheduleCacheRef.current = { ...scheduleCacheRef.current, data: canonical };
    }
    const viewportSchedule = applyScheduleViewport(
      canonical,
      data.viewportMonths,
      draft.bills,
      scheduleStartingBalance
    );
    if (mountedRef.current) {
      setSchedule(viewportSchedule);
      setScheduleMonthsState(data.viewportMonths);
    }
    return viewportSchedule;
  }, [draft.bills, scheduleStartingBalance]);

  const generateScheduleImmediate = useCallback(async (
    startDate: string,
    months: number,
    startingBalance: number
  ): Promise<ScheduleData | null> => {
    if (!mountedRef.current) return null;

    setIsScheduleLoading(true);
    try {
      const overlay = buildDraftOverlay();
      const cacheKey = buildScheduleCacheKey(overlay, startDate, months, startingBalance);
      if (scheduleCacheRef.current?.hash === cacheKey) {
        return applyScheduleResult(scheduleCacheRef.current.data);
      }

      const result = await window.electronAPI.schedule.build(startDate, months, startingBalance, overlay);
      if (!mountedRef.current) return null;

      if (result.success && result.data) {
        const fullHorizonMonths = result.data.calculationMonths ?? result.data.viewportMonths;
        const canonical: ScheduleData = {
          ...result.data,
          paychecks: result.data.fullPaychecks,
          viewportMonths: fullHorizonMonths,
        };
        scheduleCacheRef.current = { hash: cacheKey, data: canonical };
        fullScheduleRef.current = canonical;
        return applyScheduleResult(canonical);
      }
      setScheduleError(result.error || 'Failed to generate schedule');
      return null;
    } catch {
      if (mountedRef.current) setScheduleError('Failed to generate schedule');
      return null;
    } finally {
      if (mountedRef.current) setIsScheduleLoading(false);
    }
  }, [buildDraftOverlay, applyScheduleResult]);

  const generateSchedule = useCallback(async (
    startDate: string,
    months: number,
    startingBalance: number,
    options?: { force?: boolean }
  ): Promise<ScheduleData | null> => {
    if (options?.force) {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      return generateScheduleImmediate(startDate, months, startingBalance);
    }

    return new Promise((resolve) => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        void generateScheduleImmediate(startDate, months, startingBalance).then(resolve);
      }, SCHEDULE_DEBOUNCE_MS);
    });
  }, [generateScheduleImmediate]);

  const clearScheduleError = useCallback(() => setScheduleError(null), []);

  const isDomainDirty = useCallback(
    (domain: DraftDomain) => stateRef.current.dirtyDomains.has(domain),
    []
  );

  const dataValue = useMemo(
    (): DraftDataContextValue => ({
      draft,
      isLoading,
      incomes: draft.incomes,
      bills: draft.bills,
      debts: draft.debts,
      goals: draft.goals,
      skippedBills: draft.skippedBills,
      billAssignments: draft.billAssignments,
      incomeOverrides: draft.incomeOverrides,
      budgetFields: draft.budget,
    }),
    [draft, isLoading]
  );

  const statusValue = useMemo(
    (): DraftStatusContextValue => ({
      dirtyDomains,
      hasUnsavedChanges: dirtyDomains.size > 0 && isDraftMode,
      isDraftMode,
      isSaving,
      isDomainDirty,
    }),
    [dirtyDomains, isDraftMode, isSaving, isDomainDirty]
  );

  const actionsValue = useMemo(
    (): DraftActionsContextValue => ({
      buildDraftOverlay,
      saveDomain,
      saveDomains,
      getRequiredSaveDomainsFor,
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
    }),
    [
      buildDraftOverlay,
      saveDomain,
      saveDomains,
      getRequiredSaveDomainsFor,
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
    ]
  );

  const scheduleValue = useMemo(
    (): ScheduleContextValue => ({
      schedule,
      isLoading: isScheduleLoading || isLoading,
      error: scheduleError,
      scheduleStartDate,
      scheduleMonths,
      scheduleStartingBalance,
      scheduleInputHash,
      setScheduleStartDate,
      setScheduleMonths,
      setScheduleStartingBalance,
      generateSchedule,
      clearError: clearScheduleError,
    }),
    [
      schedule,
      isScheduleLoading,
      isLoading,
      scheduleError,
      scheduleStartDate,
      scheduleMonths,
      scheduleStartingBalance,
      scheduleInputHash,
      setScheduleStartDate,
      setScheduleMonths,
      generateSchedule,
      clearScheduleError,
    ]
  );

  return (
    <DraftActionsContext.Provider value={actionsValue}>
      <DraftStatusContext.Provider value={statusValue}>
        <DraftDataContext.Provider value={dataValue}>
          <ScheduleContext.Provider value={scheduleValue}>{children}</ScheduleContext.Provider>
        </DraftDataContext.Provider>
      </DraftStatusContext.Provider>
    </DraftActionsContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useDraftData() {
  const context = useContext(DraftDataContext);
  if (!context) {
    throw new Error('useDraftData must be used within a DraftProvider');
  }
  return context;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useDraftStatus() {
  const context = useContext(DraftStatusContext);
  if (!context) {
    throw new Error('useDraftStatus must be used within a DraftProvider');
  }
  return context;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useDraftActions() {
  const context = useContext(DraftActionsContext);
  if (!context) {
    throw new Error('useDraftActions must be used within a DraftProvider');
  }
  return context;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSchedule() {
  const context = useContext(ScheduleContext);
  if (!context) {
    throw new Error('useSchedule must be used within a DraftProvider');
  }
  return context;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useDraft(): DraftContextValue {
  return { ...useDraftData(), ...useDraftStatus(), ...useDraftActions() };
}

// eslint-disable-next-line react-refresh/only-export-components
export function useDraftOptional(): DraftContextValue | null {
  const data = useContext(DraftDataContext);
  const status = useContext(DraftStatusContext);
  const actions = useContext(DraftActionsContext);
  if (!data || !status || !actions) return null;
  return { ...data, ...status, ...actions };
}
