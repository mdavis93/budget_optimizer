import {
  Bill,
  BillAssignment,
  BillInput,
  Debt,
  DebtInput,
  Income,
  IncomeInput,
  IncomeOverride,
  SavingsGoal,
  SavingsGoalInput,
  SkippedBill,
} from '../types';
import {
  DraftBudgetFields,
  DraftDomain,
  DraftState,
  isDraftId,
} from '../types/draft';
import {
  applyIdMap,
  computeEntityDiff,
  computeKeyedDiff,
  persistEntityDiff,
  remapBillReferences,
  remapDebtBillIds,
} from './draftDiff';

function incomeEquals(a: Income, b: Income): boolean {
  return (
    a.sourceName === b.sourceName &&
    a.amount === b.amount &&
    a.cadence === b.cadence &&
    a.startDate === b.startDate &&
    a.isActive === b.isActive
  );
}

function billEquals(a: Bill, b: Bill): boolean {
  return (
    a.creditorName === b.creditorName &&
    a.budgetedAmount === b.budgetedAmount &&
    a.dueDay === b.dueDay &&
    a.category === b.category &&
    a.isRecurring === b.isRecurring &&
    a.priority === b.priority &&
    a.preferredIncomeSourceId === b.preferredIncomeSourceId &&
    a.isIncomeAttached === b.isIncomeAttached
  );
}

function debtEquals(a: Debt, b: Debt): boolean {
  return (
    a.billId === b.billId &&
    a.principalBalance === b.principalBalance &&
    a.apr === b.apr &&
    a.monthlyPayment === b.monthlyPayment
  );
}

function goalEquals(a: SavingsGoal, b: SavingsGoal): boolean {
  return (
    a.name === b.name &&
    a.targetAmount === b.targetAmount &&
    a.targetDate === b.targetDate &&
    a.alreadySaved === b.alreadySaved &&
    a.priority === b.priority
  );
}

function budgetEquals(a: DraftBudgetFields, b: DraftBudgetFields): boolean {
  return (
    a.name === b.name &&
    a.startingBalance === b.startingBalance &&
    a.targetCashOnHand === b.targetCashOnHand &&
    a.minCashOnHand === b.minCashOnHand &&
    a.minSavingsPerPaycheck === b.minSavingsPerPaycheck
  );
}

function toIncomeInput(income: Income): IncomeInput {
  return {
    sourceName: income.sourceName,
    amount: income.amount,
    cadence: income.cadence,
    startDate: income.startDate,
    isActive: income.isActive,
  };
}

function toBillInput(bill: Bill): BillInput {
  return {
    creditorName: bill.creditorName,
    budgetedAmount: bill.budgetedAmount,
    dueDay: bill.dueDay,
    category: bill.category,
    isRecurring: bill.isRecurring,
    priority: bill.priority,
    preferredIncomeSourceId: bill.preferredIncomeSourceId,
    isIncomeAttached: bill.isIncomeAttached,
  };
}

function toDebtInput(debt: Debt): DebtInput {
  return {
    billId: debt.billId,
    principalBalance: debt.principalBalance,
    apr: debt.apr,
    monthlyPayment: debt.monthlyPayment,
  };
}

function toGoalInput(goal: SavingsGoal): SavingsGoalInput {
  return {
    name: goal.name,
    targetAmount: goal.targetAmount,
    targetDate: goal.targetDate,
    alreadySaved: goal.alreadySaved,
    priority: goal.priority,
  };
}

