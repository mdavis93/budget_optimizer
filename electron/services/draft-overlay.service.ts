import {
  Bill,
  BillAssignment,
  Debt,
  Income,
  IncomeOverride,
  Leave,
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
  leaves?: Leave[];
  skippedBills?: SkippedBill[];
  billAssignments?: BillAssignment[];
  preferredAssignments?: Array<[string, string]>;
  incomeOverrides?: IncomeOverride[];
  startingBalance?: number;
  targetCashOnHand?: number;
  minCashOnHand?: number;
  minSavingsPerPaycheck?: number;
  scheduleStartDate?: string;
}

export interface ResolvedScheduleInputs {
  incomes: Income[];
  bills: Bill[];
  goals: SavingsGoal[];
  debts: Debt[];
  leaves: Leave[];
  skippedBills: SkippedBill[];
  billAssignments: BillAssignment[];
  preferredAssignments: Map<string, string>;
  incomeOverrides: IncomeOverride[];
  startingBalance: number;
  targetCashOnHand: number;
  minCashOnHand: number;
  minSavingsPerPaycheck: number;
  scheduleStartDate: string;
}

export function resolveScheduleInputs(
  budgetManager: BudgetManager,
  _database: DatabaseService,
  overlay?: DraftOverlayInput | null
): ResolvedScheduleInputs {
  if (overlay) {
    const overlayValidation = validateDraftOverlay(overlay as Parameters<typeof validateDraftOverlay>[0]);
    assertValid(overlayValidation, 'Invalid draft overlay');
  }

  const incomes = overlay?.incomes ?? budgetManager.getAllIncomes();
  const bills = overlay?.bills ?? budgetManager.getAllBills();
  const goals = overlay?.goals ?? budgetManager.getAllGoals();
  const skippedBills = overlay?.skippedBills ?? budgetManager.getSkippedBills();
  const billAssignments = overlay?.billAssignments ?? budgetManager.getBillAssignments();
  const preferredAssignments = new Map(overlay?.preferredAssignments ?? []);
  const incomeOverrides = overlay?.incomeOverrides ?? budgetManager.getIncomeOverrides();

  const debts = overlay?.debts ?? budgetManager.getDebts();
  const leaves = overlay?.leaves ?? budgetManager.getLeaves();

  const startingBalance = overlay?.startingBalance ?? budgetManager.getStartingBalance();
  const targetCashOnHand = overlay?.targetCashOnHand ?? budgetManager.getTargetCashOnHand();
  const minCashOnHand = overlay?.minCashOnHand ?? budgetManager.getMinCashOnHand();
  const minSavingsPerPaycheck =
    overlay?.minSavingsPerPaycheck ?? budgetManager.getMinSavingsPerPaycheck();
  const scheduleStartDate = overlay?.scheduleStartDate ?? budgetManager.getScheduleStartDate();

  return {
    incomes,
    bills,
    goals,
    debts,
    leaves,
    skippedBills,
    billAssignments,
    preferredAssignments,
    incomeOverrides,
    startingBalance,
    targetCashOnHand,
    minCashOnHand,
    minSavingsPerPaycheck,
    scheduleStartDate,
  };
}
