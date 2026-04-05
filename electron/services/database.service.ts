import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { CryptoService } from './crypto.service';
import { validateBill, validateIncome, assertValid } from './validation.service';
import { databaseLogger as logger } from './logger.service';

interface BudgetRow {
  id: string;
  name: string;
  starting_balance: number;
  target_cash_on_hand: number;
  min_cash_on_hand: number;
  created_at: string;
  updated_at: string;
}

export interface Budget {
  id: string;
  name: string;
  startingBalance: number;
  targetCashOnHand: number;
  minCashOnHand: number;
  createdAt: string;
  updatedAt: string;
}

export interface BudgetInput {
  name: string;
  startingBalance?: number;
  targetCashOnHand?: number;
  minCashOnHand?: number;
}

interface GoalRow {
  id: string;
  budget_id: string;
  name: string;
  target_amount: number;
  target_date: string;
  already_saved: number;
  priority: number;
  created_at: string;
}

export interface SavingsGoal {
  id: string;
  budgetId: string;
  name: string;
  targetAmount: number;
  targetDate: string;
  alreadySaved: number;
  priority: number;
  createdAt: string;
}

export interface SavingsGoalInput {
  name: string;
  targetAmount: number;
  targetDate: string;
  alreadySaved?: number;
  priority?: number;
}

interface IncomeRow {
  id: string;
  budget_id: string;
  data: string;
  created_at: string;
  updated_at: string;
}

interface BillRow {
  id: string;
  budget_id: string;
  data: string;
  created_at: string;
  updated_at: string;
}

interface SettingsRow {
  key: string;
  value: string;
}

interface SkippedBillRow {
  id: string;
  budget_id: string;
  bill_id: string;
  skip_date: string;
  created_at: string;
}

export interface SkippedBill {
  id: string;
  billId: string;
  skipDate: string;
  createdAt: string;
}

interface BillAssignmentRow {
  id: string;
  budget_id: string;
  bill_id: string;
  bill_due_date: string;
  paycheck_date: string;
  created_at: string;
}

export interface BillAssignment {
  id: string;
  billId: string;
  billDueDate: string;
  paycheckDate: string;
  createdAt: string;
}

export interface Income {
  id: string;
  sourceName: string;
  amount: number;
  cadence: 'weekly' | 'biweekly' | 'semimonthly' | 'monthly';
  startDate: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Bill {
  id: string;
  creditorName: string;
  budgetedAmount: number;
  dueDay: number;
  category?: string;
  isRecurring: boolean;
  priority: 'critical' | 'high' | 'normal' | 'low';
  preferredIncomeSourceId?: string;
  isIncomeAttached?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AppSettings {
  theme: 'light' | 'dark' | 'system';
  autoLockMinutes: number;
  currency: string;
  defaultScheduleMonths: number;
  savingsAPY: number;
  lastBudgetId?: string;
}

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  autoLockMinutes: 5,
  currency: 'USD',
  defaultScheduleMonths: 3,
  savingsAPY: 0,
};

export class DatabaseService {
  private db: Database.Database | null = null;
  private crypto: CryptoService;
  private dbPath: string;

  constructor(crypto: CryptoService) {
    this.crypto = crypto;
    const userDataPath = app.getPath('userData');
    this.dbPath = path.join(userDataPath, 'budget-data.db');
  }

  initialize(): void {
    const userDataPath = app.getPath('userData');
    if (!fs.existsSync(userDataPath)) {
      fs.mkdirSync(userDataPath, { recursive: true });
    }

    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.runMigrations();
  }