export async function persistIncomeDomain(
  committed: DraftState,
  draft: DraftState
): Promise<{
  success: boolean;
  error?: string;
  nextDraft: DraftState;
  nextCommitted: DraftState;
  idMap: Map<string, string>;
}> {
  const diff = computeEntityDiff(committed.incomes, draft.incomes, incomeEquals);
  const result = await persistEntityDiff(diff, {
    isDraftId,
    toCreateInput: toIncomeInput,
    toUpdateInput: toIncomeInput,
    create: (input) => window.electronAPI.income.create(input),
    update: (id, input) => window.electronAPI.income.update(id, input),
    remove: (id) => window.electronAPI.income.delete(id),
  });

  if (!result.success) {
    return { success: false, error: result.error, nextDraft: draft, nextCommitted: committed, idMap: new Map() };
  }

  const idMap = result.idMap ?? new Map<string, string>();
  const nextIncomes = applyIdMap(draft.incomes, idMap);
  let nextDraft = { ...draft, incomes: nextIncomes };
  const nextCommitted = { ...committed, incomes: structuredClone(nextIncomes) };

  if (idMap.size > 0) {
    nextDraft = {
      ...nextDraft,
      bills: remapBillReferences(nextDraft.bills, idMap),
      incomeOverrides: nextDraft.incomeOverrides.map((override) => {
        const mapped = idMap.get(override.incomeId);
        return mapped ? { ...override, incomeId: mapped } : override;
      }),
    };
  }

  return { success: true, nextDraft, nextCommitted, idMap };
}

export async function persistBillsDomain(
  committed: DraftState,
  draft: DraftState,
  incomeIdMap: Map<string, string>
): Promise<{
  success: boolean;
  error?: string;
  nextDraft: DraftState;
  nextCommitted: DraftState;
  idMap: Map<string, string>;
}> {
  const billsWithMappedIncome = remapBillReferences(draft.bills, incomeIdMap);
  const diff = computeEntityDiff(committed.bills, billsWithMappedIncome, billEquals);
  const result = await persistEntityDiff(diff, {
    isDraftId,
    toCreateInput: toBillInput,
    toUpdateInput: toBillInput,
    create: (input) => window.electronAPI.bills.create(input),
    update: (id, input) => window.electronAPI.bills.update(id, input),
    remove: (id) => window.electronAPI.bills.delete(id),
  });

  if (!result.success) {
    return { success: false, error: result.error, nextDraft: draft, nextCommitted: committed, idMap: new Map() };
  }

  const idMap = result.idMap ?? new Map<string, string>();
  const nextBills = applyIdMap(billsWithMappedIncome, idMap);
  const nextDraft = { ...draft, bills: nextBills };
  const nextCommitted = { ...committed, bills: structuredClone(nextBills) };

  return { success: true, nextDraft, nextCommitted, idMap };
}

export async function persistDebtsDomain(
  committed: DraftState,
  draft: DraftState,
  billIdMap: Map<string, string>
): Promise<{ success: boolean; error?: string; nextDraft: DraftState; nextCommitted: DraftState }> {
  const debtsWithMappedBills = remapDebtBillIds(draft.debts, billIdMap) as Debt[];
  const diff = computeEntityDiff(committed.debts, debtsWithMappedBills, debtEquals);
  const result = await persistEntityDiff(diff, {
    isDraftId,
    toCreateInput: toDebtInput,
    toUpdateInput: toDebtInput,
    create: (input) => window.electronAPI.debts.create(input),
    update: (id, input) => window.electronAPI.debts.update(id, input),
    remove: (id) => window.electronAPI.debts.delete(id),
  });

  if (!result.success) {
    return { success: false, error: result.error, nextDraft: draft, nextCommitted: committed };
  }

  const idMap = result.idMap ?? new Map<string, string>();
  const nextDebts = applyIdMap(debtsWithMappedBills, idMap);
  const nextDraft = { ...draft, debts: nextDebts };
  const nextCommitted = { ...committed, debts: structuredClone(nextDebts) };

  return { success: true, nextDraft, nextCommitted };
}

