import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BudgetManager } from '../../../electron/services/budget-manager.service';

describe('BudgetManager', () => {
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

  let database: {
    getBudgetById: ReturnType<typeof vi.fn>;
    getAllBudgets: ReturnType<typeof vi.fn>;
    createBudget: ReturnType<typeof vi.fn>;
    deleteBudget: ReturnType<typeof vi.fn>;
    getBudgetStats: ReturnType<typeof vi.fn>;
    getAllBudgetsWithStats: ReturnType<typeof vi.fn>;
    updateBudget: ReturnType<typeof vi.fn>;
    getAllIncomes: ReturnType<typeof vi.fn>;
    getAllBills: ReturnType<typeof vi.fn>;
    getAllGoals: ReturnType<typeof vi.fn>;
    getSkippedBills: ReturnType<typeof vi.fn>;
    getBillAssignments: ReturnType<typeof vi.fn>;
    getIncomeOverrides: ReturnType<typeof vi.fn>;
    getIncomeById: ReturnType<typeof vi.fn>;
    createIncome: ReturnType<typeof vi.fn>;
    updateIncome: ReturnType<typeof vi.fn>;
    deleteIncome: ReturnType<typeof vi.fn>;
    getBillById: ReturnType<typeof vi.fn>;
    createBillEntry: ReturnType<typeof vi.fn>;
    updateBillEntry: ReturnType<typeof vi.fn>;
    deleteBillEntry: ReturnType<typeof vi.fn>;
    skipBill: ReturnType<typeof vi.fn>;
    unskipBill: ReturnType<typeof vi.fn>;
    isSkipped: ReturnType<typeof vi.fn>;
    assignBillToPaycheck: ReturnType<typeof vi.fn>;
    removeBillAssignment: ReturnType<typeof vi.fn>;
    getBillAssignment: ReturnType<typeof vi.fn>;
    setIncomeOverride: ReturnType<typeof vi.fn>;
    removeIncomeOverride: ReturnType<typeof vi.fn>;
    getGoalById: ReturnType<typeof vi.fn>;
    createGoal: ReturnType<typeof vi.fn>;
    updateGoal: ReturnType<typeof vi.fn>;
    deleteGoal: ReturnType<typeof vi.fn>;
  };
  let manager: BudgetManager;

  beforeEach(() => {
    database = {
      getBudgetById: vi.fn((id: string) => (id === 'budget-1' ? baseBudget : null)),
      getAllBudgets: vi.fn(() => [baseBudget]),
      createBudget: vi.fn((input: unknown) => ({ id: 'budget-created', ...input })),
      deleteBudget: vi.fn(() => true),
      getBudgetStats: vi.fn(() => ({ incomeCount: 0, billCount: 0 })),
      getAllBudgetsWithStats: vi.fn(() => []),
      updateBudget: vi.fn((id: string, input: Record<string, unknown>) => ({ ...baseBudget, id, ...input })),
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
    };
    manager = new BudgetManager(database as never);
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
      expect(manager.getCurrentState()).toEqual({ budgetId: null, isQuickBudget: true });

      manager.endQuickBudget();
      expect(manager.isQuickBudget()).toBe(false);
      expect(manager.getCurrentState()).toEqual({ budgetId: null, isQuickBudget: false });
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

    it('routes income/bill/goal operations to quick service in quick mode', () => {
      const quick = (manager as unknown as { quickBudgetService: Record<string, ReturnType<typeof vi.fn>> }).quickBudgetService;
      quick.createIncome = vi.fn(() => ({ id: 'quick-income' }));
      quick.updateIncome = vi.fn(() => ({ id: 'quick-income' }));
      quick.deleteIncome = vi.fn(() => true);
      quick.getAllIncomes = vi.fn(() => []);
      quick.getIncomeById = vi.fn(() => null);

      quick.createBill = vi.fn(() => ({ id: 'quick-bill' }));
      quick.updateBill = vi.fn(() => ({ id: 'quick-bill' }));
      quick.deleteBill = vi.fn(() => true);
      quick.getAllBills = vi.fn(() => []);
      quick.getBillById = vi.fn(() => null);

      quick.createGoal = vi.fn(() => ({ id: 'quick-goal' }));
      quick.updateGoal = vi.fn(() => ({ id: 'quick-goal' }));
      quick.deleteGoal = vi.fn(() => true);
      quick.getAllGoals = vi.fn(() => []);
      quick.getGoalById = vi.fn(() => null);

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

      expect(quick.createIncome).toHaveBeenCalled();
      expect(quick.updateIncome).toHaveBeenCalled();
      expect(quick.deleteIncome).toHaveBeenCalledWith('q-inc');
      expect(database.createIncome).not.toHaveBeenCalled();

      expect(quick.createBill).toHaveBeenCalled();
      expect(quick.updateBill).toHaveBeenCalled();
      expect(quick.deleteBill).toHaveBeenCalledWith('q-bill');
      expect(database.createBillEntry).not.toHaveBeenCalled();

      expect(quick.createGoal).toHaveBeenCalled();
      expect(quick.updateGoal).toHaveBeenCalled();
      expect(quick.deleteGoal).toHaveBeenCalledWith('q-goal');
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

    it('routes skipped bills, assignments, and overrides to quick mode service', () => {
      const quick = (manager as unknown as { quickBudgetService: Record<string, ReturnType<typeof vi.fn>> }).quickBudgetService;
      quick.skipBill = vi.fn((billId: string, skipDate: string) => ({ billId, skipDate }));
      quick.unskipBill = vi.fn(() => true);
      quick.isSkipped = vi.fn(() => true);
      quick.getSkippedBills = vi.fn(() => [{ billId: 'bill-1', skipDate: '2026-01-01' }]);
      quick.assignBillToPaycheck = vi.fn((billId: string, billDueDate: string, paycheckDate: string) => ({
        billId, billDueDate, paycheckDate,
      }));
      quick.removeBillAssignment = vi.fn(() => true);
      quick.getBillAssignment = vi.fn(() => ({ billId: 'bill-1', billDueDate: '2026-01-01', paycheckDate: '2025-12-20' }));
      quick.getBillAssignments = vi.fn(() => [{ billId: 'bill-1', billDueDate: '2026-01-01', paycheckDate: '2025-12-20' }]);
      quick.setIncomeOverride = vi.fn((incomeId: string, paycheckDate: string, amount: number) => ({
        incomeId, paycheckDate, amount,
      }));
      quick.removeIncomeOverride = vi.fn(() => true);
      quick.getIncomeOverrides = vi.fn(() => [{ incomeId: 'income-1', paycheckDate: '2026-01-01', amount: 500 }]);

      manager.startQuickBudget();
      expect(manager.getSkippedBills()).toEqual([{ billId: 'bill-1', skipDate: '2026-01-01' }]);
      expect(manager.skipBill('bill-1', '2026-01-01')).toEqual({ billId: 'bill-1', skipDate: '2026-01-01' });
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
});
