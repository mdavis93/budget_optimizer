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
  Leave,
  LeaveInput,
  ProposedFix,
  BreakGlassPlan,
  SavingsGoal,
  SavingsGoalInput,
  SkippedBill,
  ScheduleData,
} from '../types';
import { useScheduleEngine } from './draft/useScheduleEngine';
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
import { copyDiagnosticReport } from '../utils/reportError';
import {
  computeDirtyDomains,
  getRequiredSaveDomains,
  persistDomains,
} from '../utils/draftPersist';
import type { ScheduleComputeProgressReport } from '@shared/scheduleComputeProtocol';

interface DraftDataContextValue {
  draft: DraftState;
  isLoading: boolean;
  incomes: Income[];
  bills: Bill[];
  debts: Debt[];
  leaves: Leave[];
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
  createLeave: (input: LeaveInput) => boolean;
  updateLeave: (id: string, input: LeaveInput) => boolean;
  deleteLeave: (id: string) => boolean;
  createGoal: (input: SavingsGoalInput) => boolean;
  updateGoal: (id: string, input: Partial<SavingsGoalInput>) => boolean;
  deleteGoal: (id: string) => boolean;
  skipBill: (billId: string, skipDate: string) => boolean;
  unskipBill: (billId: string, skipDate: string) => boolean;
  assignBill: (billId: string, billDueDate: string, paycheckDate: string) => boolean;
  removeBillAssignment: (billId: string, billDueDate: string) => boolean;
  clearBillAssignments: () => boolean;
  clearStaleBillAssignments: (validPaycheckDates: ReadonlySet<string>) => boolean;
  setIncomeOverride: (incomeId: string, paycheckDate: string, amount: number) => boolean;
  removeIncomeOverride: (incomeId: string, paycheckDate: string) => boolean;
  applyReconciliationFixes: (fixes: ProposedFix[]) => boolean;
  applyBreakGlassPlan: (plan: BreakGlassPlan) => boolean;
  updateBudgetFields: (updates: Partial<DraftBudgetFields>) => boolean;
  getDebtsWithAmortization: () => Promise<DebtWithAmortization[]>;
  getGoalProjections: () => Promise<GoalProjection[]>;
}