export async function persistGoalsDomain(
  committed: DraftState,
  draft: DraftState
): Promise<{ success: boolean; error?: string; nextDraft: DraftState; nextCommitted: DraftState }> {
  const diff = computeEntityDiff(committed.goals, draft.goals, goalEquals);
  const result = await persistEntityDiff(diff, {
    isDraftId,
    toCreateInput: toGoalInput,
    toUpdateInput: toGoalInput,
    create: (input) => window.electronAPI.goals.create(input),
    update: (id, input) => window.electronAPI.goals.update(id, input),
    remove: (id) => window.electronAPI.goals.delete(id),
  });

  if (!result.success) {
    return { success: false, error: result.error, nextDraft: draft, nextCommitted: committed };
  }

  const idMap = result.idMap ?? new Map<string, string>();
  const nextGoals = applyIdMap(draft.goals, idMap);
  const nextDraft = { ...draft, goals: nextGoals };
  const nextCommitted = { ...committed, goals: structuredClone(nextGoals) };

  return { success: true, nextDraft, nextCommitted };
}

export async function persistScheduleDomain(
  committed: DraftState,
  draft: DraftState,
  idMaps: { income: Map<string, string>; bill: Map<string, string> }
): Promise<{ success: boolean; error?: string; nextDraft: DraftState; nextCommitted: DraftState }> {
  const mapIncomeId = (id: string) => idMaps.income.get(id) ?? id;
  const mapBillId = (id: string) => idMaps.bill.get(id) ?? id;

  const mapSkipped = (items: SkippedBill[]) =>
    items.map((item) => ({
      ...item,
      billId: mapBillId(item.billId),
    }));

  const mapAssignments = (items: BillAssignment[]) =>
    items.map((item) => ({
      ...item,
      billId: mapBillId(item.billId),
    }));

  const mapOverrides = (items: IncomeOverride[]) =>
    items.map((item) => ({
      ...item,
      incomeId: mapIncomeId(item.incomeId),
    }));

  const draftSkipped = mapSkipped(draft.skippedBills);
  const draftAssignments = mapAssignments(draft.billAssignments);
  const draftOverrides = mapOverrides(draft.incomeOverrides);
  const committedSkipped = mapSkipped(committed.skippedBills);
  const committedAssignments = mapAssignments(committed.billAssignments);
  const committedOverrides = mapOverrides(committed.incomeOverrides);

  const skippedDiff = computeKeyedDiff(
    committedSkipped,
    draftSkipped,
    (item) => `${item.billId}-${item.skipDate}`,
    (a, b) => a.billId === b.billId && a.skipDate === b.skipDate
  );

  for (const item of skippedDiff.removed) {
    const result = await window.electronAPI.skippedBills.unskip(item.billId, item.skipDate);
    if (!result.success) {
      return { success: false, error: result.error || 'Failed to unskip bill', nextDraft: draft, nextCommitted: committed };
    }
  }

  for (const item of skippedDiff.added) {
    const result = await window.electronAPI.skippedBills.skip(item.billId, item.skipDate);
    if (!result.success) {
      return { success: false, error: result.error || 'Failed to skip bill', nextDraft: draft, nextCommitted: committed };
    }
  }

  const assignmentDiff = computeKeyedDiff(
    committedAssignments,
    draftAssignments,
    (item) => `${item.billId}-${item.billDueDate}`,
    (a, b) => a.billId === b.billId && a.billDueDate === b.billDueDate && a.paycheckDate === b.paycheckDate
  );

  for (const item of assignmentDiff.removed) {
    const result = await window.electronAPI.billAssignments.remove(item.billId, item.billDueDate);
    if (!result.success) {
      return { success: false, error: result.error || 'Failed to remove assignment', nextDraft: draft, nextCommitted: committed };
    }
  }

  for (const item of [...assignmentDiff.added, ...assignmentDiff.changed]) {
    const result = await window.electronAPI.billAssignments.assign(
      item.billId,
      item.billDueDate,
      item.paycheckDate
    );
    if (!result.success) {
      return { success: false, error: result.error || 'Failed to assign bill', nextDraft: draft, nextCommitted: committed };
    }
  }

  const overrideDiff = computeKeyedDiff(
    committedOverrides,
    draftOverrides,
    (item) => `${item.incomeId}-${item.paycheckDate}`,
    (a, b) => a.incomeId === b.incomeId && a.paycheckDate === b.paycheckDate && a.amount === b.amount
  );

  for (const item of overrideDiff.removed) {
    const result = await window.electronAPI.incomeOverrides.remove(item.incomeId, item.paycheckDate);
    if (!result.success) {
      return { success: false, error: result.error || 'Failed to remove income override', nextDraft: draft, nextCommitted: committed };
    }
  }

  for (const item of [...overrideDiff.added, ...overrideDiff.changed]) {
    const result = await window.electronAPI.incomeOverrides.set(
      item.incomeId,
      item.paycheckDate,
      item.amount
    );
    if (!result.success) {
      return { success: false, error: result.error || 'Failed to set income override', nextDraft: draft, nextCommitted: committed };
    }
  }

  const nextDraft = {
    ...draft,
    skippedBills: draftSkipped,
    billAssignments: draftAssignments,
    incomeOverrides: draftOverrides,
  };
  const nextCommitted = {
    ...committed,
    skippedBills: structuredClone(draftSkipped),
    billAssignments: structuredClone(draftAssignments),
    incomeOverrides: structuredClone(draftOverrides),
  };

  return { success: true, nextDraft, nextCommitted };
}

