import { DatabaseService, Budget, BudgetInput, BudgetSnapshot, Income, Bill, SkippedBill, BillAssignment, IncomeOverride, SavingsGoal, SavingsGoalInput } from './database.service';
import { QuickBudgetService } from './quick-budget.service';
import { budgetLogger as logger } from './logger.service';

export class BudgetManager {
  private currentBudgetId: string | null = null;
  private currentBudget: Budget | null = null;
  private isQuickBudgetMode: boolean = false;
  private quickBudgetService: QuickBudgetService;
  private database: DatabaseService;

  constructor(database: DatabaseService) {
    this.database = database;
    this.quickBudgetService = new QuickBudgetService();
  }

  // Budget State Management
  getCurrentBudgetId(): string | null {
    return this.isQuickBudgetMode ? null : this.currentBudgetId;
  }

  isQuickBudget(): boolean {
    return this.isQuickBudgetMode;
  }

  getCurrentState(): { budgetId: string | null; isQuickBudget: boolean } {
    return {
      budgetId: this.currentBudgetId,
      isQuickBudget: this.isQuickBudgetMode,
    };
  }

  setCurrentBudget(id: string): Budget | null {
    const budget = this.database.getBudgetById(id);
    if (!budget) {
      logger.warn('Attempted to switch to non-existent budget', { id });
      return null;
    }

    this.currentBudgetId = id;
    this.currentBudget = budget;
    this.isQuickBudgetMode = false;
    this.quickBudgetService.clear();
    
    logger.info('Switched to budget', { id, name: budget.name });
    return budget;
  }

  startQuickBudget(): void {
    this.isQuickBudgetMode = true;
    this.currentBudget = null;
    this.quickBudgetService.clear();
    logger.info('Started Quick Budget mode');
  }

  endQuickBudget(): void {
    this.isQuickBudgetMode = false;
    this.currentBudget = null;
    this.quickBudgetService.clear();
    logger.info('Ended Quick Budget mode');
  }

  /**
   * Returns the current budget record, reusing the cached copy when it matches
   * the active budget id. Collapses the repeated getBudgetById reads the
   * settings getters would otherwise each perform per schedule build.
   */
  private getCurrentBudgetRecord(): Budget | null {
    if (!this.currentBudgetId) {
      return null;
    }
    if (!this.currentBudget || this.currentBudget.id !== this.currentBudgetId) {
      this.currentBudget = this.database.getBudgetById(this.currentBudgetId);
    }
    return this.currentBudget;
  }

  // Budget CRUD (always goes to database)
  getAllBudgets(): Budget[] {
    return this.database.getAllBudgets();
  }

  getBudgetById(id: string): Budget | null {
    return this.database.getBudgetById(id);
  }

  createBudget(input: BudgetInput): Budget {
    return this.database.createBudget(input);
  }

  updateBudget(id: string, input: Partial<BudgetInput>): Budget | null {
    const updated = this.database.updateBudget(id, input);
    if (id === this.currentBudgetId) {
      this.currentBudget = updated;
    }
    return updated;
  }

  deleteBudget(id: string): boolean {
    // Cannot delete current budget
    if (id === this.currentBudgetId) {
      logger.warn('Cannot delete current budget', { id });
      return false;
    }
    return this.database.deleteBudget(id);
  }

  getBudgetStats(budgetId: string): { incomeCount: number; billCount: number } {
    return this.database.getBudgetStats(budgetId);
  }

  getAllBudgetsWithStats(): Array<Budget & { incomeCount: number; billCount: number }> {
    return this.database.getAllBudgetsWithStats();
  }

  // Starting Balance (routes to quick budget or current budget)
  getStartingBalance(): number {
    if (this.isQuickBudgetMode) {
      return this.quickBudgetService.getStartingBalance();
    }
    return this.getCurrentBudgetRecord()?.startingBalance ?? 0;
  }

