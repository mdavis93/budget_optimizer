import {
  Bill,
  BillAssignment,
  Debt,
  Income,
  IncomeOverride,
  Leave,
  SavingsGoal,
  SkippedBill,
} from '../types';
import { DraftBudgetFields, DraftState } from '../types/draft';
import { buildScheduleIdentity, type ScheduleIdentityInput } from '@shared/scheduleIdentity';

export function buildScheduleOverlayHash(params: {
  skippedBills: SkippedBill[];
  billAssignments: BillAssignment[];
  incomeOverrides: IncomeOverride[];
}): string {
  return buildScheduleIdentity({
    incomes: [],
    bills: [],
    skippedBills: params.skippedBills,
    billAssignments: params.billAssignments,
    incomeOverrides: params.incomeOverrides,
    startDate: '',
    startingBalance: 0,
    now: new Date(0),
  });
}

export function buildScheduleEntityHash(
  incomes: Income[],
  bills: Bill[],
  leaves: Leave[] = []
): string {
  return buildScheduleIdentity({
    incomes,
    bills,
    leaves,
    skippedBills: [],
    billAssignments: [],
    incomeOverrides: [],
    startDate: '',
    startingBalance: 0,
    now: new Date(0),
  });
}

export function buildBudgetFieldsHash(budgetFields: DraftBudgetFields | null | undefined): string {
  if (!budgetFields) {
    return '';
  }
  return buildScheduleIdentity({
    incomes: [],
    bills: [],
    skippedBills: [],
    billAssignments: [],
    incomeOverrides: [],
    startDate: budgetFields.scheduleStartDate,
    startingBalance: budgetFields.startingBalance,
    targetCashOnHand: budgetFields.targetCashOnHand,
    minCashOnHand: budgetFields.minCashOnHand,
    minSavingsPerPaycheck: budgetFields.minSavingsPerPaycheck,
    now: new Date(0),
  });
}

export function toScheduleIdentityInput(params: {
  incomes: Income[];
  bills: Bill[];
  goals?: SavingsGoal[];
  debts?: Debt[];
  skippedBills: SkippedBill[];
  billAssignments: BillAssignment[];
  preferredAssignments?: Array<[string, string]>;
  incomeOverrides: IncomeOverride[];
  leaves?: Leave[];
  startDate?: string;
  startingBalance?: number;
  targetCashOnHand?: number | null;
  minCashOnHand?: number | null;
  minSavingsPerPaycheck?: number | null;
  budgetFields?: DraftBudgetFields | null;
  now?: Date;
}): ScheduleIdentityInput {
  const budget = params.budgetFields;
  return {
    incomes: params.incomes,
    bills: params.bills,
    goals: params.goals,
    debts: params.debts,
    leaves: params.leaves,
    skippedBills: params.skippedBills,
    billAssignments: params.billAssignments,
    preferredAssignments: params.preferredAssignments,
    incomeOverrides: params.incomeOverrides,
    startDate: params.startDate || budget?.scheduleStartDate || '',
    startingBalance: params.startingBalance ?? budget?.startingBalance ?? 0,
    targetCashOnHand: params.targetCashOnHand ?? budget?.targetCashOnHand,
    minCashOnHand: params.minCashOnHand ?? budget?.minCashOnHand,
    minSavingsPerPaycheck: params.minSavingsPerPaycheck ?? budget?.minSavingsPerPaycheck,
    now: params.now,
  };
}

export function buildScheduleInputHashFromDraft(
  draft: DraftState,
  options: {
    startDate: string;
    startingBalance: number;
    preferredAssignments?: Array<[string, string]>;
    targetCashOnHand?: number | null;
    minCashOnHand?: number | null;
    minSavingsPerPaycheck?: number | null;
    now?: Date;
  }
): string {
  return buildScheduleIdentity(
    toScheduleIdentityInput({
      incomes: draft.incomes,
      bills: draft.bills,
      goals: draft.goals,
      debts: draft.debts,
      leaves: draft.leaves,
      skippedBills: draft.skippedBills,
      billAssignments: draft.billAssignments,
      preferredAssignments: options.preferredAssignments,
      incomeOverrides: draft.incomeOverrides,
      startDate: options.startDate,
      startingBalance: options.startingBalance,
      targetCashOnHand: options.targetCashOnHand ?? draft.budget?.targetCashOnHand,
      minCashOnHand: options.minCashOnHand ?? draft.budget?.minCashOnHand,
      minSavingsPerPaycheck: options.minSavingsPerPaycheck ?? draft.budget?.minSavingsPerPaycheck,
      now: options.now,
    })
  );
}

export function buildScheduleInputHash(params: {
  incomes: Income[];
  bills: Bill[];
  goals?: SavingsGoal[];
  debts?: Debt[];
  skippedBills: SkippedBill[];
  billAssignments: BillAssignment[];
  preferredAssignments?: Array<[string, string]>;
  incomeOverrides: IncomeOverride[];
  leaves?: Leave[];
  startDate?: string;
  startingBalance?: number;
  budgetFields?: DraftBudgetFields | null;
  now?: Date;
}): string {
  return buildScheduleIdentity(toScheduleIdentityInput(params));
}
