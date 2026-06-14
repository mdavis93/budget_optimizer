import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DraftState } from '../../../src/types/draft';
import {
  computeDirtyDomains,
  persistBillsDomain,
  persistBudgetDomain,
  persistDebtsDomain,
  persistDomains,
  persistGoalsDomain,
  persistIncomeDomain,
  persistScheduleDomain,
} from '../../../src/utils/draftPersist';
import {
  createMockBill,
  createMockBudget,
  createMockElectronAPI,
  createMockGoal,
  createMockIncome,
} from '../../mocks/electron-api.mock';

function makeDraftState(overrides: Partial<DraftState> = {}): DraftState {
  const budget = createMockBudget();
  return {
    incomes: [createMockIncome()],
    bills: [createMockBill()],
    debts: [],
    goals: [createMockGoal()],
    skippedBills: [],
    billAssignments: [],
    incomeOverrides: [],
    budget: {
      name: budget.name,
      startingBalance: budget.startingBalance,
      targetCashOnHand: budget.targetCashOnHand,
      minCashOnHand: budget.minCashOnHand,
      minSavingsPerPaycheck: budget.minSavingsPerPaycheck,
      scheduleStartDate: budget.scheduleStartDate,
    },
    ...overrides,
  };
}

describe('draftPersist', () => {
  beforeEach(() => {
    const electronAPI = createMockElectronAPI();
    (globalThis as unknown as { window: { electronAPI: typeof electronAPI } }).window = { electronAPI };
  });

  describe('happy', () => {
    it('marks budget dirty when scheduleStartDate changes', () => {
      const committed = makeDraftState();
      const draft = makeDraftState({
        budget: {
          ...committed.budget!,
          scheduleStartDate: '2026-02-01',
        },
      });

      const dirty = computeDirtyDomains(committed, draft);
      expect(dirty.has('budget')).toBe(true);
      expect(dirty.size).toBe(1);
    });

    it('persists domains in save order and includes scheduleStartDate', async () => {
      const committed = makeDraftState();
      const draft = makeDraftState({
        incomes: [createMockIncome({ amount: 2500 })],
        bills: [createMockBill({ budgetedAmount: 175 })],
        budget: {
          ...committed.budget!,
          scheduleStartDate: '2026-03-01',
        },
      });

      const result = await persistDomains(
        committed,
        draft,
        ['budget', 'bills', 'income'],
        'budget-1'
      );

      const api = window.electronAPI;
      expect(result.success).toBe(true);
      expect(api.budget.update).toHaveBeenCalledWith(
        'budget-1',
        expect.objectContaining({ scheduleStartDate: '2026-03-01' })
      );

      const incomeOrder = vi.mocked(api.income.update).mock.invocationCallOrder[0];
      const billOrder = vi.mocked(api.bills.update).mock.invocationCallOrder[0];
      const budgetOrder = vi.mocked(api.budget.update).mock.invocationCallOrder[0];
      expect(incomeOrder).toBeLessThan(billOrder);
      expect(billOrder).toBeLessThan(budgetOrder);
    });

    it('maps created draft ids across income, bills, debts, and schedule domains', async () => {
      const committed = makeDraftState({
        incomes: [],
        bills: [],
        debts: [],
        skippedBills: [],
        billAssignments: [],
        incomeOverrides: [],
      });
      const draft = makeDraftState({
        incomes: [createMockIncome({ id: 'draft-income-1' })],
        bills: [
          createMockBill({
            id: 'draft-bill-1',
            preferredIncomeSourceId: 'draft-income-1',
          }),
        ],
        debts: [
          {
            id: 'draft-debt-1',
            budgetId: 'budget-1',
            billId: 'draft-bill-1',
            principalBalance: 1000,
            apr: 10,
            monthlyPayment: 100,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        skippedBills: [{ billId: 'draft-bill-1', skipDate: '2026-01-15' }],
        billAssignments: [
          { billId: 'draft-bill-1', billDueDate: '2026-01-15', paycheckDate: '2026-01-01' },
        ],
        incomeOverrides: [{ incomeId: 'draft-income-1', paycheckDate: '2026-01-01', amount: 1200 }],
      });

      vi.mocked(window.electronAPI.income.create).mockResolvedValueOnce({
        success: true,
        data: createMockIncome({ id: 'income-real-1' }),
      });
      vi.mocked(window.electronAPI.bills.create).mockResolvedValueOnce({
        success: true,
        data: createMockBill({ id: 'bill-real-1', preferredIncomeSourceId: 'income-real-1' }),
      });
      vi.mocked(window.electronAPI.debts.create).mockResolvedValueOnce({
        success: true,
        data: {
          id: 'debt-real-1',
          budgetId: 'budget-1',
          billId: 'bill-real-1',
          principalBalance: 1000,
          apr: 10,
          monthlyPayment: 100,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      });

      const result = await persistDomains(
        committed,
        draft,
        ['income', 'bills', 'debts', 'schedule'],
        'budget-1'
      );

      expect(result.success).toBe(true);
      expect(result.nextDraft.incomes[0].id).toBe('income-real-1');
      expect(result.nextDraft.bills[0].id).toBe('bill-real-1');
      expect(result.nextDraft.bills[0].preferredIncomeSourceId).toBe('income-real-1');
      expect(result.nextDraft.debts[0].billId).toBe('bill-real-1');
      expect(result.nextDraft.skippedBills[0].billId).toBe('bill-real-1');
      expect(result.nextDraft.billAssignments[0].billId).toBe('bill-real-1');
      expect(result.nextDraft.incomeOverrides[0].incomeId).toBe('income-real-1');
    });
  });

  describe('sad', () => {
    it('returns failure and does not continue when first domain fails', async () => {
      const committed = makeDraftState();
      const draft = makeDraftState({
        incomes: [createMockIncome({ amount: 2600 })],
      });

      vi.mocked(window.electronAPI.income.update).mockResolvedValueOnce({
        success: false,
        error: 'income failed',
      });

      const result = await persistDomains(committed, draft, ['income', 'bills', 'budget'], 'budget-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('income failed');
      expect(result.nextCommitted).toEqual(committed);
      expect(window.electronAPI.bills.update).not.toHaveBeenCalled();
      expect(window.electronAPI.budget.update).not.toHaveBeenCalled();
    });
  });

  describe('hostile', () => {
    it('stops after mid-pipeline failure and preserves prior successful domain', async () => {
      const committed = makeDraftState();
      const draft = makeDraftState({
        incomes: [createMockIncome({ amount: 2700 })],
        bills: [createMockBill({ budgetedAmount: 225 })],
        budget: {
          ...committed.budget!,
          scheduleStartDate: '2026-04-01',
        },
      });

      vi.mocked(window.electronAPI.bills.update).mockResolvedValueOnce({
        success: false,
        error: 'bill failure',
      });

      const result = await persistDomains(
        committed,
        draft,
        ['income', 'bills', 'budget'],
        'budget-1'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('bill failure');
      expect(result.nextCommitted.incomes[0].amount).toBe(2700);
      expect(result.nextCommitted.bills[0].budgetedAmount).toBe(committed.bills[0].budgetedAmount);
      expect(window.electronAPI.budget.update).not.toHaveBeenCalled();
    });

    it('covers direct domain persist helpers failure and short-circuit branches', async () => {
      const committed = makeDraftState();
      const draft = makeDraftState({
        goals: [createMockGoal({ name: 'Renamed Goal' })],
      });

      vi.mocked(window.electronAPI.goals.update).mockResolvedValueOnce({
        success: false,
        error: 'goal update failed',
      });
      const goalResult = await persistGoalsDomain(committed, draft);
      expect(goalResult.success).toBe(false);
      expect(goalResult.error).toBe('goal update failed');

      vi.mocked(window.electronAPI.debts.update).mockResolvedValueOnce({
        success: false,
        error: 'debt update failed',
      });
      const debtCommitted = makeDraftState({
        debts: [
          {
            id: 'debt-1',
            budgetId: 'budget-1',
            billId: 'bill-1',
            principalBalance: 1000,
            apr: 10,
            monthlyPayment: 100,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      });
      const debtDraft = makeDraftState({
        debts: [
          {
            ...debtCommitted.debts[0],
            apr: 11,
          },
        ],
      });
      const debtResult = await persistDebtsDomain(debtCommitted, debtDraft, new Map());
      expect(debtResult.success).toBe(false);
      expect(debtResult.error).toBe('debt update failed');

      const noBudgetResult = await persistBudgetDomain(
        { ...committed, budget: null },
        { ...draft, budget: null },
        'budget-1'
      );
      expect(noBudgetResult.success).toBe(true);

      const unchangedBudget = await persistBudgetDomain(committed, committed, 'budget-1');
      expect(unchangedBudget.success).toBe(true);
      expect(window.electronAPI.budget.update).not.toHaveBeenCalled();
    });

    it('handles schedule domain diffs and reports schedule write failures', async () => {
      const committed = makeDraftState({
        skippedBills: [{ billId: 'bill-1', skipDate: '2026-01-01' }],
        billAssignments: [{ billId: 'bill-1', billDueDate: '2026-01-15', paycheckDate: '2026-01-01' }],
        incomeOverrides: [{ incomeId: 'income-1', paycheckDate: '2026-01-01', amount: 1000 }],
      });
      const draft = makeDraftState({
        skippedBills: [{ billId: 'bill-1', skipDate: '2026-01-05' }],
        billAssignments: [{ billId: 'bill-1', billDueDate: '2026-01-15', paycheckDate: '2026-01-08' }],
        incomeOverrides: [{ incomeId: 'income-1', paycheckDate: '2026-01-01', amount: 1200 }],
      });

      const ok = await persistScheduleDomain(committed, draft, {
        income: new Map(),
        bill: new Map(),
      });
      expect(ok.success).toBe(true);
      expect(window.electronAPI.skippedBills.unskip).toHaveBeenCalledWith('bill-1', '2026-01-01');
      expect(window.electronAPI.skippedBills.skip).toHaveBeenCalledWith('bill-1', '2026-01-05');
      expect(window.electronAPI.billAssignments.assign).toHaveBeenCalledWith('bill-1', '2026-01-15', '2026-01-08');
      expect(window.electronAPI.incomeOverrides.set).toHaveBeenCalledWith('income-1', '2026-01-01', 1200);

      vi.mocked(window.electronAPI.billAssignments.assign).mockResolvedValueOnce({
        success: false,
        error: 'assign failed',
      });
      const fail = await persistScheduleDomain(committed, draft, {
        income: new Map(),
        bill: new Map(),
      });
      expect(fail.success).toBe(false);
      expect(fail.error).toBe('assign failed');
    });

    it('skips budget domain in persistDomains when budget id is null', async () => {
      const committed = makeDraftState();
      const draft = makeDraftState({
        budget: {
          ...committed.budget!,
          name: 'Changed',
        },
      });
      const result = await persistDomains(committed, draft, ['budget'], null);
      expect(result.success).toBe(true);
      expect(window.electronAPI.budget.update).not.toHaveBeenCalled();
    });

    it('covers direct income and bill domain helpers', async () => {
      const committed = makeDraftState({
        incomes: [],
        bills: [],
      });
      const draft = makeDraftState({
        incomes: [createMockIncome({ id: 'draft-income-2' })],
        bills: [createMockBill({ id: 'draft-bill-2', preferredIncomeSourceId: 'draft-income-2' })],
      });

      vi.mocked(window.electronAPI.income.create).mockResolvedValueOnce({
        success: true,
        data: createMockIncome({ id: 'income-real-2' }),
      });
      const incomeResult = await persistIncomeDomain(committed, draft);
      expect(incomeResult.success).toBe(true);
      expect(incomeResult.nextDraft.incomes[0].id).toBe('income-real-2');

      vi.mocked(window.electronAPI.bills.create).mockResolvedValueOnce({
        success: true,
        data: createMockBill({ id: 'bill-real-2', preferredIncomeSourceId: 'income-real-2' }),
      });
      const billResult = await persistBillsDomain(
        { ...committed, incomes: incomeResult.nextCommitted.incomes },
        incomeResult.nextDraft,
        incomeResult.idMap
      );
      expect(billResult.success).toBe(true);
      expect(billResult.nextDraft.bills[0].id).toBe('bill-real-2');
    });
  });
});
