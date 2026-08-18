import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import {
  DatabaseService,
  Budget,
  BudgetInput,
  BudgetSnapshot,
  Income,
  Bill,
  SkippedBill,
  BillAssignment,
  IncomeOverride,
  SavingsGoal,
  SavingsGoalInput,
  Debt,
  DebtInput,
  Leave,
  LeaveInput,
} from './database.service';
import { budgetLogger as logger } from './logger.service';

export interface BudgetManagerOptions {
  createEphemeralDatabase?: (dbPath: string) => DatabaseService;
  resolveScratchDir?: () => string;
}

function unlinkEphemeralFiles(dbPath: string): void {
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.unlinkSync(dbPath + suffix);
    } catch {
      // Scratch files may already be gone after close().
    }
  }
  const scratchDir = path.dirname(dbPath);
  try {
    fs.rmdirSync(scratchDir);
  } catch {
    // Directory may still contain unrelated files.
  }
}

export class BudgetManager {
  private currentBudgetId: string | null = null;
  private currentBudget: Budget | null = null;
  private isQuickBudgetMode = false;
  private readonly vault: DatabaseService;
  private ephemeral: DatabaseService | null = null;
  private ephemeralDbPath: string | null = null;
  private readonly createEphemeralDatabase: (dbPath: string) => DatabaseService;
  private readonly resolveScratchDir: () => string;

  constructor(database: DatabaseService, options: BudgetManagerOptions = {}) {
    this.vault = database;
    this.createEphemeralDatabase =
      options.createEphemeralDatabase ??
      ((dbPath: string) => {
        const db = new DatabaseService(this.vault.getCryptoService(), dbPath);
        db.initialize();
        try {
          fs.chmodSync(dbPath, 0o600);
        } catch (error) {
          logger.warn('Failed to set ephemeral database permissions:', error);
        }
        return db;
      });
    this.resolveScratchDir =
      options.resolveScratchDir ??
      (() => path.join(app.getPath('userData'), 'quick-budget-scratch'));
  }

  private activeDb(): DatabaseService {
    return this.ephemeral ?? this.vault;
  }

  private requireBudgetId(): string {
    if (!this.currentBudgetId) {
      throw new Error('No budget selected');
    }
    return this.currentBudgetId;
  }

  getCurrentBudgetId(): string | null {
    return this.currentBudgetId;
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
    this.endQuickBudget();
    const budget = this.vault.getBudgetById(id);
    if (!budget) {
      logger.warn('Attempted to switch to non-existent budget', { id });
      return null;
    }

    this.currentBudgetId = id;
    this.currentBudget = budget;
    logger.info('Switched to budget', { id, name: budget.name });
    return budget;
  }

  startQuickBudget(): void {
    this.endQuickBudget();
    const scratchDir = this.resolveScratchDir();
    fs.mkdirSync(scratchDir, { recursive: true, mode: 0o700 });
    const dbPath = path.join(scratchDir, 'budget.db');
    const ephemeral = this.createEphemeralDatabase(dbPath);
    const budget = ephemeral.createBudget({ name: 'Quick Budget' });
    this.ephemeral = ephemeral;
    this.ephemeralDbPath = dbPath;
    this.currentBudgetId = budget.id;
    this.currentBudget = budget;
    this.isQuickBudgetMode = true;
    logger.info('Started Quick Budget mode', { budgetId: budget.id });
  }

  endQuickBudget(): void {
    if (!this.isQuickBudgetMode && !this.ephemeral) {
      return;
    }
    const dbPath = this.ephemeralDbPath;
    if (this.ephemeral) {
      this.ephemeral.close();
      this.ephemeral = null;
    }
    this.ephemeralDbPath = null;
    this.isQuickBudgetMode = false;
    this.currentBudgetId = null;
    this.currentBudget = null;
    if (dbPath) {
      unlinkEphemeralFiles(dbPath);
    }
    logger.info('Ended Quick Budget mode');
  }

  private getCurrentBudgetRecord(): Budget | null {
    if (!this.currentBudgetId) {
      return null;
    }
    if (!this.currentBudget || this.currentBudget.id !== this.currentBudgetId) {
      this.currentBudget = this.activeDb().getBudgetById(this.currentBudgetId);
    }
    return this.currentBudget;
  }

  getAllBudgets(): Budget[] {
    return this.vault.getAllBudgets();
  }

  getBudgetById(id: string): Budget | null {
    if (this.ephemeral && id === this.currentBudgetId) {
      return this.ephemeral.getBudgetById(id);
    }
    return this.vault.getBudgetById(id);
  }

  createBudget(input: BudgetInput): Budget {
    return this.vault.createBudget(input);
  }

