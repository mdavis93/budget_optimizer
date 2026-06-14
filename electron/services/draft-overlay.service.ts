import {
  Bill,
  BillAssignment,
  Debt,
  Income,
  IncomeOverride,
  SavingsGoal,
  SkippedBill,
} from './database.service';
import { BudgetManager } from './budget-manager.service';
import { DatabaseService } from './database.service';
import { assertValid, validateDraftOverlay } from './validation.service';

export interface DraftOverlayInput {
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

export interface ResolvedScheduleInputs {
  incomes: Income[];
  bills: Bill[];
  goals: SavingsGoal[];
  debts: Debt[];
  skippedBills: SkippedBill[];
  billAssignments: BillAssignment[];
  incomeOverrides: IncomeOverride[];
  startingBalance: number;
  targetCashOnHand: number;
  minCashOnHand: number;
  minSavingsPerPaycheck: number;
}

export function resolveScheduleInputs(
  budgetManager: BudgetManager,
  database: DatabaseService,
  overlay?: DraftOverlayInput | null
): ResolvedScheduleInputs {
  if (overlay) {
    assertValid(validateDraftOverlay(overlay as Parameters<typeof validateDraftOverlay>[0]), 'Invalid draft overlay');
  }

  const state = budgetManager.getCurrentState();
  const incomes = overlay?.incomes ?? budgetManager.getAllIncomes();
  const bills = overlay?.bills ?? budgetManager.getAllBills();
  const goals = overlay?.goals ?? budgetManager.getAllGoals();
  const skippedBills = overlay?.skippedBills ?? budgetManager.getSkippedBills();
  const billAssignments = overlay?.billAssignments ?? budgetManager.getBillAssignments();
  const incomeOverrides = overlay?.incomeOverrides ?? budgetManager.getIncomeOverrides();

  let debts: Debt[] = [];
  if (overlay?.debts) {
    debts = overlay.debts;
  } else if (state.budgetId) {
    debts = database.getDebts(state.budgetId);
  }

  const startingBalance = overlay?.startingBalance ?? budgetManager.getStartingBalance();
  const targetCashOnHand = overlay?.targetCashOnHand ?? budgetManager.getTargetCashOnHand();
  const minCashOnHand = overlay?.minCashOnHand ?? budgetManager.getMinCashOnHand();
  const minSavingsPerPaycheck =
    overlay?.minSavingsPerPaycheck ?? budgetManager.getMinSavingsPerPaycheck();

  return {
    incomes,
    bills,
    goals,
    debts,
    skippedBills,
    billAssignments,
    incomeOverrides,
    startingBalance,
    targetCashOnHand,
    minCashOnHand,
    minSavingsPerPaycheck,
  };
}