  setStartingBalance(balance: number): void {
    if (this.isQuickBudgetMode) {
      this.quickBudgetService.setStartingBalance(balance);
    } else if (this.currentBudgetId) {
      this.currentBudget = this.database.updateBudget(this.currentBudgetId, { startingBalance: balance });
    }
  }

  // Target Cash on Hand (routes to quick budget or current budget)
  getTargetCashOnHand(): number {
    if (this.isQuickBudgetMode) {
      return this.quickBudgetService.getTargetCashOnHand();
    }
    return this.getCurrentBudgetRecord()?.targetCashOnHand ?? 250;
  }

  setTargetCashOnHand(amount: number): void {
    if (this.isQuickBudgetMode) {
      this.quickBudgetService.setTargetCashOnHand(amount);
    } else if (this.currentBudgetId) {
      this.currentBudget = this.database.updateBudget(this.currentBudgetId, { targetCashOnHand: amount });
    }
  }

  // Minimum Cash on Hand (routes to quick budget or current budget)
  getMinCashOnHand(): number {
    if (this.isQuickBudgetMode) {
      return this.quickBudgetService.getMinCashOnHand();
    }
    return this.getCurrentBudgetRecord()?.minCashOnHand ?? 100;
  }

  setMinCashOnHand(amount: number): void {
    if (this.isQuickBudgetMode) {
      this.quickBudgetService.setMinCashOnHand(amount);
    } else if (this.currentBudgetId) {
      this.currentBudget = this.database.updateBudget(this.currentBudgetId, { minCashOnHand: amount });
    }
  }

  // Minimum Savings Per Paycheck (routes to quick budget or current budget)
  getMinSavingsPerPaycheck(): number {
    if (this.isQuickBudgetMode) {
      return this.quickBudgetService.getMinSavingsPerPaycheck();
    }
    return this.getCurrentBudgetRecord()?.minSavingsPerPaycheck ?? 0;
  }

  setMinSavingsPerPaycheck(amount: number): void {
    if (this.isQuickBudgetMode) {
      this.quickBudgetService.setMinSavingsPerPaycheck(amount);
    } else if (this.currentBudgetId) {
      this.currentBudget = this.database.updateBudget(this.currentBudgetId, { minSavingsPerPaycheck: amount });
    }
  }

  getScheduleStartDate(): string {
    if (this.isQuickBudgetMode) {
      return this.quickBudgetService.getScheduleStartDate();
    }
    const budget = this.getCurrentBudgetRecord();
    if (!budget) {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    }
    return budget.scheduleStartDate ?? `${budget.createdAt.slice(0, 7)}-01`;
  }

  // Income Operations (routed based on mode)
  getAllIncomes(): Income[] {
    if (this.isQuickBudgetMode) {
      return this.quickBudgetService.getAllIncomes();
    }
    if (!this.currentBudgetId) return [];
    return this.database.getAllIncomes(this.currentBudgetId);
  }

  getIncomeById(id: string): Income | null {
    if (this.isQuickBudgetMode) {
      return this.quickBudgetService.getIncomeById(id);
    }
    if (!this.currentBudgetId) return null;
    return this.database.getIncomeById(id, this.currentBudgetId);
  }

  createIncome(income: Omit<Income, 'id' | 'createdAt' | 'updatedAt'>): Income {
    if (this.isQuickBudgetMode) {
      return this.quickBudgetService.createIncome(income);
    }
    if (!this.currentBudgetId) {
      throw new Error('No budget selected');
    }
    return this.database.createIncome(this.currentBudgetId, income);
  }

  updateIncome(id: string, income: Omit<Income, 'id' | 'createdAt' | 'updatedAt'>): Income | null {
    if (this.isQuickBudgetMode) {
      return this.quickBudgetService.updateIncome(id, income);
    }
    if (!this.currentBudgetId) return null;
    return this.database.updateIncome(id, this.currentBudgetId, income);
  }

  deleteIncome(id: string): boolean {
    if (this.isQuickBudgetMode) {
      return this.quickBudgetService.deleteIncome(id);
    }
    if (!this.currentBudgetId) return false;
    return this.database.deleteIncome(id, this.currentBudgetId);
  }