export async function persistBudgetDomain(
  committed: DraftState,
  draft: DraftState,
  budgetId: string
): Promise<{ success: boolean; error?: string; nextDraft: DraftState; nextCommitted: DraftState }> {
  if (!draft.budget || !committed.budget) {
    return { success: true, nextDraft: draft, nextCommitted: committed };
  }

  if (budgetEquals(committed.budget, draft.budget)) {
    return { success: true, nextDraft: draft, nextCommitted: committed };
  }

  const result = await window.electronAPI.budget.update(budgetId, {
    name: draft.budget.name,
    startingBalance: draft.budget.startingBalance,
    targetCashOnHand: draft.budget.targetCashOnHand,
    minCashOnHand: draft.budget.minCashOnHand,
    minSavingsPerPaycheck: draft.budget.minSavingsPerPaycheck,
  });

  if (!result.success) {
    return { success: false, error: result.error || 'Failed to update budget', nextDraft: draft, nextCommitted: committed };
  }

  const nextCommitted = { ...committed, budget: structuredClone(draft.budget) };
  return { success: true, nextDraft: draft, nextCommitted };
}

const SAVE_ORDER: DraftDomain[] = ['income', 'bills', 'debts', 'goals', 'schedule', 'budget'];

export async function persistDomains(
  committed: DraftState,
  draft: DraftState,
  domains: DraftDomain[],
  budgetId: string | null
): Promise<{ success: boolean; error?: string; nextDraft: DraftState; nextCommitted: DraftState }> {
  let nextDraft = draft;
  let nextCommitted = committed;
  const incomeIdMap = new Map<string, string>();
  const billIdMap = new Map<string, string>();

  const orderedDomains = SAVE_ORDER.filter((domain) => domains.includes(domain));

  for (const domain of orderedDomains) {
    if (domain === 'income') {
      const result = await persistIncomeDomain(nextCommitted, nextDraft);
      if (!result.success) return result;
      nextDraft = result.nextDraft;
      nextCommitted = result.nextCommitted;
      result.idMap.forEach((value, key) => incomeIdMap.set(key, value));
    } else if (domain === 'bills') {
      const result = await persistBillsDomain(nextCommitted, nextDraft, incomeIdMap);
      if (!result.success) return result;
      nextDraft = result.nextDraft;
      nextCommitted = result.nextCommitted;
      result.idMap.forEach((value, key) => billIdMap.set(key, value));
    } else if (domain === 'debts') {
      const result = await persistDebtsDomain(nextCommitted, nextDraft, billIdMap);
      if (!result.success) return result;
      nextDraft = result.nextDraft;
      nextCommitted = result.nextCommitted;
    } else if (domain === 'goals') {
      const result = await persistGoalsDomain(nextCommitted, nextDraft);
      if (!result.success) return result;
      nextDraft = result.nextDraft;
      nextCommitted = result.nextCommitted;
    } else if (domain === 'schedule') {
      const result = await persistScheduleDomain(nextCommitted, nextDraft, {
        income: incomeIdMap,
        bill: billIdMap,
      });
      if (!result.success) return result;
      nextDraft = result.nextDraft;
      nextCommitted = result.nextCommitted;
    } else if (domain === 'budget') {
      if (!budgetId) continue;
      const result = await persistBudgetDomain(nextCommitted, nextDraft, budgetId);
      if (!result.success) return result;
      nextDraft = result.nextDraft;
      nextCommitted = result.nextCommitted;
    }
  }

  return { success: true, nextDraft, nextCommitted };
}