  updateBudget(id: string, input: Partial<BudgetInput>): Budget | null {
    if (this.ephemeral && id === this.currentBudgetId) {
      const updated = this.ephemeral.updateBudget(id, input);
      this.currentBudget = updated;
      return updated;
    }
    const updated = this.vault.updateBudget(id, input);
    if (id === this.currentBudgetId) {
      this.currentBudget = updated;
    }
    return updated;
  }

  deleteBudget(id: string): boolean {
    if (id === this.currentBudgetId) {
      logger.warn('Cannot delete current budget', { id });
      return false;
    }
    return this.vault.deleteBudget(id);
  }

  getBudgetStats(budgetId: string): { incomeCount: number; billCount: number } {
    return this.vault.getBudgetStats(budgetId);
  }

  getAllBudgetsWithStats(): Array<Budget & { incomeCount: number; billCount: number }> {
    return this.vault.getAllBudgetsWithStats();
  }

  getStartingBalance(): number {
    return this.getCurrentBudgetRecord()?.startingBalance ?? 0;
  }

  setStartingBalance(balance: number): void {
    if (this.currentBudgetId) {
      this.currentBudget = this.activeDb().updateBudget(this.currentBudgetId, { startingBalance: balance });
    }
  }

  getTargetCashOnHand(): number {
    return this.getCurrentBudgetRecord()?.targetCashOnHand ?? 250;
  }

  setTargetCashOnHand(amount: number): void {
    if (this.currentBudgetId) {
      this.currentBudget = this.activeDb().updateBudget(this.currentBudgetId, { targetCashOnHand: amount });
    }
  }

  getMinCashOnHand(): number {
    return this.getCurrentBudgetRecord()?.minCashOnHand ?? 100;
  }

  setMinCashOnHand(amount: number): void {
    if (this.currentBudgetId) {
      this.currentBudget = this.activeDb().updateBudget(this.currentBudgetId, { minCashOnHand: amount });
    }
  }

  getMinSavingsPerPaycheck(): number {
    return this.getCurrentBudgetRecord()?.minSavingsPerPaycheck ?? 0;
  }

  setMinSavingsPerPaycheck(amount: number): void {
    if (this.currentBudgetId) {
      this.currentBudget = this.activeDb().updateBudget(this.currentBudgetId, { minSavingsPerPaycheck: amount });
    }
  }

  getScheduleStartDate(): string {
    const budget = this.getCurrentBudgetRecord();
    if (!budget) {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    }
    return budget.scheduleStartDate ?? `${budget.createdAt.slice(0, 7)}-01`;
  }

  getAllIncomes(): Income[] {
    if (!this.currentBudgetId) return [];
    return this.activeDb().getAllIncomes(this.currentBudgetId);
  }

  getIncomeById(id: string): Income | null {
    if (!this.currentBudgetId) return null;
    return this.activeDb().getIncomeById(id, this.currentBudgetId);
  }

  createIncome(income: Omit<Income, 'id' | 'createdAt' | 'updatedAt'>): Income {
    return this.activeDb().createIncome(this.requireBudgetId(), income);
  }

  updateIncome(id: string, income: Omit<Income, 'id' | 'createdAt' | 'updatedAt'>): Income | null {
    if (!this.currentBudgetId) return null;
    return this.activeDb().updateIncome(id, this.currentBudgetId, income);
  }

  deleteIncome(id: string): boolean {
    if (!this.currentBudgetId) return false;
    return this.activeDb().deleteIncome(id, this.currentBudgetId);
  }

  getAllBills(): Bill[] {
    if (!this.currentBudgetId) return [];
    return this.activeDb().getAllBills(this.currentBudgetId);
  }

  getBillById(id: string): Bill | null {
    if (!this.currentBudgetId) return null;
    return this.activeDb().getBillById(id, this.currentBudgetId);
  }

  createBill(bill: Omit<Bill, 'id' | 'createdAt' | 'updatedAt'>): Bill {
    return this.activeDb().createBillEntry(this.requireBudgetId(), bill);
  }

  updateBill(id: string, bill: Omit<Bill, 'id' | 'createdAt' | 'updatedAt'>): Bill | null {
    if (!this.currentBudgetId) return null;
    return this.activeDb().updateBillEntry(id, this.currentBudgetId, bill);
  }

  deleteBill(id: string): boolean {
    if (!this.currentBudgetId) return false;
    return this.activeDb().deleteBillEntry(id, this.currentBudgetId);
  }

  getSkippedBills(): SkippedBill[] {
    if (!this.currentBudgetId) return [];
    return this.activeDb().getSkippedBills(this.currentBudgetId);
  }

  skipBill(billId: string, skipDate: string): SkippedBill {
    return this.activeDb().skipBill(this.requireBudgetId(), billId, skipDate);
  }