  // Bill Operations (routed based on mode)
  getAllBills(): Bill[] {
    if (this.isQuickBudgetMode) {
      return this.quickBudgetService.getAllBills();
    }
    if (!this.currentBudgetId) return [];
    return this.database.getAllBills(this.currentBudgetId);
  }

  getBillById(id: string): Bill | null {
    if (this.isQuickBudgetMode) {
      return this.quickBudgetService.getBillById(id);
    }
    if (!this.currentBudgetId) return null;
    return this.database.getBillById(id, this.currentBudgetId);
  }

  createBill(bill: Omit<Bill, 'id' | 'createdAt' | 'updatedAt'>): Bill {
    if (this.isQuickBudgetMode) {
      return this.quickBudgetService.createBill(bill);
    }
    if (!this.currentBudgetId) {
      throw new Error('No budget selected');
    }
    return this.database.createBillEntry(this.currentBudgetId, bill);
  }

  updateBill(id: string, bill: Omit<Bill, 'id' | 'createdAt' | 'updatedAt'>): Bill | null {
    if (this.isQuickBudgetMode) {
      return this.quickBudgetService.updateBill(id, bill);
    }
    if (!this.currentBudgetId) return null;
    return this.database.updateBillEntry(id, this.currentBudgetId, bill);
  }

  deleteBill(id: string): boolean {
    if (this.isQuickBudgetMode) {
      return this.quickBudgetService.deleteBill(id);
    }
    if (!this.currentBudgetId) return false;
    return this.database.deleteBillEntry(id, this.currentBudgetId);
  }

  // Skipped Bills Operations (routed based on mode)
  getSkippedBills(): SkippedBill[] {
    if (this.isQuickBudgetMode) {
      return this.quickBudgetService.getSkippedBills();
    }
    if (!this.currentBudgetId) return [];
    return this.database.getSkippedBills(this.currentBudgetId);
  }

  skipBill(billId: string, skipDate: string): SkippedBill {
    if (this.isQuickBudgetMode) {
      return this.quickBudgetService.skipBill(billId, skipDate);
    }
    if (!this.currentBudgetId) {
      throw new Error('No budget selected');
    }
    return this.database.skipBill(this.currentBudgetId, billId, skipDate);
  }

  unskipBill(billId: string, skipDate: string): boolean {
    if (this.isQuickBudgetMode) {
      return this.quickBudgetService.unskipBill(billId, skipDate);
    }
    if (!this.currentBudgetId) return false;
    return this.database.unskipBill(this.currentBudgetId, billId, skipDate);
  }

  isSkipped(billId: string, skipDate: string): boolean {
    if (this.isQuickBudgetMode) {
      return this.quickBudgetService.isSkipped(billId, skipDate);
    }
    if (!this.currentBudgetId) return false;
    return this.database.isSkipped(this.currentBudgetId, billId, skipDate);
  }

  // Bill Assignments Operations (routed based on mode)
  getBillAssignments(): BillAssignment[] {
    if (this.isQuickBudgetMode) {
      return this.quickBudgetService.getBillAssignments();
    }
    if (!this.currentBudgetId) return [];
    return this.database.getBillAssignments(this.currentBudgetId);
  }

  assignBillToPaycheck(billId: string, billDueDate: string, paycheckDate: string): BillAssignment {
    if (this.isQuickBudgetMode) {
      return this.quickBudgetService.assignBillToPaycheck(billId, billDueDate, paycheckDate);
    }
    if (!this.currentBudgetId) {
      throw new Error('No budget selected');
    }
    return this.database.assignBillToPaycheck(this.currentBudgetId, billId, billDueDate, paycheckDate);
  }

  removeBillAssignment(billId: string, billDueDate: string): boolean {
    if (this.isQuickBudgetMode) {
      return this.quickBudgetService.removeBillAssignment(billId, billDueDate);
    }
    if (!this.currentBudgetId) return false;
    return this.database.removeBillAssignment(this.currentBudgetId, billId, billDueDate);
  }