interface ScheduleContextValue {
  schedule: ScheduleData | null;
  isLoading: boolean;
  error: string | null;
  diagnosticId: string | null;
  progress: ScheduleComputeProgressReport | null;
  buildStartedAt: number | null;
  /** Sync read of last failure id (avoids toast race with React state). */
  peekScheduleDiagnosticId: () => string | null;
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
    options?: { force?: boolean; preferredAssignments?: Array<[string, string]> }
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
const equalDomains = (left: Set<DraftDomain>, right: Set<DraftDomain>) =>
  left.size === right.size && Array.from(left).every((domain) => right.has(domain));

export function DraftProvider({ children }: { children: ReactNode }) {
  const { isUnlocked } = useAuth();
  const { currentBudget, hasBudgetSelected, refreshCurrentBudget, loadBudgets } = useBudget();
  const { showToast } = useToast();

  const [committed, setCommitted] = useState<DraftState>(createEmptyDraftState());
  const [draft, setDraft] = useState<DraftState>(createEmptyDraftState());
  const [dirtyDomains, setDirtyDomains] = useState<Set<DraftDomain>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  /** One-shot soft placements for the next schedule build (Advisor / reconciliation). */
  const pendingPreferredAssignmentsRef = useRef<Array<[string, string]>>([]);

  const isDraftMode = hasBudgetSelected;

  const stateRef = useRef({
    draft,
    committed,
    dirtyDomains,
    isDraftMode,
    currentBudgetId: currentBudget?.id ?? null,
  });
  stateRef.current = {
    draft,
    committed,
    dirtyDomains,
    isDraftMode,
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
      // Main-process BudgetManager is recreated on unlock with no selection;
      // rebind so subsequent persist IPC is not "No budget selected".
      if (parked.budgetId) {
        void window.electronAPI.budget.switch(parked.budgetId);
      }
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

      const { incomes, bills, goals, skippedBills, billAssignments, incomeOverrides, debts, leaves, budget } =
        result.data;

      const snapshot: DraftState = {
        incomes: incomes ?? [],
        bills: bills ?? [],
        debts: debts ?? [],
        leaves: leaves ?? [],
        goals: goals ?? [],
        skippedBills: skippedBills ?? [],
        billAssignments: billAssignments ?? [],
        incomeOverrides: incomeOverrides ?? [],
        budget: budget ? budgetToDraftFields(budget) : null,
      };

      setCommitted(snapshot);
      setDraft(copyDraftState(snapshot));
      setDirtyDomains((prev) => (prev.size === 0 ? prev : new Set()));
    } finally {
      setIsLoading(false);
    }
  }, [isUnlocked, hasBudgetSelected, currentBudget?.id]);

  useEffect(() => {
    reloadSnapshot();
  }, [reloadSnapshot, currentBudget?.id]);

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

  /** Draft-only paycheck placements (Accept / drag). Never persists until Save. */
  const applyDraftBillPlacements = useCallback(
    (placements: Array<{ billId: string; billDueDate: string; paycheckDate: string }>): boolean => {
      if (!isDraftMode || placements.length === 0) return false;
      let nextAssignments: BillAssignment[] = stateRef.current.draft.billAssignments;
      updateDraft((prev) => {
        nextAssignments = [...prev.billAssignments];
        for (const placement of placements) {
          nextAssignments = nextAssignments.filter(
            (assignment) =>
              !(
                assignment.billId === placement.billId &&
                assignment.billDueDate === placement.billDueDate
              )
          );
          nextAssignments.push({
            id: createDraftId(),
            billId: placement.billId,
            billDueDate: placement.billDueDate,
            paycheckDate: placement.paycheckDate,
            createdAt: nowIso(),
          });
        }
        return { ...prev, billAssignments: nextAssignments };
      });
      const nextDirty = new Set(stateRef.current.dirtyDomains).add('schedule');
      stateRef.current = {
        ...stateRef.current,
        draft: { ...stateRef.current.draft, billAssignments: nextAssignments },
        dirtyDomains: nextDirty,
      };
      markDirty('schedule');
      return true;
    },
    [isDraftMode, updateDraft, markDirty]
  );

  const buildDraftOverlay = useCallback((): DraftOverlay | undefined => {
    const { draft: currentDraft, dirtyDomains: domains, isDraftMode: draftMode } = stateRef.current;
    const preferred = pendingPreferredAssignmentsRef.current;
    const hasPreferred = preferred.length > 0;

    if (!draftMode || (domains.size === 0 && !hasPreferred)) {
      // Quick budget / clean draft: still allow a preferred-only overlay.
      if (hasPreferred) {
        return { preferredAssignments: preferred };
      }
      return undefined;
    }

    return {
      incomes: currentDraft.incomes,
      bills: currentDraft.bills,
      goals: currentDraft.goals,
      debts: currentDraft.debts,
      leaves: currentDraft.leaves,
      skippedBills: currentDraft.skippedBills,
      billAssignments: currentDraft.billAssignments,
      incomeOverrides: currentDraft.incomeOverrides,
      startingBalance: currentDraft.budget?.startingBalance,
      targetCashOnHand: currentDraft.budget?.targetCashOnHand,
      minCashOnHand: currentDraft.budget?.minCashOnHand,
      minSavingsPerPaycheck: currentDraft.budget?.minSavingsPerPaycheck,
      scheduleStartDate: currentDraft.budget?.scheduleStartDate,
      ...(hasPreferred ? { preferredAssignments: preferred } : {}),
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
        const diagnosticId = result.diagnosticId;
        showToast('error', result.error || 'Failed to save changes', {
          action: diagnosticId
            ? {
                label: 'Copy report',
                onClick: () => {
                  void copyDiagnosticReport(diagnosticId);
                },
              }
            : undefined,
        });
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
        const diagnosticId = result.diagnosticId;
        showToast('error', result.error || 'Failed to save changes', {
          action: diagnosticId
            ? {
                label: 'Copy report',
                onClick: () => {
                  void copyDiagnosticReport(diagnosticId);
                },
              }
            : undefined,
        });
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
      if (domain === 'income') {
        next.incomes = structuredClone(saved.incomes);
        next.leaves = structuredClone(saved.leaves);
      }
      if (domain === 'bills') next.bills = structuredClone(saved.bills);
      if (domain === 'debts') next.debts = structuredClone(saved.debts);
      if (domain === 'goals') next.goals = structuredClone(saved.goals);
      if (domain === 'schedule') {
        next.skippedBills = structuredClone(saved.skippedBills);
        next.billAssignments = structuredClone(saved.billAssignments);
        next.incomeOverrides = structuredClone(saved.incomeOverrides);
        if (saved.budget && prev.budget) {
          next.budget = {
            ...prev.budget,
            scheduleStartDate: saved.budget.scheduleStartDate,
          };
        }
      }
      if (domain === 'budget' && saved.budget && prev.budget) {
        next.budget = {
          ...structuredClone(saved.budget),
          scheduleStartDate: prev.budget.scheduleStartDate,
        };
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
  }, [isDraftMode, updateDraft, markDirty]);

  const updateIncome = useCallback(async (id: string, input: IncomeInput): Promise<boolean> => {
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
  }, [isDraftMode, updateDraft, markDirty]);

  const deleteIncome = useCallback(async (id: string): Promise<boolean> => {
    if (isDraftMode) {
      updateDraft((prev) => ({
        ...prev,
        incomes: prev.incomes.filter((income) => income.id !== id),
        leaves: prev.leaves.filter((leave) => leave.incomeId !== id),
      }));
      markDirty('income');
      return true;
    }
    return false;
  }, [isDraftMode, updateDraft, markDirty]);

  const createBill = useCallback(async (input: BillInput): Promise<boolean> => {
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
  }, [isDraftMode, updateDraft, markDirty]);

  const updateBill = useCallback(async (id: string, input: BillInput): Promise<boolean> => {
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
  }, [isDraftMode, updateDraft, markDirty]);

  const deleteBill = useCallback(async (id: string): Promise<boolean> => {
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
  }, [isDraftMode, updateDraft, markDirty]);

  const createDebt = useCallback((input: DebtInput): boolean => {
    if (!currentBudget) return false;
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
  }, [isDraftMode, currentBudget, updateDraft, markDirty]);

  const updateDebt = useCallback((id: string, input: Partial<DebtInput>): boolean => {
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
  }, [isDraftMode, updateDraft, markDirty]);

  const deleteDebt = useCallback((id: string): boolean => {
    if (isDraftMode) {
      updateDraft((prev) => ({
        ...prev,
        debts: prev.debts.filter((debt) => debt.id !== id),
      }));
      markDirty('debts');
      return true;
    }
    return false;
  }, [isDraftMode, updateDraft, markDirty]);

  const createLeave = useCallback((input: LeaveInput): boolean => {
    if (!currentBudget) return false;
    if (!stateRef.current.draft.incomes.some((income) => income.id === input.incomeId)) {
      return false;
    }
    const newLeave: Leave = {
      id: createDraftId(),
      budgetId: currentBudget.id,
      incomeId: input.incomeId,
      name: input.name.trim(),
      type: input.type,
      startDate: input.startDate,
      endDate: input.endDate,
      ...(input.type === 'unpaid' && input.targetCashOnHand !== undefined
        ? { targetCashOnHand: input.targetCashOnHand }
        : {}),
      ...(input.type === 'unpaid' && input.minCashOnHand !== undefined
        ? { minCashOnHand: input.minCashOnHand }
        : {}),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    if (isDraftMode) {
      updateDraft((prev) => ({ ...prev, leaves: [...prev.leaves, newLeave] }));
      markDirty('income');
      return true;
    }
    return false;
  }, [isDraftMode, currentBudget, updateDraft, markDirty]);

  const updateLeave = useCallback((id: string, input: LeaveInput): boolean => {
    if (!stateRef.current.draft.incomes.some((income) => income.id === input.incomeId)) {
      return false;
    }
    if (isDraftMode) {
      updateDraft((prev) => ({
        ...prev,
        leaves: prev.leaves.map((leave) => {
          if (leave.id !== id) return leave;
          const next: Leave = {
            ...leave,
            incomeId: input.incomeId,
            name: input.name.trim(),
            type: input.type,
            startDate: input.startDate,
            endDate: input.endDate,
            updatedAt: nowIso(),
          };
          delete next.targetCashOnHand;
          delete next.minCashOnHand;
          if (input.type === 'unpaid') {
            if (input.targetCashOnHand !== undefined) {
              next.targetCashOnHand = input.targetCashOnHand;
            }
            if (input.minCashOnHand !== undefined) {
              next.minCashOnHand = input.minCashOnHand;
            }
          }
          return next;
        }),
      }));
      markDirty('income');
      return true;
    }
    return false;
  }, [isDraftMode, updateDraft, markDirty]);

  const deleteLeave = useCallback((id: string): boolean => {
    if (isDraftMode) {
      updateDraft((prev) => ({
        ...prev,
        leaves: prev.leaves.filter((leave) => leave.id !== id),
      }));
      markDirty('income');
      return true;
    }
    return false;
  }, [isDraftMode, updateDraft, markDirty]);

  const createGoal = useCallback((input: SavingsGoalInput): boolean => {
    if (!currentBudget) return false;
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
  }, [isDraftMode, currentBudget, updateDraft, markDirty]);

  const updateGoal = useCallback((id: string, input: Partial<SavingsGoalInput>): boolean => {
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
  }, [isDraftMode, updateDraft, markDirty]);

  const deleteGoal = useCallback((id: string): boolean => {
    if (isDraftMode) {
      updateDraft((prev) => ({
        ...prev,
        goals: prev.goals.filter((goal) => goal.id !== id),
      }));
      markDirty('goals');
      return true;
    }
    return false;
  }, [isDraftMode, updateDraft, markDirty]);

  const skipBill = useCallback((billId: string, skipDate: string): boolean => {
    if (isDraftMode) {
      let nextSkipped: SkippedBill[] = stateRef.current.draft.skippedBills;
      updateDraft((prev) => {
        const key = `${billId}-${skipDate}`;
        const exists = prev.skippedBills.some((sb) => `${sb.billId}-${sb.skipDate}` === key);
        if (exists) {
          nextSkipped = prev.skippedBills;
          return prev;
        }
        const newSkip: SkippedBill = {
          id: createDraftId(),
          billId,
          skipDate,
          createdAt: nowIso(),
        };
        nextSkipped = [...prev.skippedBills, newSkip];
        return { ...prev, skippedBills: nextSkipped };
      });
      const nextDirty = new Set(stateRef.current.dirtyDomains).add('schedule');
      stateRef.current = {
        ...stateRef.current,
        draft: { ...stateRef.current.draft, skippedBills: nextSkipped },
        dirtyDomains: nextDirty,
      };
      markDirty('schedule');
      return true;
    }
    return false;
  }, [isDraftMode, updateDraft, markDirty]);

  const unskipBill = useCallback((billId: string, skipDate: string): boolean => {
    if (isDraftMode) {
      let nextSkipped: SkippedBill[] = stateRef.current.draft.skippedBills;
      updateDraft((prev) => {
        nextSkipped = prev.skippedBills.filter(
          (sb) => !(sb.billId === billId && sb.skipDate === skipDate)
        );
        return { ...prev, skippedBills: nextSkipped };
      });
      const nextDirty = new Set(stateRef.current.dirtyDomains).add('schedule');
      stateRef.current = {
        ...stateRef.current,
        draft: { ...stateRef.current.draft, skippedBills: nextSkipped },
        dirtyDomains: nextDirty,
      };
      markDirty('schedule');
      return true;
    }
    return false;
  }, [isDraftMode, updateDraft, markDirty]);

  const assignBill = useCallback((billId: string, billDueDate: string, paycheckDate: string): boolean => {
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
  }, [isDraftMode, updateDraft, markDirty]);

  const removeBillAssignment = useCallback((billId: string, billDueDate: string): boolean => {
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
  }, [isDraftMode, updateDraft, markDirty]);

  const clearBillAssignments = useCallback((): boolean => {
    if (isDraftMode) {
      if (stateRef.current.draft.billAssignments.length === 0) return false;
      updateDraft((prev) => ({ ...prev, billAssignments: [] }));
      markDirty('schedule');
      return true;
    }
    return false;
  }, [isDraftMode, updateDraft, markDirty]);

  const clearStaleBillAssignments = useCallback((validPaycheckDates: ReadonlySet<string>): boolean => {
    if (isDraftMode) {
      const current = stateRef.current.draft.billAssignments;
      const next = current.filter((a) => validPaycheckDates.has(a.paycheckDate));
      if (next.length === current.length) return false;
      updateDraft((prev) => ({ ...prev, billAssignments: next }));
      markDirty('schedule');
      return true;
    }
    return false;
  }, [isDraftMode, updateDraft, markDirty]);

  const setIncomeOverride = useCallback((incomeId: string, paycheckDate: string, amount: number): boolean => {
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
  }, [isDraftMode, updateDraft, markDirty]);

  const removeIncomeOverride = useCallback((incomeId: string, paycheckDate: string): boolean => {
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
  }, [isDraftMode, updateDraft, markDirty]);

  const applyReconciliationFixes = useCallback((fixes: ProposedFix[]): boolean => {
    const placements = fixes
      .filter((fix) => fix.type === 'move_bill' && fix.toPaycheckDate)
      .map((fix) => ({
        billId: fix.billId,
        billDueDate: fix.billDueDate,
        paycheckDate: fix.toPaycheckDate!,
      }));
    return applyDraftBillPlacements(placements);
  }, [applyDraftBillPlacements]);

  const applyBreakGlassPlan = useCallback((plan: BreakGlassPlan): boolean => {
    if (plan.steps.length === 0) return false;
    return applyDraftBillPlacements(
      plan.steps.map((step) => ({
        billId: step.billId,
        billDueDate: step.billDueDate,
        paycheckDate: step.toPaycheckDate,
      }))
    );
  }, [applyDraftBillPlacements]);

  const updateBudgetFields = useCallback((updates: Partial<DraftBudgetFields>): boolean => {
    if (!draft.budget) return false;
    if (isDraftMode) {
      updateDraft((prev) => ({
        ...prev,
        budget: prev.budget ? { ...prev.budget, ...updates } : prev.budget,
      }));
      const onlyScheduleStart =
        Object.keys(updates).length > 0 &&
        Object.keys(updates).every((key) => key === 'scheduleStartDate');
      markDirty(onlyScheduleStart ? 'schedule' : 'budget');
      return true;
    }
    return false;
  }, [isDraftMode, draft.budget, updateDraft, markDirty]);

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
    if (result.errorCode === 'superseded') {
      return [];
    }
    if (result.success && result.data) {
      return result.data as GoalProjection[];
    }
    return [];
  }, [buildDraftOverlay]);

  const scheduleValue = useScheduleEngine({
    draft,
    currentBudget,
    isUnlocked,
    hasBudgetSelected,
    buildDraftOverlay,
    updateBudgetFields,
    pendingPreferredAssignmentsRef,
  });

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
      leaves: draft.leaves,
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
      createLeave,
      updateLeave,
      deleteLeave,
      createGoal,
      updateGoal,
      deleteGoal,
      skipBill,
      unskipBill,
      assignBill,
      removeBillAssignment,
      clearBillAssignments,
      clearStaleBillAssignments,
      setIncomeOverride,
      removeIncomeOverride,
      applyReconciliationFixes,
      applyBreakGlassPlan,
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
      createLeave,
      updateLeave,
      deleteLeave,
      createGoal,
      updateGoal,
      deleteGoal,
      skipBill,
      unskipBill,
      assignBill,
      removeBillAssignment,
      clearBillAssignments,
      clearStaleBillAssignments,
      setIncomeOverride,
      removeIncomeOverride,
      applyReconciliationFixes,
      applyBreakGlassPlan,
      updateBudgetFields,
      getDebtsWithAmortization,
      getGoalProjections,
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