export function computeDirtyDomains(committed: DraftState, draft: DraftState): Set<DraftDomain> {
  const dirty = new Set<DraftDomain>();

  if (computeEntityDiff(committed.incomes, draft.incomes, incomeEquals).created.length > 0 ||
      computeEntityDiff(committed.incomes, draft.incomes, incomeEquals).updated.length > 0 ||
      computeEntityDiff(committed.incomes, draft.incomes, incomeEquals).deleted.length > 0) {
    dirty.add('income');
  }

  if (computeEntityDiff(committed.bills, draft.bills, billEquals).created.length > 0 ||
      computeEntityDiff(committed.bills, draft.bills, billEquals).updated.length > 0 ||
      computeEntityDiff(committed.bills, draft.bills, billEquals).deleted.length > 0) {
    dirty.add('bills');
  }

  if (computeEntityDiff(committed.debts, draft.debts, debtEquals).created.length > 0 ||
      computeEntityDiff(committed.debts, draft.debts, debtEquals).updated.length > 0 ||
      computeEntityDiff(committed.debts, draft.debts, debtEquals).deleted.length > 0) {
    dirty.add('debts');
  }

  if (computeEntityDiff(committed.goals, draft.goals, goalEquals).created.length > 0 ||
      computeEntityDiff(committed.goals, draft.goals, goalEquals).updated.length > 0 ||
      computeEntityDiff(committed.goals, draft.goals, goalEquals).deleted.length > 0) {
    dirty.add('goals');
  }

  const skippedDiff = computeKeyedDiff(
    committed.skippedBills,
    draft.skippedBills,
    (item) => `${item.billId}-${item.skipDate}`,
    (a, b) => a.billId === b.billId && a.skipDate === b.skipDate
  );
  const assignmentDiff = computeKeyedDiff(
    committed.billAssignments,
    draft.billAssignments,
    (item) => `${item.billId}-${item.billDueDate}`,
    (a, b) => a.billId === b.billId && a.billDueDate === b.billDueDate && a.paycheckDate === b.paycheckDate
  );
  const overrideDiff = computeKeyedDiff(
    committed.incomeOverrides,
    draft.incomeOverrides,
    (item) => `${item.incomeId}-${item.paycheckDate}`,
    (a, b) => a.incomeId === b.incomeId && a.paycheckDate === b.paycheckDate && a.amount === b.amount
  );

  if (
    skippedDiff.added.length > 0 ||
    skippedDiff.removed.length > 0 ||
    assignmentDiff.added.length > 0 ||
    assignmentDiff.removed.length > 0 ||
    assignmentDiff.changed.length > 0 ||
    overrideDiff.added.length > 0 ||
    overrideDiff.removed.length > 0 ||
    overrideDiff.changed.length > 0
  ) {
    dirty.add('schedule');
  }

  if (committed.budget && draft.budget && !budgetEquals(committed.budget, draft.budget)) {
    dirty.add('budget');
  }

  return dirty;
}