  getBillAssignment(billId: string, billDueDate: string): BillAssignment | null {
    if (this.isQuickBudgetMode) {
      return this.quickBudgetService.getBillAssignment(billId, billDueDate);
    }
    if (!this.currentBudgetId) return null;
    return this.database.getBillAssignment(this.currentBudgetId, billId, billDueDate);
  }

  getIncomeOverrides(): IncomeOverride[] {
    if (this.isQuickBudgetMode) {
      return this.quickBudgetService.getIncomeOverrides();
    }
    if (!this.currentBudgetId) return [];
    return this.database.getIncomeOverrides(this.currentBudgetId);
  }

  setIncomeOverride(incomeId: string, paycheckDate: string, amount: number): IncomeOverride {
    if (this.isQuickBudgetMode) {
      return this.quickBudgetService.setIncomeOverride(incomeId, paycheckDate, amount);
    }
    if (!this.currentBudgetId) {
      throw new Error('No budget selected');
    }
    return this.database.setIncomeOverride(this.currentBudgetId, incomeId, paycheckDate, amount);
  }

  removeIncomeOverride(incomeId: string, paycheckDate: string): boolean {
    if (this.isQuickBudgetMode) {
      return this.quickBudgetService.removeIncomeOverride(incomeId, paycheckDate);
    }
    if (!this.currentBudgetId) return false;
    return this.database.removeIncomeOverride(this.currentBudgetId, incomeId, paycheckDate);
  }

  // Savings Goals Operations (routed based on mode)
  getAllGoals(): SavingsGoal[] {
    if (this.isQuickBudgetMode) {
      return this.quickBudgetService.getAllGoals();
    }
    if (!this.currentBudgetId) return [];
    return this.database.getAllGoals(this.currentBudgetId);
  }

  getGoalById(id: string): SavingsGoal | null {
    if (this.isQuickBudgetMode) {
      return this.quickBudgetService.getGoalById(id);
    }
    if (!this.currentBudgetId) return null;
    return this.database.getGoalById(id, this.currentBudgetId);
  }

  createGoal(input: SavingsGoalInput): SavingsGoal {
    if (this.isQuickBudgetMode) {
      return this.quickBudgetService.createGoal(input);
    }
    if (!this.currentBudgetId) {
      throw new Error('No budget selected');
    }
    return this.database.createGoal(this.currentBudgetId, input);
  }

  updateGoal(id: string, input: Partial<SavingsGoalInput>): SavingsGoal | null {
    if (this.isQuickBudgetMode) {
      return this.quickBudgetService.updateGoal(id, input);
    }
    if (!this.currentBudgetId) return null;
    return this.database.updateGoal(id, this.currentBudgetId, input);
  }

  deleteGoal(id: string): boolean {
    if (this.isQuickBudgetMode) {
      return this.quickBudgetService.deleteGoal(id);
    }
    if (!this.currentBudgetId) return false;
    return this.database.deleteGoal(id, this.currentBudgetId);
  }

  getBudgetSnapshot(): BudgetSnapshot {
    if (this.isQuickBudgetMode) {
      return {
        incomes: this.quickBudgetService.getAllIncomes(),
        bills: this.quickBudgetService.getAllBills(),
        goals: this.quickBudgetService.getAllGoals(),
        skippedBills: this.quickBudgetService.getSkippedBills(),
        billAssignments: this.quickBudgetService.getBillAssignments(),
        incomeOverrides: this.quickBudgetService.getIncomeOverrides(),
        debts: [],
        budget: null,
      };
    }

    if (!this.currentBudgetId) {
      return {
        incomes: [],
        bills: [],
        goals: [],
        skippedBills: [],
        billAssignments: [],
        incomeOverrides: [],
        debts: [],
        budget: null,
      };
    }

    return this.database.getBudgetSnapshot(this.currentBudgetId);
  }
}
