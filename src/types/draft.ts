import {
  Bill,
  BillAssignment,
  Budget,
  Debt,
  Income,
  IncomeOverride,
  SavingsGoal,
  SkippedBill,
} from './index';

export type DraftDomain = 'income' | 'bills' | 'debts' | 'goals' | 'schedule' | 'budget';

export interface DraftBudgetFields {
  name: string;
  startingBalance: number;
  targetCashOnHand: number;
  minCashOnHand: number;
  minSavingsPerPaycheck: number;
}

export interface DraftState {
  incomes: Income[];
  bills: Bill[];
  debts: Debt[];
  goals: SavingsGoal[];
  skippedBills: SkippedBill[];
  billAssignments: BillAssignment[];
  incomeOverrides: IncomeOverride[];
  budget: DraftBudgetFields | null;
}

export interface DraftOverlay {
  incomes?: Income[];
  bills?: Bill[];
  goals?: SavingsGoal[];
  debts?: Debt[];
  skippedBills?: SkippedBill[];
  billAssignments?: BillAssignment[];
  incomeOverrides?: IncomeOverride[];
  startingBalance?: number;
  targetCashOnHand?: number;
  minCashOnHand?: number;
  minSavingsPerPaycheck?: number;
}

export const DRAFT_DOMAIN_LABELS: Record<DraftDomain, string> = {
  income: 'Income',
  bills: 'Bills',
  debts: 'Debts',
  goals: 'Goals',
  schedule: 'Schedule',
  budget: 'Budget',
};

export const ROUTE_DRAFT_DOMAIN: Record<string, DraftDomain | undefined> = {
  '/income': 'income',
  '/bills': 'bills',
  '/debts': 'debts',
  '/goals': 'goals',
  '/schedule': 'schedule',
  '/budgets': 'budget',
  '/settings': 'budget',
};

export const DOMAIN_ROUTES: Record<DraftDomain, string> = {
  income: '/income',
  bills: '/bills',
  debts: '/debts',
  goals: '/goals',
  schedule: '/schedule',
  budget: '/budgets',
};

export function isDraftId(id: string): boolean {
  return id.startsWith('draft-');
}

export function createDraftId(): string {
  return `draft-${crypto.randomUUID()}`;
}

export function budgetToDraftFields(budget: Budget): DraftBudgetFields {
  return {
    name: budget.name,
    startingBalance: budget.startingBalance,
    targetCashOnHand: budget.targetCashOnHand,
    minCashOnHand: budget.minCashOnHand,
    minSavingsPerPaycheck: budget.minSavingsPerPaycheck,
  };
}

export function createEmptyDraftState(): DraftState {
  return {
    incomes: [],
    bills: [],
    debts: [],
    goals: [],
    skippedBills: [],
    billAssignments: [],
    incomeOverrides: [],
    budget: null,
  };
}