  private runMigrations(): void {
    if (!this.db) throw new Error('Database not initialized');

    // Create schema_version table first
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY
      );
    `);

    const version = this.db.prepare('SELECT MAX(version) as v FROM schema_version').get() as { v: number | null };
    const currentVersion = version?.v ?? 0;

    // Schema version 1: Original tables
    if (currentVersion < 1) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS incomes (
          id TEXT PRIMARY KEY,
          data TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        
        CREATE TABLE IF NOT EXISTS bills (
          id TEXT PRIMARY KEY,
          data TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        
        CREATE TABLE IF NOT EXISTS skipped_bills (
          id TEXT PRIMARY KEY,
          bill_id TEXT NOT NULL,
          skip_date TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE(bill_id, skip_date)
        );
        
        CREATE TABLE IF NOT EXISTS bill_assignments (
          id TEXT PRIMARY KEY,
          bill_id TEXT NOT NULL,
          bill_due_date TEXT NOT NULL,
          paycheck_date TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE(bill_id, bill_due_date)
        );
        
        CREATE INDEX IF NOT EXISTS idx_skipped_bills_date ON skipped_bills(skip_date);
        CREATE INDEX IF NOT EXISTS idx_skipped_bills_bill_id ON skipped_bills(bill_id);
        CREATE INDEX IF NOT EXISTS idx_bill_assignments_paycheck ON bill_assignments(paycheck_date);
        CREATE INDEX IF NOT EXISTS idx_bill_assignments_bill_id ON bill_assignments(bill_id);
      `);
      this.db.prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (1)').run();
      logger.info('Migration to schema version 1 complete');
    }

    // Schema version 2: Multi-budget support
    if (currentVersion < 2) {
      this.migrateToVersion2();
      this.db.prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (2)').run();
      logger.info('Migration to schema version 2 complete (multi-budget support)');
    }

    // Schema version 3: Target cash on hand per budget
    if (currentVersion < 3) {
      this.migrateToVersion3();
      this.db.prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (3)').run();
      logger.info('Migration to schema version 3 complete (target cash on hand)');
    }

    // Schema version 4: Savings goals and min cash on hand
    if (currentVersion < 4) {
      this.migrateToVersion4();
      this.db.prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (4)').run();
      logger.info('Migration to schema version 4 complete (savings goals)');
    }
    
    logger.info('Database initialized', { version: Math.max(currentVersion, 4) });
  }

  private migrateToVersion4(): void {
    if (!this.db) throw new Error('Database not initialized');

    // Add min_cash_on_hand column to budgets table with default of 100
    const hasMinColumn = this.columnExists('budgets', 'min_cash_on_hand');
    if (!hasMinColumn) {
      this.db.exec(`ALTER TABLE budgets ADD COLUMN min_cash_on_hand REAL DEFAULT 100`);
      this.db.prepare(`UPDATE budgets SET min_cash_on_hand = 100 WHERE min_cash_on_hand IS NULL`).run();
      logger.info('Added min_cash_on_hand column to budgets table');
    }

    // Create goals table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS goals (
        id TEXT PRIMARY KEY,
        budget_id TEXT NOT NULL,
        name TEXT NOT NULL,
        target_amount REAL NOT NULL,
        target_date TEXT NOT NULL,
        already_saved REAL DEFAULT 0,
        priority INTEGER DEFAULT 1,
        created_at TEXT NOT NULL,
        FOREIGN KEY (budget_id) REFERENCES budgets(id) ON DELETE CASCADE
      );
      
      CREATE INDEX IF NOT EXISTS idx_goals_budget_id ON goals(budget_id);
      CREATE INDEX IF NOT EXISTS idx_goals_priority ON goals(priority);
    `);
    logger.info('Created goals table');
  }

  private migrateToVersion3(): void {
    if (!this.db) throw new Error('Database not initialized');

    // Add target_cash_on_hand column to budgets table with default of 250
    const hasTargetColumn = this.columnExists('budgets', 'target_cash_on_hand');
    if (!hasTargetColumn) {
      this.db.exec(`ALTER TABLE budgets ADD COLUMN target_cash_on_hand REAL DEFAULT 250`);
      // Set default value for existing budgets
      this.db.prepare(`UPDATE budgets SET target_cash_on_hand = 250 WHERE target_cash_on_hand IS NULL`).run();
      logger.info('Added target_cash_on_hand column to budgets table');
    }
  }

  private migrateToVersion2(): void {
    if (!this.db) throw new Error('Database not initialized');

    // Create budgets table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS budgets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        starting_balance REAL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    // Get starting balance from settings if it exists
    let startingBalance = 0;
    try {
      const row = this.db.prepare("SELECT value FROM settings WHERE key = 'startingBalance'").get() as { value: string } | undefined;
      if (row) {
        startingBalance = JSON.parse(row.value) || 0;
      }
    } catch {
      // Use default
    }

    // Create default "Personal" budget
    const defaultBudgetId = this.crypto.generateId();
    const now = new Date().toISOString();
    
    this.db.prepare(`
      INSERT INTO budgets (id, name, starting_balance, created_at, updated_at)
      VALUES (?, 'Personal', ?, ?, ?)
    `).run(defaultBudgetId, startingBalance, now, now);

    // Add budget_id column to incomes
    const hasIncomesBudgetId = this.columnExists('incomes', 'budget_id');
    if (!hasIncomesBudgetId) {
      this.db.exec(`ALTER TABLE incomes ADD COLUMN budget_id TEXT`);
      this.db.prepare(`UPDATE incomes SET budget_id = ?`).run(defaultBudgetId);
    }

    // Add budget_id column to bills
    const hasBillsBudgetId = this.columnExists('bills', 'budget_id');
    if (!hasBillsBudgetId) {
      this.db.exec(`ALTER TABLE bills ADD COLUMN budget_id TEXT`);
      this.db.prepare(`UPDATE bills SET budget_id = ?`).run(defaultBudgetId);
    }

    // Add budget_id column to skipped_bills
    const hasSkippedBudgetId = this.columnExists('skipped_bills', 'budget_id');
    if (!hasSkippedBudgetId) {
      this.db.exec(`ALTER TABLE skipped_bills ADD COLUMN budget_id TEXT`);
      this.db.prepare(`UPDATE skipped_bills SET budget_id = ?`).run(defaultBudgetId);
    }

    // Add budget_id column to bill_assignments
    const hasAssignmentsBudgetId = this.columnExists('bill_assignments', 'budget_id');
    if (!hasAssignmentsBudgetId) {
      this.db.exec(`ALTER TABLE bill_assignments ADD COLUMN budget_id TEXT`);
      this.db.prepare(`UPDATE bill_assignments SET budget_id = ?`).run(defaultBudgetId);
    }

    // Create indexes for budget_id
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_incomes_budget_id ON incomes(budget_id);
      CREATE INDEX IF NOT EXISTS idx_bills_budget_id ON bills(budget_id);
      CREATE INDEX IF NOT EXISTS idx_skipped_bills_budget_id ON skipped_bills(budget_id);
      CREATE INDEX IF NOT EXISTS idx_bill_assignments_budget_id ON bill_assignments(budget_id);
    `);

    // Remove startingBalance from settings (now per-budget)
    this.db.prepare("DELETE FROM settings WHERE key = 'startingBalance'").run();
    
    logger.info('Migrated existing data to Personal budget', { budgetId: defaultBudgetId });
  }

  private columnExists(table: string, column: string): boolean {
    if (!this.db) return false;
    const info = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    return info.some(col => col.name === column);
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  // Budget Management
  getAllBudgets(): Budget[] {
    if (!this.db) throw new Error('Database not initialized');
    
    const rows = this.db.prepare('SELECT * FROM budgets ORDER BY created_at ASC').all() as BudgetRow[];
    
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      startingBalance: row.starting_balance,
      targetCashOnHand: row.target_cash_on_hand ?? 250,
      minCashOnHand: row.min_cash_on_hand ?? 100,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  getBudgetById(id: string): Budget | null {
    if (!this.db) throw new Error('Database not initialized');
    
    const row = this.db.prepare('SELECT * FROM budgets WHERE id = ?').get(id) as BudgetRow | undefined;
    
    if (!row) return null;
    
    return {
      id: row.id,
      name: row.name,
      startingBalance: row.starting_balance,
      targetCashOnHand: row.target_cash_on_hand ?? 250,
      minCashOnHand: row.min_cash_on_hand ?? 100,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  createBudget(input: BudgetInput): Budget {
    if (!this.db) throw new Error('Database not initialized');
    
    const id = this.crypto.generateId();
    const now = new Date().toISOString();
    const startingBalance = input.startingBalance ?? 0;
    const targetCashOnHand = input.targetCashOnHand ?? 250;
    const minCashOnHand = input.minCashOnHand ?? 100;
    
    this.db.prepare(`
      INSERT INTO budgets (id, name, starting_balance, target_cash_on_hand, min_cash_on_hand, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.name, startingBalance, targetCashOnHand, minCashOnHand, now, now);
    
    logger.info('Budget created', { id, name: input.name });
    
    return {
      id,
      name: input.name,
      startingBalance,
      targetCashOnHand,
      minCashOnHand,
      createdAt: now,
      updatedAt: now,
    };
  }

  updateBudget(id: string, input: Partial<BudgetInput>): Budget | null {
    if (!this.db) throw new Error('Database not initialized');
    
    const existing = this.getBudgetById(id);
    if (!existing) return null;
    
    const now = new Date().toISOString();
    const name = input.name ?? existing.name;
    const startingBalance = input.startingBalance ?? existing.startingBalance;
    const targetCashOnHand = input.targetCashOnHand ?? existing.targetCashOnHand;
    const minCashOnHand = input.minCashOnHand ?? existing.minCashOnHand;
    
    this.db.prepare(`
      UPDATE budgets SET name = ?, starting_balance = ?, target_cash_on_hand = ?, min_cash_on_hand = ?, updated_at = ? WHERE id = ?
    `).run(name, startingBalance, targetCashOnHand, minCashOnHand, now, id);
    
    logger.info('Budget updated', { id, name });
    
    return {
      id,
      name,
      startingBalance,
      targetCashOnHand,
      minCashOnHand,
      createdAt: existing.createdAt,
      updatedAt: now,
    };
  }

  deleteBudget(id: string): boolean {
    if (!this.db) throw new Error('Database not initialized');
    
    // Delete all associated data first (cascade)
    this.db.prepare('DELETE FROM goals WHERE budget_id = ?').run(id);
    this.db.prepare('DELETE FROM bill_assignments WHERE budget_id = ?').run(id);
    this.db.prepare('DELETE FROM skipped_bills WHERE budget_id = ?').run(id);
    this.db.prepare('DELETE FROM bills WHERE budget_id = ?').run(id);
    this.db.prepare('DELETE FROM incomes WHERE budget_id = ?').run(id);
    
    // Delete the budget
    const result = this.db.prepare('DELETE FROM budgets WHERE id = ?').run(id);
    
    if (result.changes > 0) {
      logger.info('Budget deleted', { id });
    }
    
    return result.changes > 0;
  }

  getBudgetStats(budgetId: string): { incomeCount: number; billCount: number } {
    if (!this.db) throw new Error('Database not initialized');
    
    const incomeCount = (this.db.prepare('SELECT COUNT(*) as count FROM incomes WHERE budget_id = ?').get(budgetId) as { count: number }).count;
    const billCount = (this.db.prepare('SELECT COUNT(*) as count FROM bills WHERE budget_id = ?').get(budgetId) as { count: number }).count;
    
    return { incomeCount, billCount };
  }

  getAllBudgetsWithStats(): Array<Budget & { incomeCount: number; billCount: number }> {
    if (!this.db) throw new Error('Database not initialized');
    
    const rows = this.db.prepare(`
      SELECT 
        b.*,
        (SELECT COUNT(*) FROM incomes WHERE budget_id = b.id) as income_count,
        (SELECT COUNT(*) FROM bills WHERE budget_id = b.id) as bill_count
      FROM budgets b
      ORDER BY b.created_at ASC
    `).all() as Array<BudgetRow & { income_count: number; bill_count: number }>;
    
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      startingBalance: row.starting_balance,
      targetCashOnHand: row.target_cash_on_hand ?? 250,
      minCashOnHand: row.min_cash_on_hand ?? 100,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      incomeCount: row.income_count,
      billCount: row.bill_count,
    }));
  }

  // Income Management (budget-scoped)
  getAllIncomes(budgetId: string): Income[] {
    if (!this.db) throw new Error('Database not initialized');
    
    const rows = this.db.prepare('SELECT * FROM incomes WHERE budget_id = ? ORDER BY created_at DESC').all(budgetId) as IncomeRow[];
    
    return rows.map(row => {
      const decrypted = this.crypto.decryptObject<Omit<Income, 'id' | 'createdAt' | 'updatedAt'>>(row.data);
      return {
        id: row.id,
        ...decrypted,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });
  }

  getIncomeById(id: string, budgetId: string): Income | null {
    if (!this.db) throw new Error('Database not initialized');
    
    const row = this.db.prepare('SELECT * FROM incomes WHERE id = ? AND budget_id = ?').get(id, budgetId) as IncomeRow | undefined;
    
    if (!row) return null;
    
    const decrypted = this.crypto.decryptObject<Omit<Income, 'id' | 'createdAt' | 'updatedAt'>>(row.data);
    return {
      id: row.id,
      ...decrypted,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  createIncome(budgetId: string, income: Omit<Income, 'id' | 'createdAt' | 'updatedAt'>): Income {
    if (!this.db) throw new Error('Database not initialized');
    
    // Validate input
    const validation = validateIncome(income);
    assertValid(validation, 'Invalid income data');
    
    const id = this.crypto.generateId();
    const now = new Date().toISOString();
    const encryptedData = this.crypto.encryptObject(income);
    
    this.db.prepare(`
      INSERT INTO incomes (id, budget_id, data, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, budgetId, encryptedData, now, now);
    
    logger.info('Income created', { id, budgetId, sourceName: income.sourceName });
    
    return {
      id,
      ...income,
      createdAt: now,
      updatedAt: now,
    };
  }

  updateIncome(id: string, budgetId: string, income: Omit<Income, 'id' | 'createdAt' | 'updatedAt'>): Income | null {
    if (!this.db) throw new Error('Database not initialized');
    
    // Validate input
    const validation = validateIncome(income);
    assertValid(validation, 'Invalid income data');
    
    const existing = this.getIncomeById(id, budgetId);
    if (!existing) return null;
    
    const now = new Date().toISOString();
    const encryptedData = this.crypto.encryptObject(income);
    
    this.db.prepare(`
      UPDATE incomes SET data = ?, updated_at = ? WHERE id = ? AND budget_id = ?
    `).run(encryptedData, now, id, budgetId);
    
    logger.info('Income updated', { id, budgetId, sourceName: income.sourceName });
    
    return {
      id,
      ...income,
      createdAt: existing.createdAt,
      updatedAt: now,
    };
  }

  deleteIncome(id: string, budgetId: string): boolean {
    if (!this.db) throw new Error('Database not initialized');
    
    const result = this.db.prepare('DELETE FROM incomes WHERE id = ? AND budget_id = ?').run(id, budgetId);
    return result.changes > 0;
  }

  // Bill Management (budget-scoped)
  getAllBills(budgetId: string): Bill[] {
    if (!this.db) throw new Error('Database not initialized');
    
    const rows = this.db.prepare('SELECT * FROM bills WHERE budget_id = ? ORDER BY created_at DESC').all(budgetId) as BillRow[];
    
    return rows.map(row => {
      const decrypted = this.crypto.decryptObject<Omit<Bill, 'id' | 'createdAt' | 'updatedAt'>>(row.data);
      return {
        id: row.id,
        ...decrypted,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });
  }

  getBillById(id: string, budgetId: string): Bill | null {
    if (!this.db) throw new Error('Database not initialized');
    
    const row = this.db.prepare('SELECT * FROM bills WHERE id = ? AND budget_id = ?').get(id, budgetId) as BillRow | undefined;
    
    if (!row) return null;
    
    const decrypted = this.crypto.decryptObject<Omit<Bill, 'id' | 'createdAt' | 'updatedAt'>>(row.data);
    return {
      id: row.id,
      ...decrypted,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  createBillEntry(budgetId: string, bill: Omit<Bill, 'id' | 'createdAt' | 'updatedAt'>): Bill {
    if (!this.db) throw new Error('Database not initialized');
    
    // Validate input
    const validation = validateBill(bill);
    assertValid(validation, 'Invalid bill data');
    
    const id = this.crypto.generateId();
    const now = new Date().toISOString();
    const encryptedData = this.crypto.encryptObject(bill);
    
    this.db.prepare(`
      INSERT INTO bills (id, budget_id, data, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, budgetId, encryptedData, now, now);
    
    logger.info('Bill created', { id, budgetId, creditorName: bill.creditorName });
    
    return {
      id,
      ...bill,
      createdAt: now,
      updatedAt: now,
    };
  }

  updateBillEntry(id: string, budgetId: string, bill: Omit<Bill, 'id' | 'createdAt' | 'updatedAt'>): Bill | null {
    if (!this.db) throw new Error('Database not initialized');
    
    // Validate input
    const validation = validateBill(bill);
    assertValid(validation, 'Invalid bill data');
    
    const existing = this.getBillById(id, budgetId);
    if (!existing) return null;
    
    const now = new Date().toISOString();
    const encryptedData = this.crypto.encryptObject(bill);
    
    this.db.prepare(`
      UPDATE bills SET data = ?, updated_at = ? WHERE id = ? AND budget_id = ?
    `).run(encryptedData, now, id, budgetId);
    
    logger.info('Bill updated', { id, budgetId, creditorName: bill.creditorName });
    
    return {
      id,
      ...bill,
      createdAt: existing.createdAt,
      updatedAt: now,
    };
  }

  deleteBillEntry(id: string, budgetId: string): boolean {
    if (!this.db) throw new Error('Database not initialized');
    
    const result = this.db.prepare('DELETE FROM bills WHERE id = ? AND budget_id = ?').run(id, budgetId);
    return result.changes > 0;
  }

  getSettings(): AppSettings {
    if (!this.db) throw new Error('Database not initialized');
    
    const rows = this.db.prepare('SELECT * FROM settings').all() as SettingsRow[];
    
    const settings = { ...DEFAULT_SETTINGS };
    
    for (const row of rows) {
      try {
        (settings as Record<string, unknown>)[row.key] = JSON.parse(row.value);
      } catch {
        (settings as Record<string, unknown>)[row.key] = row.value;
      }
    }
    
    return settings;
  }

  updateSettings(settings: Partial<AppSettings>): AppSettings {
    if (!this.db) throw new Error('Database not initialized');
    
    const upsert = this.db.prepare(`
      INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)
    `);
    
    const transaction = this.db.transaction(() => {
      for (const [key, value] of Object.entries(settings)) {
        upsert.run(key, JSON.stringify(value));
      }
    });
    
    transaction();
    
    return this.getSettings();
  }

  // Skipped Bills Management (budget-scoped)
  getSkippedBills(budgetId: string): SkippedBill[] {
    if (!this.db) throw new Error('Database not initialized');
    
    const rows = this.db.prepare('SELECT * FROM skipped_bills WHERE budget_id = ? ORDER BY skip_date ASC').all(budgetId) as SkippedBillRow[];
    
    return rows.map(row => ({
      id: row.id,
      billId: row.bill_id,
      skipDate: row.skip_date,
      createdAt: row.created_at,
    }));
  }

  skipBill(budgetId: string, billId: string, skipDate: string): SkippedBill {
    if (!this.db) throw new Error('Database not initialized');
    
    const id = this.crypto.generateId();
    const now = new Date().toISOString();
    
    // Delete existing and insert new (to handle unique constraint)
    this.db.prepare(
      'DELETE FROM skipped_bills WHERE budget_id = ? AND bill_id = ? AND skip_date = ?'
    ).run(budgetId, billId, skipDate);
    
    this.db.prepare(`
      INSERT INTO skipped_bills (id, budget_id, bill_id, skip_date, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, budgetId, billId, skipDate, now);
    
    return {
      id,
      billId,
      skipDate,
      createdAt: now,
    };
  }

  unskipBill(budgetId: string, billId: string, skipDate: string): boolean {
    if (!this.db) throw new Error('Database not initialized');
    
    const result = this.db.prepare(
      'DELETE FROM skipped_bills WHERE budget_id = ? AND bill_id = ? AND skip_date = ?'
    ).run(budgetId, billId, skipDate);
    
    return result.changes > 0;
  }

  isSkipped(budgetId: string, billId: string, skipDate: string): boolean {
    if (!this.db) throw new Error('Database not initialized');
    
    const row = this.db.prepare(
      'SELECT 1 FROM skipped_bills WHERE budget_id = ? AND bill_id = ? AND skip_date = ?'
    ).get(budgetId, billId, skipDate);
    
    return !!row;
  }

  clearOldSkippedBills(budgetId: string, beforeDate: string): number {
    if (!this.db) throw new Error('Database not initialized');
    
    const result = this.db.prepare(
      'DELETE FROM skipped_bills WHERE budget_id = ? AND skip_date < ?'
    ).run(budgetId, beforeDate);
    
    return result.changes;
  }

  // Bill Assignments Management (budget-scoped)
  getBillAssignments(budgetId: string): BillAssignment[] {
    if (!this.db) throw new Error('Database not initialized');
    
    const rows = this.db.prepare('SELECT * FROM bill_assignments WHERE budget_id = ? ORDER BY paycheck_date ASC').all(budgetId) as BillAssignmentRow[];
    
    return rows.map(row => ({
      id: row.id,
      billId: row.bill_id,
      billDueDate: row.bill_due_date,
      paycheckDate: row.paycheck_date,
      createdAt: row.created_at,
    }));
  }

  assignBillToPaycheck(budgetId: string, billId: string, billDueDate: string, paycheckDate: string): BillAssignment {
    if (!this.db) throw new Error('Database not initialized');
    
    const id = this.crypto.generateId();
    const now = new Date().toISOString();
    
    // Delete any existing assignment for this bill occurrence
    this.db.prepare(
      'DELETE FROM bill_assignments WHERE budget_id = ? AND bill_id = ? AND bill_due_date = ?'
    ).run(budgetId, billId, billDueDate);
    
    // Insert new assignment
    this.db.prepare(`
      INSERT INTO bill_assignments (id, budget_id, bill_id, bill_due_date, paycheck_date, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, budgetId, billId, billDueDate, paycheckDate, now);
    
    return {
      id,
      billId,
      billDueDate,
      paycheckDate,
      createdAt: now,
    };
  }

  removeBillAssignment(budgetId: string, billId: string, billDueDate: string): boolean {
    if (!this.db) throw new Error('Database not initialized');
    
    const result = this.db.prepare(
      'DELETE FROM bill_assignments WHERE budget_id = ? AND bill_id = ? AND bill_due_date = ?'
    ).run(budgetId, billId, billDueDate);
    
    return result.changes > 0;
  }

  getBillAssignment(budgetId: string, billId: string, billDueDate: string): BillAssignment | null {
    if (!this.db) throw new Error('Database not initialized');
    
    const row = this.db.prepare(
      'SELECT * FROM bill_assignments WHERE budget_id = ? AND bill_id = ? AND bill_due_date = ?'
    ).get(budgetId, billId, billDueDate) as BillAssignmentRow | undefined;
    
    if (!row) return null;
    
    return {
      id: row.id,
      billId: row.bill_id,
      billDueDate: row.bill_due_date,
      paycheckDate: row.paycheck_date,
      createdAt: row.created_at,
    };
  }

  clearOldBillAssignments(budgetId: string, beforeDate: string): number {
    if (!this.db) throw new Error('Database not initialized');
    
    const result = this.db.prepare(
      'DELETE FROM bill_assignments WHERE budget_id = ? AND paycheck_date < ?'
    ).run(budgetId, beforeDate);
    
    return result.changes;
  }

  // Savings Goals Management (budget-scoped)
  getAllGoals(budgetId: string): SavingsGoal[] {
    if (!this.db) throw new Error('Database not initialized');
    
    const rows = this.db.prepare(
      'SELECT * FROM goals WHERE budget_id = ? ORDER BY priority ASC, created_at ASC'
    ).all(budgetId) as GoalRow[];
    
    return rows.map(row => ({
      id: row.id,
      budgetId: row.budget_id,
      name: row.name,
      targetAmount: row.target_amount,
      targetDate: row.target_date,
      alreadySaved: row.already_saved,
      priority: row.priority,
      createdAt: row.created_at,
    }));
  }

  getGoalById(id: string, budgetId: string): SavingsGoal | null {
    if (!this.db) throw new Error('Database not initialized');
    
    const row = this.db.prepare(
      'SELECT * FROM goals WHERE id = ? AND budget_id = ?'
    ).get(id, budgetId) as GoalRow | undefined;
    
    if (!row) return null;
    
    return {
      id: row.id,
      budgetId: row.budget_id,
      name: row.name,
      targetAmount: row.target_amount,
      targetDate: row.target_date,
      alreadySaved: row.already_saved,
      priority: row.priority,
      createdAt: row.created_at,
    };
  }

  createGoal(budgetId: string, input: SavingsGoalInput): SavingsGoal {
    if (!this.db) throw new Error('Database not initialized');
    
    const id = this.crypto.generateId();
    const now = new Date().toISOString();
    const alreadySaved = input.alreadySaved ?? 0;
    const priority = input.priority ?? 1;
    
    this.db.prepare(`
      INSERT INTO goals (id, budget_id, name, target_amount, target_date, already_saved, priority, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, budgetId, input.name, input.targetAmount, input.targetDate, alreadySaved, priority, now);
    
    logger.info('Goal created', { id, budgetId, name: input.name });
    
    return {
      id,
      budgetId,
      name: input.name,
      targetAmount: input.targetAmount,
      targetDate: input.targetDate,
      alreadySaved,
      priority,
      createdAt: now,
    };
  }

  updateGoal(id: string, budgetId: string, input: Partial<SavingsGoalInput>): SavingsGoal | null {
    if (!this.db) throw new Error('Database not initialized');
    
    const existing = this.getGoalById(id, budgetId);
    if (!existing) return null;
    
    const name = input.name ?? existing.name;
    const targetAmount = input.targetAmount ?? existing.targetAmount;
    const targetDate = input.targetDate ?? existing.targetDate;
    const alreadySaved = input.alreadySaved ?? existing.alreadySaved;
    const priority = input.priority ?? existing.priority;
    
    this.db.prepare(`
      UPDATE goals SET name = ?, target_amount = ?, target_date = ?, already_saved = ?, priority = ? 
      WHERE id = ? AND budget_id = ?
    `).run(name, targetAmount, targetDate, alreadySaved, priority, id, budgetId);
    
    logger.info('Goal updated', { id, budgetId, name });
    
    return {
      id,
      budgetId,
      name,
      targetAmount,
      targetDate,
      alreadySaved,
      priority,
      createdAt: existing.createdAt,
    };
  }

  deleteGoal(id: string, budgetId: string): boolean {
    if (!this.db) throw new Error('Database not initialized');
    
    const result = this.db.prepare(
      'DELETE FROM goals WHERE id = ? AND budget_id = ?'
    ).run(id, budgetId);
    
    if (result.changes > 0) {
      logger.info('Goal deleted', { id, budgetId });
    }
    
    return result.changes > 0;
  }
}
