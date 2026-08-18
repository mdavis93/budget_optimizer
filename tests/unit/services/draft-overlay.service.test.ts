import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveScheduleInputs } from '../../../electron/services/draft-overlay.service';

const baseManager = {
  getCurrentState: vi.fn(() => ({ budgetId: 'budget-1', isQuickBudget: false })),
  getAllIncomes: vi.fn(() => [{ id: 'income-1', sourceName: 'Salary' }]),
  getAllBills: vi.fn(() => [{ id: 'bill-1', creditorName: 'Rent' }]),
  getAllGoals: vi.fn(() => []),
  getSkippedBills: vi.fn(() => []),
  getBillAssignments: vi.fn(() => []),
  getIncomeOverrides: vi.fn(() => []),
  getDebts: vi.fn(() => [{ id: 'debt-1', billId: 'bill-1', principalBalance: 1000 }]),
  getLeaves: vi.fn(() => [{ id: 'leave-1', incomeId: 'income-1', type: 'unpaid' }]),
  getStartingBalance: vi.fn(() => 1000),
  getTargetCashOnHand: vi.fn(() => 250),
  getMinCashOnHand: vi.fn(() => 100),
  getMinSavingsPerPaycheck: vi.fn(() => 50),
  getScheduleStartDate: vi.fn(() => '2026-01-01'),
};

const baseDatabase = {};

describe('draft-overlay.resolveScheduleInputs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('happy', () => {
    it('returns manager and database values when no overlay exists', () => {
      const resolved = resolveScheduleInputs(baseManager as never, baseDatabase as never);

      expect(resolved.incomes).toEqual([{ id: 'income-1', sourceName: 'Salary' }]);
      expect(resolved.bills).toEqual([{ id: 'bill-1', creditorName: 'Rent' }]);
      expect(resolved.debts).toEqual([{ id: 'debt-1', billId: 'bill-1', principalBalance: 1000 }]);
      expect(resolved.leaves).toEqual([{ id: 'leave-1', incomeId: 'income-1', type: 'unpaid' }]);
      expect(resolved.scheduleStartDate).toBe('2026-01-01');
      expect(resolved.preferredAssignments.size).toBe(0);
    });

    it('uses overlay values when provided', () => {
      const resolved = resolveScheduleInputs(baseManager as never, baseDatabase as never, {
        incomes: [],
        bills: [],
        goals: [],
        debts: [],
        leaves: [],
        skippedBills: [],
        billAssignments: [],
        incomeOverrides: [],
        startingBalance: 777,
        targetCashOnHand: 400,
        minCashOnHand: 150,
        minSavingsPerPaycheck: 80,
        scheduleStartDate: '2026-02-01',
      });

      expect(resolved.startingBalance).toBe(777);
      expect(resolved.targetCashOnHand).toBe(400);
      expect(resolved.scheduleStartDate).toBe('2026-02-01');
      expect(baseManager.getDebts).not.toHaveBeenCalled();
      expect(baseManager.getLeaves).not.toHaveBeenCalled();
    });
  });

  describe('sad', () => {
    it('returns manager debts and leaves even when no named budget id is active', () => {
      const manager = {
        ...baseManager,
        getCurrentState: vi.fn(() => ({ budgetId: null, isQuickBudget: true })),
        getDebts: vi.fn(() => []),
        getLeaves: vi.fn(() => []),
      };

      const resolved = resolveScheduleInputs(manager as never, {} as never);
      expect(resolved.debts).toEqual([]);
      expect(resolved.leaves).toEqual([]);
      expect(manager.getDebts).toHaveBeenCalled();
      expect(manager.getLeaves).toHaveBeenCalled();
    });
  });

  describe('hostile', () => {
    it('throws for invalid overlay payload', () => {
      expect(() =>
        resolveScheduleInputs(baseManager as never, baseDatabase as never, {
          incomes: [
            {
              sourceName: '',
              amount: -1,
              cadence: 'weekly',
              startDate: '2026-01-01',
              isActive: true,
            } as never,
          ],
        })
      ).toThrow(/Invalid draft overlay/);
    });
  });
});
