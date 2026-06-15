import { describe, expect, it } from 'vitest';
import { QuickBudgetService } from '../../../electron/services/quick-budget.service';

describe('QuickBudgetService', () => {
  describe('happy', () => {
    it('creates, reads, updates, and deletes incomes', () => {
      const service = new QuickBudgetService();
      const income = service.createIncome({
        sourceName: 'Consulting',
        amount: 900,
        cadence: 'weekly',
        startDate: '2026-01-01',
        isActive: true,
      });

      expect(service.getIncomeById(income.id)?.sourceName).toBe('Consulting');

      const updated = service.updateIncome(income.id, {
        sourceName: 'Consulting LLC',
        amount: 950,
        cadence: 'weekly',
        startDate: '2026-01-01',
        isActive: true,
      });
      expect(updated?.amount).toBe(950);
      expect(service.deleteIncome(income.id)).toBe(true);
      expect(service.getIncomeById(income.id)).toBeNull();
    });

    it('creates, reads, updates, and deletes bills', () => {
      const service = new QuickBudgetService();
      const bill = service.createBill({
        creditorName: 'Internet',
        budgetedAmount: 80,
        dueDay: 12,
        category: 'Utilities',
        isRecurring: true,
        priority: 'normal',
      });

      expect(service.getBillById(bill.id)?.creditorName).toBe('Internet');

      const updated = service.updateBill(bill.id, {
        creditorName: 'Fiber Internet',
        budgetedAmount: 95,
        dueDay: 12,
        category: 'Utilities',
        isRecurring: true,
        priority: 'normal',
      });
      expect(updated?.budgetedAmount).toBe(95);
      expect(service.deleteBill(bill.id)).toBe(true);
      expect(service.getBillById(bill.id)).toBeNull();
    });

    it('manages skipped bills, assignments, and income overrides', () => {
      const service = new QuickBudgetService();
      const income = service.createIncome({
        sourceName: 'Salary',
        amount: 2500,
        cadence: 'biweekly',
        startDate: '2026-01-01',
        isActive: true,
      });
      const bill = service.createBill({
        creditorName: 'Rent',
        budgetedAmount: 1200,
        dueDay: 1,
        category: 'housing',
        isRecurring: true,
        priority: 'critical',
      });

      const skipped = service.skipBill(bill.id, '2026-02-01');
      expect(service.getSkippedBills()).toEqual([skipped]);
      expect(service.isSkipped(bill.id, '2026-02-01')).toBe(true);
      expect(service.unskipBill(bill.id, '2026-02-01')).toBe(true);
      expect(service.isSkipped(bill.id, '2026-02-01')).toBe(false);

      const assignment = service.assignBillToPaycheck(bill.id, '2026-02-01', '2026-01-31');
      expect(service.getBillAssignments()).toEqual([assignment]);
      expect(service.getBillAssignment(bill.id, '2026-02-01')?.paycheckDate).toBe('2026-01-31');
      expect(service.removeBillAssignment(bill.id, '2026-02-01')).toBe(true);
      expect(service.getBillAssignment(bill.id, '2026-02-01')).toBeNull();

      const override = service.setIncomeOverride(income.id, '2026-01-31', 2400);
      expect(service.getIncomeOverrides()).toEqual([override]);
      expect(service.removeIncomeOverride(income.id, '2026-01-31')).toBe(true);
      expect(service.getIncomeOverrides()).toEqual([]);
    });

    it('manages goals and budget-level settings', () => {
      const service = new QuickBudgetService();

      service.setStartingBalance(1200);
      service.setTargetCashOnHand(500);
      service.setMinCashOnHand(200);
      service.setMinSavingsPerPaycheck(75);
      service.setScheduleStartDate('2026-03-01');

      expect(service.getStartingBalance()).toBe(1200);
      expect(service.getTargetCashOnHand()).toBe(500);
      expect(service.getMinCashOnHand()).toBe(200);
      expect(service.getMinSavingsPerPaycheck()).toBe(75);
      expect(service.getScheduleStartDate()).toBe('2026-03-01');

      const goal1 = service.createGoal({
        name: 'Emergency Fund',
        targetAmount: 5000,
        targetDate: '2026-12-31',
        alreadySaved: 500,
        priority: 2,
      });
      const goal2 = service.createGoal({
        name: 'Vacation',
        targetAmount: 3000,
        targetDate: '2026-10-31',
        alreadySaved: 100,
        priority: 1,
      });

      expect(service.getGoalById(goal1.id)?.name).toBe('Emergency Fund');
      expect(service.getAllGoals().map((g) => g.id)).toEqual([goal2.id, goal1.id]);

      const updatedGoal = service.updateGoal(goal1.id, { name: 'Emergency Fund Plus', priority: 3 });
      expect(updatedGoal?.name).toBe('Emergency Fund Plus');
      expect(updatedGoal?.priority).toBe(3);
      expect(service.deleteGoal(goal2.id)).toBe(true);
      expect(service.getGoalById(goal2.id)).toBeNull();
    });

    it('clears all quick-budget state', () => {
      const service = new QuickBudgetService();
      const income = service.createIncome({
        sourceName: 'Consulting',
        amount: 1000,
        cadence: 'weekly',
        startDate: '2026-01-01',
        isActive: true,
      });
      const bill = service.createBill({
        creditorName: 'Internet',
        budgetedAmount: 90,
        dueDay: 10,
        category: 'utilities',
        isRecurring: true,
        priority: 'normal',
      });
      service.skipBill(bill.id, '2026-02-10');
      service.assignBillToPaycheck(bill.id, '2026-02-10', '2026-02-07');
      service.setIncomeOverride(income.id, '2026-02-07', 800);
      service.createGoal({
        name: 'Trip',
        targetAmount: 1000,
        targetDate: '2026-12-31',
        alreadySaved: 0,
        priority: 1,
      });
      service.setStartingBalance(777);
      service.setTargetCashOnHand(444);
      service.setMinCashOnHand(222);
      service.setMinSavingsPerPaycheck(111);
      service.setScheduleStartDate('2026-05-01');

      service.clear();

      expect(service.getAllIncomes()).toEqual([]);
      expect(service.getAllBills()).toEqual([]);
      expect(service.getSkippedBills()).toEqual([]);
      expect(service.getBillAssignments()).toEqual([]);
      expect(service.getIncomeOverrides()).toEqual([]);
      expect(service.getAllGoals()).toEqual([]);
      expect(service.getStartingBalance()).toBe(0);
      expect(service.getTargetCashOnHand()).toBe(250);
      expect(service.getMinCashOnHand()).toBe(100);
      expect(service.getMinSavingsPerPaycheck()).toBe(0);
      expect(service.getScheduleStartDate()).toMatch(/^\d{4}-\d{2}-01$/);
    });
  });

  describe('sad', () => {
    it('returns null/false when updating or deleting unknown rows', () => {
      const service = new QuickBudgetService();
      expect(service.updateIncome('missing', {
        sourceName: 'Nope',
        amount: 100,
        cadence: 'weekly',
        startDate: '2026-01-01',
        isActive: true,
      })).toBeNull();
      expect(service.updateBill('missing', {
        creditorName: 'Nope',
        budgetedAmount: 100,
        dueDay: 1,
        category: 'utilities',
        isRecurring: true,
        priority: 'normal',
      })).toBeNull();
      expect(service.deleteBill('missing')).toBe(false);
      expect(service.deleteIncome('missing')).toBe(false);
      expect(service.unskipBill('missing', '2026-01-01')).toBe(false);
      expect(service.removeBillAssignment('missing', '2026-01-01')).toBe(false);
      expect(service.removeIncomeOverride('missing', '2026-01-01')).toBe(false);
      expect(service.updateGoal('missing', { name: 'Nope' })).toBeNull();
      expect(service.deleteGoal('missing')).toBe(false);
    });
  });

  describe('hostile', () => {
    it('throws when hostile income payload bypass attempts validation', () => {
      const service = new QuickBudgetService();
      expect(() =>
        service.createIncome({
          sourceName: '',
          amount: -1,
          cadence: 'weekly',
          startDate: '2026-01-01',
          isActive: true,
        })
      ).toThrow(/Invalid income data/);
    });

    it('throws on invalid bill and invalid override amount', () => {
      const service = new QuickBudgetService();
      expect(() =>
        service.createBill({
          creditorName: '',
          budgetedAmount: -10,
          dueDay: 0,
          category: 'utilities',
          isRecurring: true,
          priority: 'normal',
        })
      ).toThrow(/Invalid bill data/);

      expect(() => service.setIncomeOverride('inc-1', '2026-01-01', -1)).toThrow(
        /non-negative number/
      );
    });
  });
});
