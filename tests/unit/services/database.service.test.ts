import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CryptoService } from '../../../electron/services/crypto.service';
import { DatabaseService } from '../../../electron/services/database.service';

let tempRoot = '';
const mockGetPath = vi.fn((name: string) => {
  if (name === 'userData') {
    return tempRoot;
  }
  return tempRoot;
});

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => mockGetPath(name),
  },
}));

function createCrypto(): CryptoService {
  const crypto = new CryptoService();
  const salt = crypto.generateSalt();
  crypto.setEncryptionKey(crypto.deriveKey('test-password', salt));
  return crypto;
}

describe('DatabaseService', () => {
  let db: DatabaseService;

  beforeEach(() => {
    tempRoot = path.join(os.tmpdir(), `budget-optimizer-database-test-${process.pid}-${Date.now()}`);
    fs.mkdirSync(tempRoot, { recursive: true, mode: 0o700 });
    db = new DatabaseService(createCrypto());
    db.initialize();
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  describe('happy', () => {
    it('handles budget CRUD including scheduleStartDate', () => {
      const created = db.createBudget({
        name: 'Household',
        startingBalance: 1000,
        scheduleStartDate: '2026-05-01',
      });
      expect(created.scheduleStartDate).toBe('2026-05-01');

      const updated = db.updateBudget(created.id, {
        name: 'Household Updated',
        scheduleStartDate: '2026-06-01',
      });
      expect(updated).not.toBeNull();
      expect(updated?.name).toBe('Household Updated');
      expect(updated?.scheduleStartDate).toBe('2026-06-01');

      const fetched = db.getBudgetById(created.id);
      expect(fetched?.scheduleStartDate).toBe('2026-06-01');

      expect(db.deleteBudget(created.id)).toBe(true);
      expect(db.getBudgetById(created.id)).toBeNull();
    });

    it('handles income and bill CRUD scoped to a budget', () => {
      const budget = db.createBudget({ name: 'Income and Bills' });
      const income = db.createIncome(budget.id, {
        sourceName: 'Salary',
        amount: 2500,
        cadence: 'biweekly',
        startDate: '2026-01-01',
        isActive: true,
      });
      expect(db.getIncomeById(income.id, budget.id)?.sourceName).toBe('Salary');

      const updatedIncome = db.updateIncome(income.id, budget.id, {
        sourceName: 'Salary Updated',
        amount: 2600,
        cadence: 'biweekly',
        startDate: '2026-01-01',
        isActive: true,
      });
      expect(updatedIncome?.amount).toBe(2600);

      const bill = db.createBillEntry(budget.id, {
        creditorName: 'Rent',
        budgetedAmount: 1400,
        dueDay: 1,
        isRecurring: true,
        priority: 'critical',
      });
      expect(db.getBillById(bill.id, budget.id)?.creditorName).toBe('Rent');

      const updatedBill = db.updateBillEntry(bill.id, budget.id, {
        creditorName: 'Rent Updated',
        budgetedAmount: 1450,
        dueDay: 1,
        isRecurring: true,
        priority: 'critical',
      });
      expect(updatedBill?.budgetedAmount).toBe(1450);

      expect(db.deleteIncome(income.id, budget.id)).toBe(true);
      expect(db.deleteBillEntry(bill.id, budget.id)).toBe(true);
    });

    it('returns default settings when none are persisted', () => {
      const settings = db.getSettings();
      expect(settings.theme).toBe('system');
      expect(settings.autoLockMinutes).toBe(5);
      expect(settings.currency).toBe('USD');
      expect(settings.defaultScheduleMonths).toBe(3);
    });

    it('handles goals and debts CRUD scoped to a budget', () => {
      const budget = db.createBudget({ name: 'Goals and Debts' });
      const bill = db.createBillEntry(budget.id, {
        creditorName: 'Loan',
        budgetedAmount: 300,
        dueDay: 15,
        isRecurring: true,
        priority: 'high',
      });

      const goal = db.createGoal(budget.id, {
        name: 'Emergency Fund',
        targetAmount: 5000,
        targetDate: '2027-01-01',
        priority: 2,
      });
      expect(db.getGoalById(goal.id, budget.id)?.name).toBe('Emergency Fund');

      const updatedGoal = db.updateGoal(goal.id, budget.id, { alreadySaved: 250, priority: 1 });
      expect(updatedGoal?.alreadySaved).toBe(250);
      expect(updatedGoal?.priority).toBe(1);

      const debt = db.createDebt(budget.id, {
        billId: bill.id,
        principalBalance: 10000,
        apr: 12,
        monthlyPayment: 300,
      });
      expect(db.getDebtById(debt.id, budget.id)?.billId).toBe(bill.id);
      expect(db.getDebtByBillId(bill.id, budget.id)?.id).toBe(debt.id);

      const updatedDebt = db.updateDebt(debt.id, budget.id, { monthlyPayment: 350 });
      expect(updatedDebt?.monthlyPayment).toBe(350);

      expect(db.deleteDebt(debt.id, budget.id)).toBe(true);
      expect(db.deleteGoal(goal.id, budget.id)).toBe(true);
    });

    it('handles skipped bills, assignments, and income overrides replacement behavior', () => {
      const budget = db.createBudget({ name: 'Scheduling Data' });
      const bill = db.createBillEntry(budget.id, {
        creditorName: 'Utilities',
        budgetedAmount: 120,
        dueDay: 5,
        isRecurring: true,
        priority: 'normal',
      });
      const income = db.createIncome(budget.id, {
        sourceName: 'Paycheck',
        amount: 2000,
        cadence: 'biweekly',
        startDate: '2026-01-01',
        isActive: true,
      });

      const firstSkipped = db.skipBill(budget.id, bill.id, '2026-02-05');
      const secondSkipped = db.skipBill(budget.id, bill.id, '2026-02-05');
      expect(firstSkipped.id).not.toBe(secondSkipped.id);
      expect(db.getSkippedBills(budget.id)).toHaveLength(1);
      expect(db.unskipBill(budget.id, bill.id, '2026-02-05')).toBe(true);
      expect(db.unskipBill(budget.id, bill.id, '2026-02-05')).toBe(false);
      expect(db.isSkipped(budget.id, bill.id, '2026-02-05')).toBe(false);

      db.skipBill(budget.id, bill.id, '2026-01-05');
      expect(db.isSkipped(budget.id, bill.id, '2026-01-05')).toBe(true);
      db.skipBill(budget.id, bill.id, '2026-03-05');
      expect(db.clearOldSkippedBills(budget.id, '2026-02-01')).toBe(1);

      const firstAssignment = db.assignBillToPaycheck(budget.id, bill.id, '2026-03-05', '2026-02-28');
      const secondAssignment = db.assignBillToPaycheck(budget.id, bill.id, '2026-03-05', '2026-03-15');
      expect(firstAssignment.id).not.toBe(secondAssignment.id);
      expect(db.getBillAssignments(budget.id)).toHaveLength(1);
      expect(db.getBillAssignment(budget.id, bill.id, '2026-03-05')?.paycheckDate).toBe('2026-03-15');
      expect(db.removeBillAssignment(budget.id, bill.id, '2026-03-05')).toBe(true);
      expect(db.removeBillAssignment(budget.id, bill.id, '2026-03-05')).toBe(false);

      db.assignBillToPaycheck(budget.id, bill.id, '2026-01-05', '2025-12-30');
      db.assignBillToPaycheck(budget.id, bill.id, '2026-04-05', '2026-03-30');
      expect(db.clearOldBillAssignments(budget.id, '2026-01-01')).toBe(1);

      const firstOverride = db.setIncomeOverride(budget.id, income.id, '2026-02-15', 1800);
      const secondOverride = db.setIncomeOverride(budget.id, income.id, '2026-02-15', 1750);
      expect(firstOverride.id).not.toBe(secondOverride.id);
      expect(db.getIncomeOverrides(budget.id)).toHaveLength(1);
      expect(db.removeIncomeOverride(budget.id, income.id, '2026-02-15')).toBe(true);
      expect(db.removeIncomeOverride(budget.id, income.id, '2026-02-15')).toBe(false);
    });

    it('updates persisted settings and keeps existing defaults', () => {
      const updated = db.updateSettings({
        autoLockMinutes: 20,
        currency: 'CAD',
        theme: 'dark',
        savingsAPY: 4.25,
        defaultScheduleMonths: 6,
      });
      expect(updated.autoLockMinutes).toBe(20);
      expect(updated.currency).toBe('CAD');
      expect(updated.theme).toBe('dark');
      expect(updated.savingsAPY).toBe(4.25);
      expect(updated.defaultScheduleMonths).toBe(6);
    });

    it('updates budget with partial fields only', () => {
      const budget = db.createBudget({ name: 'Partial Update Budget' });
      const updated = db.updateBudget(budget.id, { startingBalance: 2500 });
      expect(updated?.startingBalance).toBe(2500);
      expect(updated?.name).toBe('Partial Update Budget');
    });

    it('deletes a budget with associated cascade data', () => {
      const budget = db.createBudget({ name: 'Cascade Budget' });
      const income = db.createIncome(budget.id, {
        sourceName: 'Main Income',
        amount: 3000,
        cadence: 'monthly',
        startDate: '2026-01-01',
        isActive: true,
      });
      const bill = db.createBillEntry(budget.id, {
        creditorName: 'Card',
        budgetedAmount: 200,
        dueDay: 20,
        isRecurring: true,
        priority: 'normal',
      });
      db.createGoal(budget.id, {
        name: 'Trip',
        targetAmount: 2000,
        targetDate: '2027-01-01',
      });
      db.createDebt(budget.id, {
        billId: bill.id,
        principalBalance: 5000,
        apr: 18,
        monthlyPayment: 200,
      });
      db.skipBill(budget.id, bill.id, '2026-03-20');
      db.assignBillToPaycheck(budget.id, bill.id, '2026-03-20', '2026-03-15');
      db.setIncomeOverride(budget.id, income.id, '2026-03-15', 2800);

      expect(db.deleteBudget(budget.id)).toBe(true);
      expect(db.getBudgetById(budget.id)).toBeNull();
      expect(db.getAllIncomes(budget.id)).toEqual([]);
      expect(db.getAllBills(budget.id)).toEqual([]);
      expect(db.getAllGoals(budget.id)).toEqual([]);
      expect(db.getDebts(budget.id)).toEqual([]);
      expect(db.getSkippedBills(budget.id)).toEqual([]);
      expect(db.getBillAssignments(budget.id)).toEqual([]);
      expect(db.getIncomeOverrides(budget.id)).toEqual([]);
    });
  });

  describe('sad', () => {
    it('rejects duplicate budget names case-insensitively', () => {
      db.createBudget({ name: 'Personal Budget' });
      expect(() => db.createBudget({ name: 'personal budget' })).toThrow('Budget name already exists');
    });

    it('returns null/false for missing records', () => {
      const budget = db.createBudget({ name: 'Missing Records Budget' });
      expect(db.updateGoal('missing-goal', budget.id, { name: 'x' })).toBeNull();
      expect(db.deleteGoal('missing-goal', budget.id)).toBe(false);
      expect(db.updateDebt('missing-debt', budget.id, { apr: 10 })).toBeNull();
      expect(db.deleteDebt('missing-debt', budget.id)).toBe(false);
      expect(db.getGoalById('missing-goal', budget.id)).toBeNull();
      expect(db.getDebtById('missing-debt', budget.id)).toBeNull();
      expect(db.getDebtByBillId('missing-bill', budget.id)).toBeNull();
    });

    it('returns false when deleting unknown budget', () => {
      expect(db.deleteBudget('missing-budget')).toBe(false);
    });
  });

  describe('hostile', () => {
    it('rejects invalid budget scheduleStartDate payload', () => {
      expect(() =>
        db.createBudget({
          name: 'Bad Budget',
          scheduleStartDate: '2026/99/99',
        })
      ).toThrow(/Invalid budget data/);
    });

    it('rejects invalid income payload', () => {
      const budget = db.createBudget({ name: 'Guardrails Budget' });
      expect(() =>
        db.createIncome(budget.id, {
          sourceName: '',
          amount: -10,
          cadence: 'weekly',
          startDate: '2026-01-01',
          isActive: true,
        })
      ).toThrow(/Invalid income data/);
    });

    it('rejects invalid goal, debt, settings, and income override payloads', () => {
      const budget = db.createBudget({ name: 'Validation Budget' });
      const bill = db.createBillEntry(budget.id, {
        creditorName: 'Auto Loan',
        budgetedAmount: 400,
        dueDay: 10,
        isRecurring: true,
        priority: 'high',
      });

      expect(() =>
        db.createGoal(budget.id, {
          name: '',
          targetAmount: -100,
          targetDate: 'bad-date',
        })
      ).toThrow(/Invalid goal data/);

      expect(() =>
        db.createDebt(budget.id, {
          billId: bill.id,
          principalBalance: -1000,
          apr: -1,
          monthlyPayment: 0,
        })
      ).toThrow(/Invalid debt data/);

      expect(() => db.updateSettings({ autoLockMinutes: -5 })).toThrow(/Invalid settings data/);
      expect(() => db.setIncomeOverride(budget.id, 'income-1', '2026-02-01', -1)).toThrow(
        'Income override amount must be a non-negative number'
      );
    });

    it('returns null or false for missing income and bill updates', () => {
      const budget = db.createBudget({ name: 'Edge Case Budget' });
      const income = db.createIncome(budget.id, {
        sourceName: 'Salary',
        amount: 2000,
        cadence: 'biweekly',
        startDate: '2026-01-01',
        isActive: true,
      });
      const bill = db.createBillEntry(budget.id, {
        creditorName: 'Rent',
        budgetedAmount: 1000,
        dueDay: 1,
        isRecurring: true,
        priority: 'critical',
      });

      expect(
        db.updateIncome('missing-income', budget.id, {
          sourceName: 'X',
          amount: 1,
          cadence: 'weekly',
          startDate: '2026-01-01',
          isActive: true,
        })
      ).toBeNull();
      expect(db.deleteIncome('missing-income', budget.id)).toBe(false);
      expect(
        db.updateBillEntry('missing-bill', budget.id, {
          creditorName: 'X',
          budgetedAmount: 1,
          dueDay: 1,
          isRecurring: true,
          priority: 'normal',
        })
      ).toBeNull();
      expect(db.deleteBillEntry('missing-bill', budget.id)).toBe(false);

      expect(db.deleteIncome(income.id, budget.id)).toBe(true);
      expect(db.deleteBillEntry(bill.id, budget.id)).toBe(true);
      expect(db.getAllIncomes(budget.id)).toHaveLength(0);
      expect(db.getAllBills(budget.id)).toHaveLength(0);
    });

    it('returns budget stats and assignment lookups', () => {
      const budget = db.createBudget({ name: 'Stats Budget' });
      db.createIncome(budget.id, {
        sourceName: 'Salary',
        amount: 3000,
        cadence: 'monthly',
        startDate: '2026-01-01',
        isActive: true,
      });
      const bill = db.createBillEntry(budget.id, {
        creditorName: 'Rent',
        budgetedAmount: 1200,
        dueDay: 1,
        isRecurring: true,
        priority: 'critical',
      });
      db.assignBillToPaycheck(budget.id, bill.id, '2026-02-01', '2026-01-29');

      expect(db.getBudgetStats(budget.id)).toEqual({ incomeCount: 1, billCount: 1 });
      expect(db.getAllBudgetsWithStats().some(
        (entry) => entry.id === budget.id && entry.incomeCount === 1 && entry.billCount === 1
      )).toBe(true);
      expect(db.getBillAssignments(budget.id)).toHaveLength(1);
      expect(db.getBillAssignment(budget.id, bill.id, '2026-02-01')).toEqual(
        expect.objectContaining({ paycheckDate: '2026-01-29' })
      );
      expect(db.removeBillAssignment(budget.id, bill.id, '2026-02-01')).toBe(true);
      expect(db.getBillAssignment(budget.id, bill.id, '2026-02-01')).toBeNull();
    });

    it('finds debt by linked bill id', () => {
      const budget = db.createBudget({ name: 'Debt Lookup Budget' });
      const bill = db.createBillEntry(budget.id, {
        creditorName: 'Card',
        budgetedAmount: 200,
        dueDay: 10,
        isRecurring: true,
        priority: 'normal',
      });
      const debt = db.createDebt(budget.id, {
        billId: bill.id,
        principalBalance: 1500,
        apr: 18,
        monthlyPayment: 75,
      });

      expect(db.getDebtByBillId(bill.id, budget.id)).toEqual(
        expect.objectContaining({ id: debt.id, billId: bill.id })
      );
    });

    it('rejects rename to an existing budget name', () => {
      const alpha = db.createBudget({ name: 'Alpha Budget' });
      db.createBudget({ name: 'Beta Budget' });
      expect(() => db.updateBudget(alpha.id, { name: 'beta budget' })).toThrow('Budget name already exists');
    });

    it('defaults scheduleStartDate when omitted on create', () => {
      const created = db.createBudget({ name: 'Default Schedule' });
      expect(created.scheduleStartDate).toMatch(/^\d{4}-\d{2}-01$/);
    });

    it('deletes income overrides when income is removed', () => {
      const budget = db.createBudget({ name: 'Override Cleanup' });
      const income = db.createIncome(budget.id, {
        sourceName: 'Salary',
        amount: 3000,
        cadence: 'monthly',
        startDate: '2026-01-01',
        isActive: true,
      });
      db.setIncomeOverride(budget.id, income.id, '2026-01-29', 3200);
      expect(db.getIncomeOverrides(budget.id)).toHaveLength(1);

      expect(db.deleteIncome(income.id, budget.id)).toBe(true);
      expect(db.getIncomeOverrides(budget.id)).toHaveLength(0);
    });

    it('falls back to raw settings value when JSON parse fails', () => {
      const internalDb = (db as unknown as { db: { prepare: (sql: string) => { run: (...args: unknown[]) => void } } }).db;
      internalDb.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
        'theme',
        'dark-mode'
      );
      expect(db.getSettings().theme).toBe('dark-mode');
    });
  });
});
