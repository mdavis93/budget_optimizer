import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { CryptoService } from './crypto.service';
import { validateBill, validateIncome, validateGoal, validateDebt, validateBudget, validateSettings, validateSkippedBill, validateBillAssignment, assertValid } from './validation.service';
import { databaseLogger as logger } from './logger.service';
import type {
  AppSettings,
  Bill,
  BillAssignment,
  Budget,
  BudgetInput,
  BudgetSnapshot,
  Debt,
  DebtInput,
  Income,
  IncomeOverride,
  SavingsGoal,
  SavingsGoalInput,
  SkippedBill,
} from '@shared/types';

// Re-export canonical domain types so existing `from './database.service'`
// consumers continue to resolve unchanged.
export type {
  AppSettings,
  Bill,
  BillAssignment,
  Budget,
  BudgetInput,
  BudgetSnapshot,
  Debt,
  DebtInput,
  Income,
  IncomeOverride,
  SavingsGoal,
  SavingsGoalInput,
  SkippedBill,
};

function defaultScheduleStartDate(createdAt: string): string {
  const created = new Date(createdAt);
  const year = created.getFullYear();
  const month = String(created.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}-01`;
}

interface BudgetRow {
  id: string;
  data: string;
  created_at: string;
  updated_at: string;
}

interface GoalRow {
  id: string;
  budget_id: string;
  data: string;
  created_at: string;
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
  data: string;
  created_at: string;
}

interface SkippedBillPayload {
  billId: string;
  skipDate: string;
}

interface BillAssignmentRow {
  id: string;
  budget_id: string;
  data: string;
  created_at: string;
}

interface BillAssignmentPayload {
  billId: string;
  billDueDate: string;
  paycheckDate: string;
}

interface IncomeOverrideRow {
  id: string;
  budget_id: string;
  data: string;
  created_at: string;
}

interface IncomeOverridePayload {
  incomeId: string;
  paycheckDate: string;
  amount: number;
}

interface DebtRow {
  id: string;
  budget_id: string;
  bill_id: string;
  data: string;
  created_at: string;
  updated_at: string;
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
    this.db.pragma('foreign_keys = ON');
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

    // Schema version 5: Minimum savings per paycheck
    if (currentVersion < 5) {
      this.migrateToVersion5();
      this.db.prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (5)').run();
      logger.info('Migration to schema version 5 complete (min savings per paycheck)');
    }

    // Schema version 6: Debt tracking
    if (currentVersion < 6) {
      this.migrateToVersion6();
      this.db.prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (6)').run();
      logger.info('Migration to schema version 6 complete (debt tracking)');
    }

    // Schema version 7: Monthly payment field for debts
    if (currentVersion < 7) {
      this.migrateToVersion7();
      this.db.prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (7)').run();
      logger.info('Migration to schema version 7 complete (debt monthly payment)');
    }

    // Schema version 8: Per-paycheck income amount overrides
    if (currentVersion < 8) {
      this.migrateToVersion8();
      this.db.prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (8)').run();
      logger.info('Migration to schema version 8 complete (income overrides)');
    }

    // Schema version 9: Encrypt goals, debts, and budget metadata
    if (currentVersion < 9) {
      this.migrateToVersion9();
      this.db.prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (9)').run();
      logger.info('Migration to schema version 9 complete (encrypted metadata)');
    }

    // Schema version 10: Encrypt schedule junction tables
    if (currentVersion < 10) {
      this.migrateToVersion10();
      this.db.prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (10)').run();
      logger.info('Migration to schema version 10 complete (encrypted schedule junctions)');
    }

    try {
      fs.chmodSync(this.dbPath, 0o600);
    } catch (error) {
      logger.warn('Failed to set database file permissions:', error);
    }
    
    logger.info('Database initialized', { version: Math.max(currentVersion, 10) });
  }

  private migrateToVersion5(): void {
    if (!this.db) throw new Error('Database not initialized');

    // Add min_savings_per_paycheck column to budgets table with default of 0
    const hasColumn = this.columnExists('budgets', 'min_savings_per_paycheck');
    if (!hasColumn) {
      this.db.exec(`ALTER TABLE budgets ADD COLUMN min_savings_per_paycheck REAL DEFAULT 0`);
      this.db.prepare(`UPDATE budgets SET min_savings_per_paycheck = 0 WHERE min_savings_per_paycheck IS NULL`).run();
      logger.info('Added min_savings_per_paycheck column to budgets table');
    }
  }

  private migrateToVersion6(): void {
    if (!this.db) throw new Error('Database not initialized');

    // Create debts table for tracking debt payoff with amortization
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS debts (
        id TEXT PRIMARY KEY,
        budget_id TEXT NOT NULL,
        bill_id TEXT NOT NULL,
        principal_balance REAL NOT NULL,
        apr REAL NOT NULL,
        extra_payment_amount REAL DEFAULT 0,
        extra_payment_type TEXT DEFAULT 'none',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (budget_id) REFERENCES budgets(id) ON DELETE CASCADE,
        FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE
      );
      
      CREATE INDEX IF NOT EXISTS idx_debts_budget_id ON debts(budget_id);
      CREATE INDEX IF NOT EXISTS idx_debts_bill_id ON debts(bill_id);
    `);
    logger.info('Created debts table');
  }

  private migrateToVersion7(): void {
    if (!this.db) throw new Error('Database not initialized');

    // Add monthly_payment column to debts table
    const hasColumn = this.columnExists('debts', 'monthly_payment');
    if (!hasColumn) {
      this.db.exec(`ALTER TABLE debts ADD COLUMN monthly_payment REAL DEFAULT 0`);
      logger.info('Added monthly_payment column to debts table');
    }
  }

  private migrateToVersion8(): void {
    if (!this.db) throw new Error('Database not initialized');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS income_overrides (
        id TEXT PRIMARY KEY,
        budget_id TEXT NOT NULL,
        income_id TEXT NOT NULL,
        paycheck_date TEXT NOT NULL,
        amount REAL NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (budget_id) REFERENCES budgets(id) ON DELETE CASCADE,
        FOREIGN KEY (income_id) REFERENCES incomes(id) ON DELETE CASCADE,
        UNIQUE(budget_id, income_id, paycheck_date)
      );
      CREATE INDEX IF NOT EXISTS idx_income_overrides_budget ON income_overrides(budget_id);
      CREATE INDEX IF NOT EXISTS idx_income_overrides_income ON income_overrides(income_id);
    `);
    logger.info('Created income_overrides table');
  }

  private migrateToVersion9(): void {
    if (!this.db) throw new Error('Database not initialized');

    if (this.columnExists('budgets', 'name')) {
      const oldBudgetRows = this.db.prepare('SELECT * FROM budgets').all() as Array<{
        id: string;
        name: string;
        starting_balance: number;
        target_cash_on_hand: number | null;
        min_cash_on_hand: number | null;
        min_savings_per_paycheck: number | null;
        created_at: string;
        updated_at: string;
      }>;

      this.db.exec(`
        CREATE TABLE budgets_encrypted (
          id TEXT PRIMARY KEY,
          data TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);

      const insertBudget = this.db.prepare(`
        INSERT INTO budgets_encrypted (id, data, created_at, updated_at) VALUES (?, ?, ?, ?)
      `);

      const migrateBudgets = this.db.transaction(() => {
        for (const row of oldBudgetRows) {
          const payload = {
            name: row.name,
            startingBalance: row.starting_balance ?? 0,
            targetCashOnHand: row.target_cash_on_hand ?? 250,
            minCashOnHand: row.min_cash_on_hand ?? 100,
            minSavingsPerPaycheck: row.min_savings_per_paycheck ?? 0,
          };
          insertBudget.run(row.id, this.crypto.encryptObject(payload), row.created_at, row.updated_at);
        }
      });
      migrateBudgets();

      this.db.exec('DROP TABLE budgets');
      this.db.exec('ALTER TABLE budgets_encrypted RENAME TO budgets');
      logger.info('Encrypted budgets table metadata');
    }

    if (this.columnExists('goals', 'name')) {
      const oldGoalRows = this.db.prepare('SELECT * FROM goals').all() as Array<{
        id: string;
        budget_id: string;
        name: string;
        target_amount: number;
        target_date: string;
        already_saved: number;
        priority: number;
        created_at: string;
      }>;

      this.db.exec(`
        CREATE TABLE goals_encrypted (
          id TEXT PRIMARY KEY,
          budget_id TEXT NOT NULL,
          data TEXT NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY (budget_id) REFERENCES budgets(id) ON DELETE CASCADE
        );
      `);

      const insertGoal = this.db.prepare(`
        INSERT INTO goals_encrypted (id, budget_id, data, created_at) VALUES (?, ?, ?, ?)
      `);

      const migrateGoals = this.db.transaction(() => {
        for (const row of oldGoalRows) {
          const payload = {
            name: row.name,
            targetAmount: row.target_amount,
            targetDate: row.target_date,
            alreadySaved: row.already_saved ?? 0,
            priority: row.priority ?? 1,
          };
          insertGoal.run(row.id, row.budget_id, this.crypto.encryptObject(payload), row.created_at);
        }
      });
      migrateGoals();

      this.db.exec('DROP TABLE goals');
      this.db.exec('ALTER TABLE goals_encrypted RENAME TO goals');
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_goals_budget_id ON goals(budget_id)');
      logger.info('Encrypted goals table metadata');
    }

    if (this.columnExists('debts', 'principal_balance')) {
      const oldDebtRows = this.db.prepare('SELECT * FROM debts').all() as Array<{
        id: string;
        budget_id: string;
        bill_id: string;
        principal_balance: number;
        apr: number;
        monthly_payment: number | null;
        created_at: string;
        updated_at: string;
      }>;

      this.db.exec(`
        CREATE TABLE debts_encrypted (
          id TEXT PRIMARY KEY,
          budget_id TEXT NOT NULL,
          bill_id TEXT NOT NULL,
          data TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (budget_id) REFERENCES budgets(id) ON DELETE CASCADE,
          FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE
        );
      `);

      const insertDebt = this.db.prepare(`
        INSERT INTO debts_encrypted (id, budget_id, bill_id, data, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      const migrateDebts = this.db.transaction(() => {
        for (const row of oldDebtRows) {
          const payload = {
            principalBalance: row.principal_balance,
            apr: row.apr,
            monthlyPayment: row.monthly_payment ?? 0,
          };
          insertDebt.run(
            row.id,
            row.budget_id,
            row.bill_id,
            this.crypto.encryptObject(payload),
            row.created_at,
            row.updated_at
          );
        }
      });
      migrateDebts();

      this.db.exec('DROP TABLE debts');
      this.db.exec('ALTER TABLE debts_encrypted RENAME TO debts');
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_debts_budget_id ON debts(budget_id)');
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_debts_bill_id ON debts(bill_id)');
      logger.info('Encrypted debts table metadata');
    }
  }

  private migrateToVersion10(): void {
    if (!this.db) throw new Error('Database not initialized');

    if (this.columnExists('skipped_bills', 'bill_id')) {
      const oldRows = this.db.prepare('SELECT * FROM skipped_bills').all() as Array<{
        id: string;
        budget_id: string;
        bill_id: string;
        skip_date: string;
        created_at: string;
      }>;

      this.db.exec(`
        CREATE TABLE skipped_bills_encrypted (
          id TEXT PRIMARY KEY,
          budget_id TEXT NOT NULL,
          data TEXT NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY (budget_id) REFERENCES budgets(id) ON DELETE CASCADE
        );
      `);

      const insert = this.db.prepare(`
        INSERT INTO skipped_bills_encrypted (id, budget_id, data, created_at) VALUES (?, ?, ?, ?)
      `);

      const migrate = this.db.transaction(() => {
        for (const row of oldRows) {
          insert.run(
            row.id,
            row.budget_id,
            this.crypto.encryptObject({ billId: row.bill_id, skipDate: row.skip_date }),
            row.created_at
          );
        }
      });
      migrate();

      this.db.exec('DROP TABLE skipped_bills');
      this.db.exec('ALTER TABLE skipped_bills_encrypted RENAME TO skipped_bills');
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_skipped_bills_budget_id ON skipped_bills(budget_id)');
      logger.info('Encrypted skipped_bills table');
    }

    if (this.columnExists('bill_assignments', 'bill_id')) {
      const oldRows = this.db.prepare('SELECT * FROM bill_assignments').all() as Array<{
        id: string;
        budget_id: string;
        bill_id: string;
        bill_due_date: string;
        paycheck_date: string;
        created_at: string;
      }>;

      this.db.exec(`
        CREATE TABLE bill_assignments_encrypted (
          id TEXT PRIMARY KEY,
          budget_id TEXT NOT NULL,
          data TEXT NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY (budget_id) REFERENCES budgets(id) ON DELETE CASCADE
        );
      `);

      const insert = this.db.prepare(`
        INSERT INTO bill_assignments_encrypted (id, budget_id, data, created_at) VALUES (?, ?, ?, ?)
      `);

      const migrate = this.db.transaction(() => {
        for (const row of oldRows) {
          insert.run(
            row.id,
            row.budget_id,
            this.crypto.encryptObject({
              billId: row.bill_id,
              billDueDate: row.bill_due_date,
              paycheckDate: row.paycheck_date,
            }),
            row.created_at
          );
        }
      });
      migrate();

      this.db.exec('DROP TABLE bill_assignments');
      this.db.exec('ALTER TABLE bill_assignments_encrypted RENAME TO bill_assignments');
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_bill_assignments_budget_id ON bill_assignments(budget_id)');
      logger.info('Encrypted bill_assignments table');
    }

    if (this.columnExists('income_overrides', 'income_id')) {
      const oldRows = this.db.prepare('SELECT * FROM income_overrides').all() as Array<{
        id: string;
        budget_id: string;
        income_id: string;
        paycheck_date: string;
        amount: number;
        created_at: string;
      }>;

      this.db.exec(`
        CREATE TABLE income_overrides_encrypted (
          id TEXT PRIMARY KEY,
          budget_id TEXT NOT NULL,
          data TEXT NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY (budget_id) REFERENCES budgets(id) ON DELETE CASCADE
        );
      `);

      const insert = this.db.prepare(`
        INSERT INTO income_overrides_encrypted (id, budget_id, data, created_at) VALUES (?, ?, ?, ?)
      `);

      const migrate = this.db.transaction(() => {
        for (const row of oldRows) {
          insert.run(
            row.id,
            row.budget_id,
            this.crypto.encryptObject({
              incomeId: row.income_id,
              paycheckDate: row.paycheck_date,
              amount: row.amount,
            }),
            row.created_at
          );
        }
      });
      migrate();

      this.db.exec('DROP TABLE income_overrides');
      this.db.exec('ALTER TABLE income_overrides_encrypted RENAME TO income_overrides');
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_income_overrides_budget ON income_overrides(budget_id)');
      logger.info('Encrypted income_overrides table');
    }
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

  private mapBudgetRow(row: BudgetRow): Budget {
    const decrypted = this.crypto.decryptObject<Omit<Budget, 'id' | 'createdAt' | 'updatedAt'>>(row.data);
    return {
      id: row.id,
      ...decrypted,
      scheduleStartDate: decrypted.scheduleStartDate ?? defaultScheduleStartDate(row.created_at),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapGoalRow(row: GoalRow): SavingsGoal {
    const decrypted = this.crypto.decryptObject<Omit<SavingsGoal, 'id' | 'budgetId' | 'createdAt'>>(row.data);
    return {
      id: row.id,
      budgetId: row.budget_id,
      ...decrypted,
      createdAt: row.created_at,
    };
  }

  private mapDebtRow(row: DebtRow): Debt {
    const decrypted = this.crypto.decryptObject<Omit<Debt, 'id' | 'budgetId' | 'billId' | 'createdAt' | 'updatedAt'>>(row.data);
    return {
      id: row.id,
      budgetId: row.budget_id,
      billId: row.bill_id,
      ...decrypted,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapSkippedBillRow(row: SkippedBillRow): SkippedBill {
    const decrypted = this.crypto.decryptObject<SkippedBillPayload>(row.data);
    return {
      id: row.id,
      billId: decrypted.billId,
      skipDate: decrypted.skipDate,
      createdAt: row.created_at,
    };
  }

  private mapBillAssignmentRow(row: BillAssignmentRow): BillAssignment {
    const decrypted = this.crypto.decryptObject<BillAssignmentPayload>(row.data);
    return {
      id: row.id,
      billId: decrypted.billId,
      billDueDate: decrypted.billDueDate,
      paycheckDate: decrypted.paycheckDate,
      createdAt: row.created_at,
    };
  }

  private mapIncomeOverrideRow(row: IncomeOverrideRow): IncomeOverride {
    const decrypted = this.crypto.decryptObject<IncomeOverridePayload>(row.data);
    return {
      id: row.id,
      incomeId: decrypted.incomeId,
      paycheckDate: decrypted.paycheckDate,
      amount: decrypted.amount,
      createdAt: row.created_at,
    };
  }

  private findSkippedBillId(budgetId: string, billId: string, skipDate: string): string | null {
    const rows = this.db!.prepare('SELECT * FROM skipped_bills WHERE budget_id = ?').all(budgetId) as SkippedBillRow[];
    for (const row of rows) {
      const mapped = this.mapSkippedBillRow(row);
      if (mapped.billId === billId && mapped.skipDate === skipDate) {
        return row.id;
      }
    }
    return null;
  }

  private findBillAssignmentId(budgetId: string, billId: string, billDueDate: string): string | null {
    const rows = this.db!.prepare('SELECT * FROM bill_assignments WHERE budget_id = ?').all(budgetId) as BillAssignmentRow[];
    for (const row of rows) {
      const mapped = this.mapBillAssignmentRow(row);
      if (mapped.billId === billId && mapped.billDueDate === billDueDate) {
        return row.id;
      }
    }
    return null;
  }

  private findIncomeOverrideId(budgetId: string, incomeId: string, paycheckDate: string): string | null {
    const rows = this.db!.prepare('SELECT * FROM income_overrides WHERE budget_id = ?').all(budgetId) as IncomeOverrideRow[];
    for (const row of rows) {
      const mapped = this.mapIncomeOverrideRow(row);
      if (mapped.incomeId === incomeId && mapped.paycheckDate === paycheckDate) {
        return row.id;
      }
    }
    return null;
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
    
    return rows.map(row => this.mapBudgetRow(row));
  }

  getBudgetById(id: string): Budget | null {
    if (!this.db) throw new Error('Database not initialized');
    
    const row = this.db.prepare('SELECT * FROM budgets WHERE id = ?').get(id) as BudgetRow | undefined;
    
    if (!row) return null;
    
    return this.mapBudgetRow(row);
  }

  createBudget(input: BudgetInput): Budget {
    if (!this.db) throw new Error('Database not initialized');

    assertValid(validateBudget(input), 'Invalid budget data');

    const duplicate = this.getAllBudgets().some(
      budget => budget.name.toLowerCase() === input.name.toLowerCase()
    );
    if (duplicate) {
      throw new Error('Budget name already exists');
    }
    
    const id = this.crypto.generateId();
    const now = new Date().toISOString();
    const payload = {
      name: input.name,
      startingBalance: input.startingBalance ?? 0,
      targetCashOnHand: input.targetCashOnHand ?? 250,
      minCashOnHand: input.minCashOnHand ?? 100,
      minSavingsPerPaycheck: input.minSavingsPerPaycheck ?? 0,
      scheduleStartDate: input.scheduleStartDate ?? defaultScheduleStartDate(now),
    };
    const encryptedData = this.crypto.encryptObject(payload);
    
    this.db.prepare(`
      INSERT INTO budgets (id, data, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `).run(id, encryptedData, now, now);
    
    logger.info('Budget created', { id, name: input.name });
    
    return {
      id,
      ...payload,
      createdAt: now,
      updatedAt: now,
    };
  }

  updateBudget(id: string, input: Partial<BudgetInput>): Budget | null {
    if (!this.db) throw new Error('Database not initialized');
    
    const existing = this.getBudgetById(id);
    if (!existing) return null;

    const name = input.name ?? existing.name;
    assertValid(
      validateBudget({
        name,
        startingBalance: input.startingBalance ?? existing.startingBalance,
        targetCashOnHand: input.targetCashOnHand ?? existing.targetCashOnHand,
        minCashOnHand: input.minCashOnHand ?? existing.minCashOnHand,
        minSavingsPerPaycheck: input.minSavingsPerPaycheck ?? existing.minSavingsPerPaycheck,
        scheduleStartDate: input.scheduleStartDate ?? existing.scheduleStartDate,
      }),
      'Invalid budget data'
    );

    if (name.toLowerCase() !== existing.name.toLowerCase()) {
      const duplicate = this.getAllBudgets().some(
        budget => budget.id !== id && budget.name.toLowerCase() === name.toLowerCase()
      );
      if (duplicate) {
        throw new Error('Budget name already exists');
      }
    }
    
    const now = new Date().toISOString();
    const payload = {
      name,
      startingBalance: input.startingBalance ?? existing.startingBalance,
      targetCashOnHand: input.targetCashOnHand ?? existing.targetCashOnHand,
      minCashOnHand: input.minCashOnHand ?? existing.minCashOnHand,
      minSavingsPerPaycheck: input.minSavingsPerPaycheck ?? existing.minSavingsPerPaycheck,
      scheduleStartDate: input.scheduleStartDate ?? existing.scheduleStartDate,
    };
    const encryptedData = this.crypto.encryptObject(payload);
    
    this.db.prepare(`
      UPDATE budgets SET data = ?, updated_at = ? WHERE id = ?
    `).run(encryptedData, now, id);
    
    logger.info('Budget updated', { id, name });
    
    return {
      id,
      ...payload,
      createdAt: existing.createdAt,
      updatedAt: now,
    };
  }

  deleteBudget(id: string): boolean {
    if (!this.db) throw new Error('Database not initialized');
    
    // Use transaction for atomic deletion of budget and all associated data
    const deleteBudgetTransaction = this.db.transaction(() => {
      // Delete all associated data first (cascade)
      this.db!.prepare('DELETE FROM debts WHERE budget_id = ?').run(id);
      this.db!.prepare('DELETE FROM goals WHERE budget_id = ?').run(id);
      this.db!.prepare('DELETE FROM bill_assignments WHERE budget_id = ?').run(id);
      this.db!.prepare('DELETE FROM income_overrides WHERE budget_id = ?').run(id);
      this.db!.prepare('DELETE FROM skipped_bills WHERE budget_id = ?').run(id);
      this.db!.prepare('DELETE FROM bills WHERE budget_id = ?').run(id);
      this.db!.prepare('DELETE FROM incomes WHERE budget_id = ?').run(id);
      
      // Delete the budget
      return this.db!.prepare('DELETE FROM budgets WHERE id = ?').run(id);
    });
    
    const result = deleteBudgetTransaction();
    
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
      ...this.mapBudgetRow(row),
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

    const overrideRows = this.db.prepare(
      'SELECT * FROM income_overrides WHERE budget_id = ?'
    ).all(budgetId) as IncomeOverrideRow[];
    const deleteOverride = this.db.prepare('DELETE FROM income_overrides WHERE id = ?');
    for (const row of overrideRows) {
      const mapped = this.mapIncomeOverrideRow(row);
      if (mapped.incomeId === id) {
        deleteOverride.run(row.id);
      }
    }

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

    assertValid(validateSettings(settings as Record<string, unknown>), 'Invalid settings data');
    
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
    
    const rows = this.db.prepare('SELECT * FROM skipped_bills WHERE budget_id = ?').all(budgetId) as SkippedBillRow[];
    
    return rows
      .map(row => this.mapSkippedBillRow(row))
      .sort((a, b) => a.skipDate.localeCompare(b.skipDate));
  }

  skipBill(budgetId: string, billId: string, skipDate: string): SkippedBill {
    if (!this.db) throw new Error('Database not initialized');

    assertValid(validateSkippedBill({ billId, skipDate }), 'Invalid skipped bill');
    if (!this.getBillById(billId, budgetId)) {
      throw new Error('Bill not found');
    }
    
    const id = this.crypto.generateId();
    const now = new Date().toISOString();
    const payload: SkippedBillPayload = { billId, skipDate };
    const encryptedData = this.crypto.encryptObject(payload);
    
    const skipBillTransaction = this.db.transaction(() => {
      const existingId = this.findSkippedBillId(budgetId, billId, skipDate);
      if (existingId) {
        this.db!.prepare('DELETE FROM skipped_bills WHERE id = ?').run(existingId);
      }
      
      this.db!.prepare(`
        INSERT INTO skipped_bills (id, budget_id, data, created_at)
        VALUES (?, ?, ?, ?)
      `).run(id, budgetId, encryptedData, now);
    });
    
    skipBillTransaction();
    
    return {
      id,
      billId,
      skipDate,
      createdAt: now,
    };
  }

  unskipBill(budgetId: string, billId: string, skipDate: string): boolean {
    if (!this.db) throw new Error('Database not initialized');
    
    const existingId = this.findSkippedBillId(budgetId, billId, skipDate);
    if (!existingId) {
      return false;
    }

    const result = this.db.prepare('DELETE FROM skipped_bills WHERE id = ?').run(existingId);
    return result.changes > 0;
  }

  isSkipped(budgetId: string, billId: string, skipDate: string): boolean {
    if (!this.db) throw new Error('Database not initialized');
    return this.findSkippedBillId(budgetId, billId, skipDate) !== null;
  }

  clearOldSkippedBills(budgetId: string, beforeDate: string): number {
    if (!this.db) throw new Error('Database not initialized');
    
    const rows = this.db.prepare('SELECT * FROM skipped_bills WHERE budget_id = ?').all(budgetId) as SkippedBillRow[];
    const idsToDelete = rows
      .filter(row => this.mapSkippedBillRow(row).skipDate < beforeDate)
      .map(row => row.id);

    const deleteStmt = this.db.prepare('DELETE FROM skipped_bills WHERE id = ?');
    const clearTransaction = this.db.transaction(() => {
      for (const id of idsToDelete) {
        deleteStmt.run(id);
      }
    });
    clearTransaction();

    return idsToDelete.length;
  }

  // Bill Assignments Management (budget-scoped)
  getBillAssignments(budgetId: string): BillAssignment[] {
    if (!this.db) throw new Error('Database not initialized');
    
    const rows = this.db.prepare('SELECT * FROM bill_assignments WHERE budget_id = ?').all(budgetId) as BillAssignmentRow[];
    
    return rows
      .map(row => this.mapBillAssignmentRow(row))
      .sort((a, b) => a.paycheckDate.localeCompare(b.paycheckDate));
  }

  assignBillToPaycheck(budgetId: string, billId: string, billDueDate: string, paycheckDate: string): BillAssignment {
    if (!this.db) throw new Error('Database not initialized');

    assertValid(
      validateBillAssignment({ billId, billDueDate, paycheckDate }),
      'Invalid bill assignment'
    );
    if (!this.getBillById(billId, budgetId)) {
      throw new Error('Bill not found');
    }
    
    const id = this.crypto.generateId();
    const now = new Date().toISOString();
    const payload: BillAssignmentPayload = { billId, billDueDate, paycheckDate };
    const encryptedData = this.crypto.encryptObject(payload);
    
    const assignTransaction = this.db.transaction(() => {
      const existingId = this.findBillAssignmentId(budgetId, billId, billDueDate);
      if (existingId) {
        this.db!.prepare('DELETE FROM bill_assignments WHERE id = ?').run(existingId);
      }
      
      this.db!.prepare(`
        INSERT INTO bill_assignments (id, budget_id, data, created_at)
        VALUES (?, ?, ?, ?)
      `).run(id, budgetId, encryptedData, now);
    });
    
    assignTransaction();
    
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
    
    const existingId = this.findBillAssignmentId(budgetId, billId, billDueDate);
    if (!existingId) {
      return false;
    }

    const result = this.db.prepare('DELETE FROM bill_assignments WHERE id = ?').run(existingId);
    return result.changes > 0;
  }

  getBillAssignment(budgetId: string, billId: string, billDueDate: string): BillAssignment | null {
    if (!this.db) throw new Error('Database not initialized');
    
    const existingId = this.findBillAssignmentId(budgetId, billId, billDueDate);
    if (!existingId) {
      return null;
    }

    const row = this.db.prepare('SELECT * FROM bill_assignments WHERE id = ?').get(existingId) as BillAssignmentRow;
    return this.mapBillAssignmentRow(row);
  }

  clearOldBillAssignments(budgetId: string, beforeDate: string): number {
    if (!this.db) throw new Error('Database not initialized');
    
    const rows = this.db.prepare('SELECT * FROM bill_assignments WHERE budget_id = ?').all(budgetId) as BillAssignmentRow[];
    const idsToDelete = rows
      .filter(row => this.mapBillAssignmentRow(row).paycheckDate < beforeDate)
      .map(row => row.id);

    const deleteStmt = this.db.prepare('DELETE FROM bill_assignments WHERE id = ?');
    const clearTransaction = this.db.transaction(() => {
      for (const id of idsToDelete) {
        deleteStmt.run(id);
      }
    });
    clearTransaction();

    return idsToDelete.length;
  }

  // Income overrides (per projected paycheck date for an income source)
  getIncomeOverrides(budgetId: string): IncomeOverride[] {
    if (!this.db) throw new Error('Database not initialized');

    const rows = this.db.prepare(
      'SELECT * FROM income_overrides WHERE budget_id = ?'
    ).all(budgetId) as IncomeOverrideRow[];

    return rows
      .map(row => this.mapIncomeOverrideRow(row))
      .sort((a, b) => a.paycheckDate.localeCompare(b.paycheckDate));
  }

  setIncomeOverride(budgetId: string, incomeId: string, paycheckDate: string, amount: number): IncomeOverride {
    if (!this.db) throw new Error('Database not initialized');
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error('Income override amount must be a non-negative number');
    }

    const id = this.crypto.generateId();
    const now = new Date().toISOString();
    const payload: IncomeOverridePayload = { incomeId, paycheckDate, amount };
    const encryptedData = this.crypto.encryptObject(payload);

    const tx = this.db.transaction(() => {
      const existingId = this.findIncomeOverrideId(budgetId, incomeId, paycheckDate);
      if (existingId) {
        this.db!.prepare('DELETE FROM income_overrides WHERE id = ?').run(existingId);
      }

      this.db!.prepare(`
        INSERT INTO income_overrides (id, budget_id, data, created_at)
        VALUES (?, ?, ?, ?)
      `).run(id, budgetId, encryptedData, now);
    });
    tx();

    return {
      id,
      incomeId,
      paycheckDate,
      amount,
      createdAt: now,
    };
  }

  removeIncomeOverride(budgetId: string, incomeId: string, paycheckDate: string): boolean {
    if (!this.db) throw new Error('Database not initialized');
    
    const existingId = this.findIncomeOverrideId(budgetId, incomeId, paycheckDate);
    if (!existingId) {
      return false;
    }

    const result = this.db.prepare('DELETE FROM income_overrides WHERE id = ?').run(existingId);
    return result.changes > 0;
  }

  // Savings Goals Management (budget-scoped)
  getAllGoals(budgetId: string): SavingsGoal[] {
    if (!this.db) throw new Error('Database not initialized');
    
    const rows = this.db.prepare(
      'SELECT * FROM goals WHERE budget_id = ? ORDER BY created_at ASC'
    ).all(budgetId) as GoalRow[];
    
    return rows
      .map(row => this.mapGoalRow(row))
      .sort((a, b) => a.priority - b.priority || a.createdAt.localeCompare(b.createdAt));
  }

  getGoalById(id: string, budgetId: string): SavingsGoal | null {
    if (!this.db) throw new Error('Database not initialized');
    
    const row = this.db.prepare(
      'SELECT * FROM goals WHERE id = ? AND budget_id = ?'
    ).get(id, budgetId) as GoalRow | undefined;
    
    if (!row) return null;
    
    return this.mapGoalRow(row);
  }

  createGoal(budgetId: string, input: SavingsGoalInput): SavingsGoal {
    if (!this.db) throw new Error('Database not initialized');

    assertValid(validateGoal(input), 'Invalid goal data');
    
    const id = this.crypto.generateId();
    const now = new Date().toISOString();
    const payload = {
      name: input.name,
      targetAmount: input.targetAmount,
      targetDate: input.targetDate,
      alreadySaved: input.alreadySaved ?? 0,
      priority: input.priority ?? 1,
    };
    const encryptedData = this.crypto.encryptObject(payload);
    
    this.db.prepare(`
      INSERT INTO goals (id, budget_id, data, created_at)
      VALUES (?, ?, ?, ?)
    `).run(id, budgetId, encryptedData, now);
    
    logger.info('Goal created', { id, budgetId, name: input.name });
    
    return {
      id,
      budgetId,
      ...payload,
      createdAt: now,
    };
  }

  updateGoal(id: string, budgetId: string, input: Partial<SavingsGoalInput>): SavingsGoal | null {
    if (!this.db) throw new Error('Database not initialized');
    
    const existing = this.getGoalById(id, budgetId);
    if (!existing) return null;
    
    const payload = {
      name: input.name ?? existing.name,
      targetAmount: input.targetAmount ?? existing.targetAmount,
      targetDate: input.targetDate ?? existing.targetDate,
      alreadySaved: input.alreadySaved ?? existing.alreadySaved,
      priority: input.priority ?? existing.priority,
    };
    assertValid(validateGoal(payload), 'Invalid goal data');
    const encryptedData = this.crypto.encryptObject(payload);
    
    this.db.prepare(`
      UPDATE goals SET data = ? WHERE id = ? AND budget_id = ?
    `).run(encryptedData, id, budgetId);
    
    logger.info('Goal updated', { id, budgetId, name: payload.name });
    
    return {
      id,
      budgetId,
      ...payload,
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

  // Debt methods
  getDebts(budgetId: string): Debt[] {
    if (!this.db) throw new Error('Database not initialized');
    
    const rows = this.db.prepare(
      'SELECT * FROM debts WHERE budget_id = ?'
    ).all(budgetId) as DebtRow[];
    
    return rows.map(row => this.mapDebtRow(row));
  }

  getBudgetSnapshot(budgetId: string): BudgetSnapshot {
    if (!this.db) throw new Error('Database not initialized');

    const loadSnapshot = this.db.transaction(() => ({
      incomes: this.getAllIncomes(budgetId),
      bills: this.getAllBills(budgetId),
      goals: this.getAllGoals(budgetId),
      skippedBills: this.getSkippedBills(budgetId),
      billAssignments: this.getBillAssignments(budgetId),
      incomeOverrides: this.getIncomeOverrides(budgetId),
      debts: this.getDebts(budgetId),
      budget: this.getBudgetById(budgetId),
    }));

    return loadSnapshot();
  }

  getDebtById(id: string, budgetId: string): Debt | null {
    if (!this.db) throw new Error('Database not initialized');
    
    const row = this.db.prepare(
      'SELECT * FROM debts WHERE id = ? AND budget_id = ?'
    ).get(id, budgetId) as DebtRow | undefined;
    
    if (!row) return null;
    
    return this.mapDebtRow(row);
  }

  getDebtByBillId(billId: string, budgetId: string): Debt | null {
    if (!this.db) throw new Error('Database not initialized');
    
    const row = this.db.prepare(
      'SELECT * FROM debts WHERE bill_id = ? AND budget_id = ?'
    ).get(billId, budgetId) as DebtRow | undefined;
    
    if (!row) return null;
    
    return this.mapDebtRow(row);
  }

  createDebt(budgetId: string, input: DebtInput): Debt {
    if (!this.db) throw new Error('Database not initialized');

    assertValid(validateDebt(input), 'Invalid debt data');
    
    const id = this.crypto.generateId();
    const now = new Date().toISOString();
    const payload = {
      principalBalance: input.principalBalance,
      apr: input.apr,
      monthlyPayment: input.monthlyPayment,
    };
    const encryptedData = this.crypto.encryptObject(payload);
    
    this.db.prepare(`
      INSERT INTO debts (id, budget_id, bill_id, data, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, budgetId, input.billId, encryptedData, now, now);
    
    logger.info('Debt created', { id, budgetId, billId: input.billId });
    
    return {
      id,
      budgetId,
      billId: input.billId,
      ...payload,
      createdAt: now,
      updatedAt: now,
    };
  }

  updateDebt(id: string, budgetId: string, input: Partial<DebtInput>): Debt | null {
    if (!this.db) throw new Error('Database not initialized');
    
    const existing = this.getDebtById(id, budgetId);
    if (!existing) return null;
    
    const payload = {
      principalBalance: input.principalBalance ?? existing.principalBalance,
      apr: input.apr ?? existing.apr,
      monthlyPayment: input.monthlyPayment ?? existing.monthlyPayment,
    };
    assertValid(
      validateDebt({ billId: existing.billId, ...payload }),
      'Invalid debt data'
    );
    const now = new Date().toISOString();
    const encryptedData = this.crypto.encryptObject(payload);
    
    this.db.prepare(`
      UPDATE debts SET data = ?, updated_at = ? WHERE id = ? AND budget_id = ?
    `).run(encryptedData, now, id, budgetId);
    
    logger.info('Debt updated', { id, budgetId });
    
    return {
      id,
      budgetId,
      billId: existing.billId,
      ...payload,
      createdAt: existing.createdAt,
      updatedAt: now,
    };
  }

  deleteDebt(id: string, budgetId: string): boolean {
    if (!this.db) throw new Error('Database not initialized');
    
    const result = this.db.prepare(
      'DELETE FROM debts WHERE id = ? AND budget_id = ?'
    ).run(id, budgetId);
    
    if (result.changes > 0) {
      logger.info('Debt deleted', { id, budgetId });
    }
    
    return result.changes > 0;
  }
}
