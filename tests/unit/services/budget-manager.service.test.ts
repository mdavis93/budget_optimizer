import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BudgetManager } from '../../../electron/services/budget-manager.service';
import { CryptoService } from '../../../electron/services/crypto.service';
import { DatabaseService } from '../../../electron/services/database.service';

vi.mock('../../../electron/services/logger.service', () => ({
  budgetLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  databaseLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('electron', () => ({
  app: {
    getPath: () => path.join(os.tmpdir(), 'budget-optimizer-budget-manager-userdata'),
  },
}));

const baseBudget = {
  id: 'budget-1',
  name: 'Main',
  startingBalance: 1000,
  targetCashOnHand: 250,
  minCashOnHand: 100,
  minSavingsPerPaycheck: 0,
  scheduleStartDate: '2026-04-01',
  createdAt: '2026-04-10T00:00:00.000Z',
  updatedAt: '2026-04-10T00:00:00.000Z',
};

const quickBudget = {
  id: 'quick-budget-1',
  name: 'Quick Budget',
  startingBalance: 0,
  targetCashOnHand: 250,
  minCashOnHand: 100,
  minSavingsPerPaycheck: 0,
  scheduleStartDate: '2026-04-01',
  createdAt: '2026-04-10T00:00:00.000Z',
  updatedAt: '2026-04-10T00:00:00.000Z',
};

function createDatabaseMock(budget: typeof baseBudget) {
  return {
    getBudgetById: vi.fn((id: string) => (id === budget.id ? { ...budget } : null)),
    getAllBudgets: vi.fn(() => [{ ...budget }]),
    createBudget: vi.fn((input: Record<string, unknown>) => ({ ...budget, ...input, id: 'budget-created' })),
    deleteBudget: vi.fn(() => true),
    getBudgetStats: vi.fn(() => ({ incomeCount: 0, billCount: 0 })),
    getAllBudgetsWithStats: vi.fn(() => []),
    updateBudget: vi.fn((id: string, input: Record<string, unknown>) => ({ ...budget, id, ...input })),
    getAllIncomes: vi.fn(() => []),
    getAllBills: vi.fn(() => []),
    getAllGoals: vi.fn(() => []),
    getSkippedBills: vi.fn(() => []),
    getBillAssignments: vi.fn(() => []),
    getIncomeOverrides: vi.fn(() => []),
    getIncomeById: vi.fn(() => null),
    createIncome: vi.fn((budgetId: string, income: unknown) => ({ id: 'db-income', budgetId, ...income })),
    updateIncome: vi.fn(() => ({ id: 'db-income-updated' })),
    deleteIncome: vi.fn(() => true),
    getBillById: vi.fn(() => null),
    createBillEntry: vi.fn((budgetId: string, bill: unknown) => ({ id: 'db-bill', budgetId, ...bill })),
    updateBillEntry: vi.fn(() => ({ id: 'db-bill-updated' })),
    deleteBillEntry: vi.fn(() => true),
    skipBill: vi.fn((budgetId: string, billId: string, skipDate: string) => ({ budgetId, billId, skipDate })),
    unskipBill: vi.fn(() => true),
    isSkipped: vi.fn(() => false),
    assignBillToPaycheck: vi.fn(
      (budgetId: string, billId: string, billDueDate: string, paycheckDate: string) => ({
        budgetId,
        billId,
        billDueDate,
        paycheckDate,
      })
    ),
    removeBillAssignment: vi.fn(() => true),
    getBillAssignment: vi.fn(() => null),
    setIncomeOverride: vi.fn((budgetId: string, incomeId: string, paycheckDate: string, amount: number) => ({
      budgetId,
      incomeId,
      paycheckDate,
      amount,
    })),
    removeIncomeOverride: vi.fn(() => true),
    getGoalById: vi.fn(() => null),
    createGoal: vi.fn((budgetId: string, goal: unknown) => ({ id: 'db-goal', budgetId, ...goal })),
    updateGoal: vi.fn(() => ({ id: 'db-goal-updated' })),
    deleteGoal: vi.fn(() => true),
    getDebts: vi.fn(() => []),
    getDebtById: vi.fn(() => null),
    getDebtByBillId: vi.fn(() => null),
    createDebt: vi.fn((budgetId: string, input: unknown) => ({ id: 'db-debt', budgetId, ...input })),
    updateDebt: vi.fn(() => ({ id: 'db-debt-updated' })),
    deleteDebt: vi.fn(() => true),
    getLeaves: vi.fn(() => []),
    createLeave: vi.fn((budgetId: string, input: unknown) => ({ id: 'db-leave', budgetId, ...input })),
    updateLeave: vi.fn(() => ({ id: 'db-leave-updated' })),
    deleteLeave: vi.fn(() => true),
    getBudgetSnapshot: vi.fn(() => ({
      incomes: [],
      bills: [],
      goals: [],
      skippedBills: [],
      billAssignments: [],
      incomeOverrides: [],
      debts: [],
      leaves: [],
      budget,
    })),
    close: vi.fn(),
    getCryptoService: vi.fn(() => ({})),
  };
}

async function createCrypto(): Promise<CryptoService> {
  const crypto = new CryptoService();
  const salt = crypto.generateSalt();
  crypto.setEncryptionKey(await crypto.deriveKey('test-password', salt));
  return crypto;
}

describe('BudgetManager', () => {
  let database: ReturnType<typeof createDatabaseMock>;
  let ephemeral: ReturnType<typeof createDatabaseMock>;
  let scratchDir: string;
  let manager: BudgetManager;

  beforeEach(() => {
    scratchDir = path.join(os.tmpdir(), `qb-scratch-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    database = createDatabaseMock(baseBudget);
    ephemeral = createDatabaseMock(quickBudget);
    ephemeral.createBudget = vi.fn(() => ({ ...quickBudget }));
    manager = new BudgetManager(database as never, {
      createEphemeralDatabase: vi.fn(() => ephemeral as never),
      resolveScratchDir: () => scratchDir,
    });
  });

  afterEach(() => {
    fs.rmSync(scratchDir, { recursive: true, force: true });
  });

  describe('happy', () => {
    it('returns defaults when no budget is selected', () => {
      expect(manager.getStartingBalance()).toBe(0);
      expect(manager.getTargetCashOnHand()).toBe(250);
      expect(manager.getMinCashOnHand()).toBe(100);
      expect(manager.getMinSavingsPerPaycheck()).toBe(0);
      expect(manager.getScheduleStartDate()).toMatch(/^\d{4}-\d{2}-01$/);
      expect(manager.getAllIncomes()).toEqual([]);
      expect(manager.getAllBills()).toEqual([]);
      expect(manager.getAllGoals()).toEqual([]);
      expect(manager.getSkippedBills()).toEqual([]);
      expect(manager.getBillAssignments()).toEqual([]);
      expect(manager.getIncomeOverrides()).toEqual([]);
    });

    it('uses quick budget state instead of persisted budget values', () => {
      manager.setCurrentBudget('budget-1');
      expect(manager.getStartingBalance()).toBe(1000);

      manager.startQuickBudget();
      manager.setStartingBalance(123);
      expect(manager.getStartingBalance()).toBe(123);
      expect(database.updateBudget).not.toHaveBeenCalled();
      expect(ephemeral.updateBudget).toHaveBeenCalledWith('quick-budget-1', { startingBalance: 123 });
    });

    it('switches current budget and exits quick mode', () => {
      manager.startQuickBudget();
      const switched = manager.setCurrentBudget('budget-1');

      expect(switched?.id).toBe('budget-1');
      expect(manager.isQuickBudget()).toBe(false);
      expect(manager.getCurrentBudgetId()).toBe('budget-1');
    });

    it('returns persisted scheduleStartDate for current budget', () => {
      manager.setCurrentBudget('budget-1');
      expect(manager.getScheduleStartDate()).toBe('2026-04-01');
    });

    it('persists allocation settings through database in normal mode', () => {
      manager.setCurrentBudget('budget-1');
      manager.setStartingBalance(1500);
      manager.setTargetCashOnHand(400);
      manager.setMinCashOnHand(75);
      manager.setMinSavingsPerPaycheck(25);

      expect(database.updateBudget).toHaveBeenCalledWith('budget-1', { startingBalance: 1500 });
      expect(database.updateBudget).toHaveBeenCalledWith('budget-1', { targetCashOnHand: 400 });
      expect(database.updateBudget).toHaveBeenCalledWith('budget-1', { minCashOnHand: 75 });
      expect(database.updateBudget).toHaveBeenCalledWith('budget-1', { minSavingsPerPaycheck: 25 });
    });

    it('exposes current state and ends quick budget mode', () => {
      manager.startQuickBudget();
      expect(manager.getCurrentState()).toEqual({ budgetId: 'quick-budget-1', isQuickBudget: true });

      manager.endQuickBudget();
      expect(manager.isQuickBudget()).toBe(false);
      expect(manager.getCurrentState()).toEqual({ budgetId: null, isQuickBudget: false });
      expect(ephemeral.close).toHaveBeenCalled();
    });

    it('routes income operations to database when not in quick mode', () => {
      manager.setCurrentBudget('budget-1');
      const incomeInput = {
        sourceName: 'Salary',
        amount: 2500,
        cadence: 'biweekly' as const,
        startDate: '2026-01-01',
        isActive: true,
      };

      manager.createIncome(incomeInput);
      manager.updateIncome('inc-1', incomeInput);
      manager.deleteIncome('inc-1');
      manager.getAllIncomes();
      manager.getIncomeById('inc-1');

      expect(database.createIncome).toHaveBeenCalledWith('budget-1', incomeInput);
      expect(database.updateIncome).toHaveBeenCalledWith('inc-1', 'budget-1', incomeInput);
      expect(database.deleteIncome).toHaveBeenCalledWith('inc-1', 'budget-1');
      expect(database.getAllIncomes).toHaveBeenCalledWith('budget-1');
      expect(database.getIncomeById).toHaveBeenCalledWith('inc-1', 'budget-1');
    });

    it('routes bill operations to database when not in quick mode', () => {
      manager.setCurrentBudget('budget-1');
      const billInput = {
        creditorName: 'Rent',
        budgetedAmount: 1500,
        dueDay: 1,
        isRecurring: true,
        priority: 'critical' as const,
      };

      manager.createBill(billInput);
      manager.updateBill('bill-1', billInput);
      manager.deleteBill('bill-1');
      manager.getAllBills();
      manager.getBillById('bill-1');

      expect(database.createBillEntry).toHaveBeenCalledWith('budget-1', billInput);
      expect(database.updateBillEntry).toHaveBeenCalledWith('bill-1', 'budget-1', billInput);
      expect(database.deleteBillEntry).toHaveBeenCalledWith('bill-1', 'budget-1');
      expect(database.getAllBills).toHaveBeenCalledWith('budget-1');
      expect(database.getBillById).toHaveBeenCalledWith('bill-1', 'budget-1');
    });

    it('routes goal operations to database when not in quick mode', () => {
      manager.setCurrentBudget('budget-1');
      const goalInput = {
        name: 'Trip',
        targetAmount: 3000,
        targetDate: '2027-01-01',
      };

      manager.createGoal(goalInput);
      manager.updateGoal('goal-1', { alreadySaved: 100 });
      manager.deleteGoal('goal-1');
      manager.getAllGoals();
      manager.getGoalById('goal-1');

      expect(database.createGoal).toHaveBeenCalledWith('budget-1', goalInput);
      expect(database.updateGoal).toHaveBeenCalledWith('goal-1', 'budget-1', { alreadySaved: 100 });
      expect(database.deleteGoal).toHaveBeenCalledWith('goal-1', 'budget-1');
      expect(database.getAllGoals).toHaveBeenCalledWith('budget-1');
      expect(database.getGoalById).toHaveBeenCalledWith('goal-1', 'budget-1');
    });

    it('routes income/bill/goal operations to the ephemeral database in quick mode', () => {
      manager.startQuickBudget();
      manager.createIncome({
        sourceName: 'Gig',
        amount: 300,
        cadence: 'weekly',
        startDate: '2026-01-01',
        isActive: true,
      });
      manager.updateIncome('q-inc', {
        sourceName: 'Gig',
        amount: 300,
        cadence: 'weekly',
        startDate: '2026-01-01',
        isActive: true,
      });
      manager.deleteIncome('q-inc');
      manager.getAllIncomes();
      manager.getIncomeById('q-inc');

      manager.createBill({
        creditorName: 'Phone',
        budgetedAmount: 80,
        dueDay: 10,
        isRecurring: true,
        priority: 'normal',
      });
      manager.updateBill('q-bill', {
        creditorName: 'Phone',
        budgetedAmount: 80,
        dueDay: 10,
        isRecurring: true,
        priority: 'normal',
      });
      manager.deleteBill('q-bill');
      manager.getAllBills();
      manager.getBillById('q-bill');

      manager.createGoal({ name: 'New Laptop', targetAmount: 2000, targetDate: '2027-01-01' });
      manager.updateGoal('q-goal', { targetAmount: 2100 });
      manager.deleteGoal('q-goal');
      manager.getAllGoals();
      manager.getGoalById('q-goal');

      expect(ephemeral.createIncome).toHaveBeenCalled();
      expect(ephemeral.updateIncome).toHaveBeenCalled();
      expect(ephemeral.deleteIncome).toHaveBeenCalledWith('q-inc', 'quick-budget-1');
      expect(database.createIncome).not.toHaveBeenCalled();

      expect(ephemeral.createBillEntry).toHaveBeenCalled();
      expect(ephemeral.updateBillEntry).toHaveBeenCalled();
      expect(ephemeral.deleteBillEntry).toHaveBeenCalledWith('q-bill', 'quick-budget-1');
      expect(database.createBillEntry).not.toHaveBeenCalled();

      expect(ephemeral.createGoal).toHaveBeenCalled();
      expect(ephemeral.updateGoal).toHaveBeenCalled();
      expect(ephemeral.deleteGoal).toHaveBeenCalledWith('q-goal', 'quick-budget-1');
      expect(database.createGoal).not.toHaveBeenCalled();
    });

    it('routes budget-level settings through database in normal mode', () => {
      manager.setCurrentBudget('budget-1');
      manager.setStartingBalance(1500);
      manager.setTargetCashOnHand(600);
      manager.setMinCashOnHand(200);
      manager.setMinSavingsPerPaycheck(75);

      expect(database.updateBudget).toHaveBeenCalledWith('budget-1', { startingBalance: 1500 });
      expect(database.updateBudget).toHaveBeenCalledWith('budget-1', { targetCashOnHand: 600 });
      expect(database.updateBudget).toHaveBeenCalledWith('budget-1', { minCashOnHand: 200 });
      expect(database.updateBudget).toHaveBeenCalledWith('budget-1', { minSavingsPerPaycheck: 75 });
    });

    it('routes skipped bills, assignments, and overrides through database', () => {
      database.skipBill = vi.fn((budgetId: string, billId: string, skipDate: string) => ({ budgetId, billId, skipDate }));
      database.unskipBill = vi.fn(() => true);
      database.isSkipped = vi.fn(() => true);
      database.assignBillToPaycheck = vi.fn((budgetId: string, billId: string, billDueDate: string, paycheckDate: string) => ({
        budgetId, billId, billDueDate, paycheckDate,
      }));
      database.removeBillAssignment = vi.fn(() => true);
      database.getBillAssignment = vi.fn(() => ({ billId: 'bill-1', billDueDate: '2026-01-15', paycheckDate: '2026-01-01' }));
      database.setIncomeOverride = vi.fn((budgetId: string, incomeId: string, paycheckDate: string, amount: number) => ({
        budgetId, incomeId, paycheckDate, amount,
      }));
      database.removeIncomeOverride = vi.fn(() => true);

      manager.setCurrentBudget('budget-1');
      expect(manager.skipBill('bill-1', '2026-01-15')).toEqual(
        expect.objectContaining({ billId: 'bill-1', skipDate: '2026-01-15' })
      );
      expect(manager.unskipBill('bill-1', '2026-01-15')).toBe(true);
      expect(manager.isSkipped('bill-1', '2026-01-15')).toBe(true);
      expect(manager.assignBillToPaycheck('bill-1', '2026-01-15', '2026-01-01')).toEqual(
        expect.objectContaining({ billId: 'bill-1', billDueDate: '2026-01-15' })
      );
      expect(manager.removeBillAssignment('bill-1', '2026-01-15')).toBe(true);
      expect(manager.getBillAssignment('bill-1', '2026-01-15')).toEqual(
        expect.objectContaining({ billId: 'bill-1' })
      );
      expect(manager.setIncomeOverride('income-1', '2026-01-01', 123)).toEqual(
        expect.objectContaining({ incomeId: 'income-1', amount: 123 })
      );
      expect(manager.removeIncomeOverride('income-1', '2026-01-01')).toBe(true);
    });

    it('routes budget CRUD and stats accessors to database', () => {
      expect(manager.getAllBudgets()).toEqual([baseBudget]);
      expect(manager.getBudgetById('budget-1')).toEqual(baseBudget);
      expect(manager.createBudget({ name: 'New Budget' })).toEqual(
        expect.objectContaining({ id: 'budget-created', name: 'New Budget' })
      );
      expect(manager.updateBudget('budget-1', { name: 'Updated' })).toEqual(
        expect.objectContaining({ id: 'budget-1' })
      );
      expect(manager.deleteBudget('budget-2')).toBe(true);
      expect(manager.getBudgetStats('budget-1')).toEqual({ incomeCount: 0, billCount: 0 });
      expect(manager.getAllBudgetsWithStats()).toEqual([]);
    });

    it('returns ephemeral current budget id and writes allocation settings to the scratch db', () => {
      manager.setCurrentBudget('budget-1');
      manager.startQuickBudget();

      expect(manager.getCurrentBudgetId()).toBe('quick-budget-1');

      manager.setStartingBalance(250);
      manager.setTargetCashOnHand(400);
      manager.setMinCashOnHand(150);
      manager.setMinSavingsPerPaycheck(25);

      expect(ephemeral.updateBudget).toHaveBeenCalledWith('quick-budget-1', { startingBalance: 250 });
      expect(ephemeral.updateBudget).toHaveBeenCalledWith('quick-budget-1', { targetCashOnHand: 400 });
      expect(ephemeral.updateBudget).toHaveBeenCalledWith('quick-budget-1', { minCashOnHand: 150 });
      expect(ephemeral.updateBudget).toHaveBeenCalledWith('quick-budget-1', { minSavingsPerPaycheck: 25 });
      expect(database.updateBudget).not.toHaveBeenCalled();
      expect(manager.getAllBudgets()).toEqual([baseBudget]);
      expect(database.getAllBudgets).toHaveBeenCalled();
    });

    it('routes skipped bills, assignments, and overrides to the ephemeral database', () => {
      ephemeral.getSkippedBills = vi.fn(() => [{ billId: 'bill-1', skipDate: '2026-01-01' }]);
      ephemeral.isSkipped = vi.fn(() => true);
      ephemeral.getBillAssignment = vi.fn(() => ({
        billId: 'bill-1',
        billDueDate: '2026-01-01',
        paycheckDate: '2025-12-20',
      }));
      ephemeral.getBillAssignments = vi.fn(() => [
        { billId: 'bill-1', billDueDate: '2026-01-01', paycheckDate: '2025-12-20' },
      ]);
      ephemeral.getIncomeOverrides = vi.fn(() => [
        { incomeId: 'income-1', paycheckDate: '2026-01-01', amount: 500 },
      ]);

      manager.startQuickBudget();
      expect(manager.getSkippedBills()).toEqual([{ billId: 'bill-1', skipDate: '2026-01-01' }]);
      expect(manager.skipBill('bill-1', '2026-01-01')).toEqual(
        expect.objectContaining({ billId: 'bill-1', skipDate: '2026-01-01' })
      );
      expect(manager.unskipBill('bill-1', '2026-01-01')).toBe(true);
      expect(manager.isSkipped('bill-1', '2026-01-01')).toBe(true);
      expect(manager.getBillAssignments()).toEqual([
        { billId: 'bill-1', billDueDate: '2026-01-01', paycheckDate: '2025-12-20' },
      ]);
      expect(manager.assignBillToPaycheck('bill-1', '2026-01-01', '2025-12-20')).toEqual(
        expect.objectContaining({ billId: 'bill-1' })
      );
      expect(manager.removeBillAssignment('bill-1', '2026-01-01')).toBe(true);
      expect(manager.getBillAssignment('bill-1', '2026-01-01')).toEqual(
        expect.objectContaining({ billId: 'bill-1' })
      );
      expect(manager.getIncomeOverrides()).toEqual([
        { incomeId: 'income-1', paycheckDate: '2026-01-01', amount: 500 },
      ]);
      expect(manager.setIncomeOverride('income-1', '2026-01-01', 500)).toEqual(
        expect.objectContaining({ incomeId: 'income-1', amount: 500 })
      );
      expect(manager.removeIncomeOverride('income-1', '2026-01-01')).toBe(true);
      expect(database.skipBill).not.toHaveBeenCalled();
      expect(ephemeral.skipBill).toHaveBeenCalledWith('quick-budget-1', 'bill-1', '2026-01-01');
    });

    it('routes debt and leave operations to the vault when not in quick mode', () => {
      manager.setCurrentBudget('budget-1');
      const debtInput = {
        billId: 'bill-1',
        principalBalance: 1000,
        apr: 10,
        monthlyPayment: 50,
      };
      const leaveInput = {
        incomeId: 'income-1',
        name: 'Medical',
        type: 'unpaid' as const,
        startDate: '2026-02-01',
        endDate: '2026-02-14',
      };

      manager.createDebt(debtInput);
      manager.updateDebt('debt-1', { apr: 12 });
      manager.getDebts();
      manager.getDebtById('debt-1');
      manager.getDebtByBillId('bill-1');
      manager.deleteDebt('debt-1');
      manager.createLeave(leaveInput);
      manager.updateLeave('leave-1', leaveInput);
      manager.getLeaves();
      manager.deleteLeave('leave-1');

      expect(database.createDebt).toHaveBeenCalledWith('budget-1', debtInput);
      expect(database.updateDebt).toHaveBeenCalledWith('debt-1', 'budget-1', { apr: 12 });
      expect(database.getDebts).toHaveBeenCalledWith('budget-1');
      expect(database.deleteDebt).toHaveBeenCalledWith('debt-1', 'budget-1');
      expect(database.createLeave).toHaveBeenCalledWith('budget-1', leaveInput);
      expect(database.getLeaves).toHaveBeenCalledWith('budget-1');
      expect(database.deleteLeave).toHaveBeenCalledWith('leave-1', 'budget-1');
    });
  });

  describe('sad', () => {
    it('returns null when switching to unknown budget', () => {
      expect(manager.setCurrentBudget('missing-budget')).toBeNull();
      expect(manager.getCurrentBudgetId()).toBeNull();
    });

    it('returns null/false defaults for income, bill, and goal operations without current budget', () => {
      expect(manager.getIncomeById('inc-1')).toBeNull();
      expect(manager.updateIncome('inc-1', {
        sourceName: 'Salary',
        amount: 1000,
        cadence: 'monthly',
        startDate: '2026-01-01',
        isActive: true,
      })).toBeNull();
      expect(manager.deleteIncome('inc-1')).toBe(false);

      expect(manager.getBillById('bill-1')).toBeNull();
      expect(manager.updateBill('bill-1', {
        creditorName: 'Rent',
        budgetedAmount: 1000,
        dueDay: 1,
        isRecurring: true,
        priority: 'critical',
      })).toBeNull();
      expect(manager.deleteBill('bill-1')).toBe(false);

      expect(manager.getGoalById('goal-1')).toBeNull();
      expect(manager.updateGoal('goal-1', { name: 'Goal' })).toBeNull();
      expect(manager.deleteGoal('goal-1')).toBe(false);
    });
  });

  describe('hostile', () => {
    it('does not delete currently selected budget', () => {
      manager.setCurrentBudget('budget-1');
      expect(manager.deleteBudget('budget-1')).toBe(false);
    });

    it('falls back to created month when scheduleStartDate is missing', () => {
      database.getBudgetById.mockReturnValueOnce({
        ...baseBudget,
        scheduleStartDate: undefined,
      });
      manager.setCurrentBudget('budget-1');

      expect(manager.getScheduleStartDate()).toBe('2026-04-01');
    });

    it('throws on create income/bill/goal without selected budget', () => {
      expect(() =>
        manager.createIncome({
          sourceName: 'Salary',
          amount: 1000,
          cadence: 'monthly',
          startDate: '2026-01-01',
          isActive: true,
        })
      ).toThrow('No budget selected');

      expect(() =>
        manager.createBill({
          creditorName: 'Rent',
          budgetedAmount: 1000,
          dueDay: 1,
          isRecurring: true,
          priority: 'critical',
        })
      ).toThrow('No budget selected');

      expect(() =>
        manager.createGoal({
          name: 'Emergency Fund',
          targetAmount: 1000,
          targetDate: '2026-12-01',
        })
      ).toThrow('No budget selected');
    });

    it('returns false schedule helpers without selected budget', () => {
      expect(manager.unskipBill('bill-1', '2026-01-01')).toBe(false);
      expect(manager.removeBillAssignment('bill-1', '2026-01-01')).toBe(false);
      expect(manager.removeIncomeOverride('income-1', '2026-01-01')).toBe(false);
      expect(manager.isSkipped('bill-1', '2026-01-01')).toBe(false);
      expect(manager.getBillAssignment('bill-1', '2026-01-01')).toBeNull();
    });

    it('returns zero starting balance when budget record is missing', () => {
      manager.setCurrentBudget('budget-1');
      // Empty the cache (update returns no record), then the DB no longer has it.
      database.updateBudget.mockReturnValueOnce(null);
      manager.setStartingBalance(500);
      database.getBudgetById.mockReturnValue(null);

      expect(manager.getStartingBalance()).toBe(0);
    });

    it('no-ops allocation setters when no budget is selected', () => {
      manager.setStartingBalance(500);
      manager.setTargetCashOnHand(300);
      manager.setMinCashOnHand(200);
      manager.setMinSavingsPerPaycheck(50);

      expect(database.updateBudget).not.toHaveBeenCalled();
    });

    it('throws on schedule-domain write operations without budget', () => {
      expect(() => manager.skipBill('bill-1', '2026-01-01')).toThrow('No budget selected');
      expect(() => manager.assignBillToPaycheck('bill-1', '2026-01-02', '2026-01-01')).toThrow(
        'No budget selected'
      );
      expect(() => manager.setIncomeOverride('income-1', '2026-01-01', 100)).toThrow('No budget selected');
    });

    it('updates and deletes non-current budgets through database', () => {
      database.updateBudget.mockReturnValueOnce({ ...baseBudget, id: 'budget-2', name: 'Updated' });
      database.deleteBudget.mockReturnValueOnce(true);
      manager.setCurrentBudget('budget-1');

      expect(manager.updateBudget('budget-2', { name: 'Updated' })?.name).toBe('Updated');
      expect(manager.deleteBudget('budget-2')).toBe(true);
      expect(database.deleteBudget).toHaveBeenCalledWith('budget-2');
    });
  });

  describe('current-budget cache', () => {
    it('reads the budget once across repeated settings getters', () => {
      manager.setCurrentBudget('budget-1');
      expect(database.getBudgetById).toHaveBeenCalledTimes(1);

      manager.getStartingBalance();
      manager.getTargetCashOnHand();
      manager.getMinCashOnHand();
      manager.getMinSavingsPerPaycheck();
      manager.getScheduleStartDate();
      manager.getStartingBalance();

      expect(database.getBudgetById).toHaveBeenCalledTimes(1);
      expect(manager.getStartingBalance()).toBe(1000);
    });

    it('serves the fresh value after a settings write without an extra read', () => {
      manager.setCurrentBudget('budget-1');
      expect(database.getBudgetById).toHaveBeenCalledTimes(1);

      database.updateBudget.mockReturnValueOnce({ ...baseBudget, startingBalance: 2000 });
      manager.setStartingBalance(2000);

      expect(manager.getStartingBalance()).toBe(2000);
      expect(database.getBudgetById).toHaveBeenCalledTimes(1);
    });

    it('updates the cache after updateBudget on the current budget', () => {
      manager.setCurrentBudget('budget-1');
      database.updateBudget.mockReturnValueOnce({ ...baseBudget, targetCashOnHand: 999 });

      manager.updateBudget('budget-1', { targetCashOnHand: 999 });

      expect(manager.getTargetCashOnHand()).toBe(999);
      expect(database.getBudgetById).toHaveBeenCalledTimes(1);
    });

    it('leaves the cache intact when a non-current budget is updated', () => {
      manager.setCurrentBudget('budget-1');
      database.updateBudget.mockReturnValueOnce({ ...baseBudget, id: 'budget-2', targetCashOnHand: 5 });

      manager.updateBudget('budget-2', { targetCashOnHand: 5 });

      expect(manager.getTargetCashOnHand()).toBe(250);
      expect(database.getBudgetById).toHaveBeenCalledTimes(1);
    });

    it('refetches from the database when the cache is emptied', () => {
      manager.setCurrentBudget('budget-1');
      database.updateBudget.mockReturnValueOnce(null);
      manager.setMinCashOnHand(50);
      database.getBudgetById.mockReturnValue({ ...baseBudget, minCashOnHand: 77 });

      expect(manager.getMinCashOnHand()).toBe(77);
      expect(database.getBudgetById).toHaveBeenCalledTimes(2);
    });

    it('clears the cache on quick-budget transitions and re-reads on reselect', () => {
      manager.setCurrentBudget('budget-1');
      expect(database.getBudgetById).toHaveBeenCalledTimes(1);

      manager.startQuickBudget();
      manager.endQuickBudget();
      manager.setCurrentBudget('budget-1');

      expect(database.getBudgetById).toHaveBeenCalledTimes(2);
      expect(manager.getTargetCashOnHand()).toBe(250);
      expect(database.getBudgetById).toHaveBeenCalledTimes(2);
    });
  });

  describe('ephemeral sqlite file', () => {
    it('routes debts and leaves through the scratch file without mutating the vault', async () => {
      const root = path.join(os.tmpdir(), `qb-file-${process.pid}-${Date.now()}`);
      const vaultDir = path.join(root, 'vault');
      const scratch = path.join(root, 'quick-budget-scratch');
      fs.mkdirSync(vaultDir, { recursive: true, mode: 0o700 });
      const crypto = await createCrypto();
      const vault = new DatabaseService(crypto, path.join(vaultDir, 'budget-data.db'));
      vault.initialize();
      const named = vault.createBudget({ name: 'Main' });
      const namedBill = vault.createBillEntry(named.id, {
        creditorName: 'Vault Card',
        budgetedAmount: 100,
        dueDay: 1,
        isRecurring: true,
        priority: 'normal',
      });
      vault.createDebt(named.id, {
        billId: namedBill.id,
        principalBalance: 500,
        apr: 8,
        monthlyPayment: 50,
      });
      const namedIncome = vault.createIncome(named.id, {
        sourceName: 'Salary',
        amount: 2000,
        cadence: 'biweekly',
        startDate: '2026-01-01',
        isActive: true,
      });
      vault.createLeave(named.id, {
        incomeId: namedIncome.id,
        name: 'Vault Leave',
        type: 'unpaid',
        startDate: '2026-03-01',
        endDate: '2026-03-05',
      });

      const fileManager = new BudgetManager(vault, { resolveScratchDir: () => scratch });
      fileManager.startQuickBudget();
      expect(fileManager.getCurrentBudgetId()).not.toBeNull();
      expect(fileManager.isQuickBudget()).toBe(true);
      expect(fs.existsSync(path.join(scratch, 'budget.db'))).toBe(true);

      const quickBill = fileManager.createBill({
        creditorName: 'Quick Card',
        budgetedAmount: 80,
        dueDay: 10,
        isRecurring: true,
        priority: 'normal',
      });
      fileManager.createDebt({
        billId: quickBill.id,
        principalBalance: 250,
        apr: 12,
        monthlyPayment: 25,
      });
      const quickIncome = fileManager.createIncome({
        sourceName: 'Gig',
        amount: 400,
        cadence: 'weekly',
        startDate: '2026-01-01',
        isActive: true,
      });
      fileManager.createLeave({
        incomeId: quickIncome.id,
        name: 'Quick Leave',
        type: 'paid',
        startDate: '2026-04-01',
        endDate: '2026-04-03',
      });

      expect(fileManager.getDebts()).toHaveLength(1);
      expect(fileManager.getLeaves()).toHaveLength(1);
      expect(vault.getDebts(named.id)).toHaveLength(1);
      expect(vault.getLeaves(named.id)).toHaveLength(1);
      expect(vault.getAllBudgets().some((budget) => budget.id === named.id)).toBe(true);
      expect(vault.getAllBudgets().some((budget) => budget.name === 'Quick Budget')).toBe(false);

      fileManager.endQuickBudget();
      expect(fs.existsSync(path.join(scratch, 'budget.db'))).toBe(false);
      expect(vault.getDebts(named.id)).toHaveLength(1);
      expect(vault.getLeaves(named.id)).toHaveLength(1);
      vault.close();
      fs.rmSync(root, { recursive: true, force: true });
    });
  });
});