  unskipBill(billId: string, skipDate: string): boolean {
    if (!this.currentBudgetId) return false;
    return this.activeDb().unskipBill(this.currentBudgetId, billId, skipDate);
  }

  isSkipped(billId: string, skipDate: string): boolean {
    if (!this.currentBudgetId) return false;
    return this.activeDb().isSkipped(this.currentBudgetId, billId, skipDate);
  }

  getBillAssignments(): BillAssignment[] {
    if (!this.currentBudgetId) return [];
    return this.activeDb().getBillAssignments(this.currentBudgetId);
  }

  assignBillToPaycheck(billId: string, billDueDate: string, paycheckDate: string): BillAssignment {
    return this.activeDb().assignBillToPaycheck(this.requireBudgetId(), billId, billDueDate, paycheckDate);
  }

  removeBillAssignment(billId: string, billDueDate: string): boolean {
    if (!this.currentBudgetId) return false;
    return this.activeDb().removeBillAssignment(this.currentBudgetId, billId, billDueDate);
  }

  getBillAssignment(billId: string, billDueDate: string): BillAssignment | null {
    if (!this.currentBudgetId) return null;
    return this.activeDb().getBillAssignment(this.currentBudgetId, billId, billDueDate);
  }

  getIncomeOverrides(): IncomeOverride[] {
    if (!this.currentBudgetId) return [];
    return this.activeDb().getIncomeOverrides(this.currentBudgetId);
  }

  setIncomeOverride(incomeId: string, paycheckDate: string, amount: number): IncomeOverride {
    return this.activeDb().setIncomeOverride(this.requireBudgetId(), incomeId, paycheckDate, amount);
  }

  removeIncomeOverride(incomeId: string, paycheckDate: string): boolean {
    if (!this.currentBudgetId) return false;
    return this.activeDb().removeIncomeOverride(this.currentBudgetId, incomeId, paycheckDate);
  }

  getAllGoals(): SavingsGoal[] {
    if (!this.currentBudgetId) return [];
    return this.activeDb().getAllGoals(this.currentBudgetId);
  }

  getGoalById(id: string): SavingsGoal | null {
    if (!this.currentBudgetId) return null;
    return this.activeDb().getGoalById(id, this.currentBudgetId);
  }

  createGoal(input: SavingsGoalInput): SavingsGoal {
    return this.activeDb().createGoal(this.requireBudgetId(), input);
  }

  updateGoal(id: string, input: Partial<SavingsGoalInput>): SavingsGoal | null {
    if (!this.currentBudgetId) return null;
    return this.activeDb().updateGoal(id, this.currentBudgetId, input);
  }

  deleteGoal(id: string): boolean {
    if (!this.currentBudgetId) return false;
    return this.activeDb().deleteGoal(id, this.currentBudgetId);
  }

  getDebts(): Debt[] {
    if (!this.currentBudgetId) return [];
    return this.activeDb().getDebts(this.currentBudgetId);
  }

  getDebtById(id: string): Debt | null {
    if (!this.currentBudgetId) return null;
    return this.activeDb().getDebtById(id, this.currentBudgetId);
  }

  getDebtByBillId(billId: string): Debt | null {
    if (!this.currentBudgetId) return null;
    return this.activeDb().getDebtByBillId(billId, this.currentBudgetId);
  }

  createDebt(input: DebtInput): Debt {
    return this.activeDb().createDebt(this.requireBudgetId(), input);
  }

  updateDebt(id: string, input: Partial<DebtInput>): Debt | null {
    if (!this.currentBudgetId) return null;
    return this.activeDb().updateDebt(id, this.currentBudgetId, input);
  }

  deleteDebt(id: string): boolean {
    if (!this.currentBudgetId) return false;
    return this.activeDb().deleteDebt(id, this.currentBudgetId);
  }

  getLeaves(): Leave[] {
    if (!this.currentBudgetId) return [];
    return this.activeDb().getLeaves(this.currentBudgetId);
  }

  createLeave(input: LeaveInput): Leave {
    return this.activeDb().createLeave(this.requireBudgetId(), input);
  }

  updateLeave(id: string, input: LeaveInput): Leave | null {
    if (!this.currentBudgetId) return null;
    return this.activeDb().updateLeave(id, this.currentBudgetId, input);
  }

  deleteLeave(id: string): boolean {
    if (!this.currentBudgetId) return false;
    return this.activeDb().deleteLeave(id, this.currentBudgetId);
  }

  getBudgetSnapshot(): BudgetSnapshot {
    if (!this.currentBudgetId) {
      return {
        incomes: [],
        bills: [],
        goals: [],
        skippedBills: [],
        billAssignments: [],
        incomeOverrides: [],
        debts: [],
        leaves: [],
        budget: null,
      };
    }
    return this.activeDb().getBudgetSnapshot(this.currentBudgetId);
  }
}
