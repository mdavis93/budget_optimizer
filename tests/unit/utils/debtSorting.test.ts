import { describe, expect, it } from 'vitest';
import {
  compareTrackedDebts,
  compareUntrackedBills,
  creditorPrefixGroupKey,
  sortGroupKeys,
} from '../../../src/components/debts/debtSorting';
import type { Bill, DebtWithAmortization } from '../../../src/types';

function bill(partial: Partial<Bill> & Pick<Bill, 'id' | 'creditorName'>): Bill {
  return {
    budgetId: 'b1',
    budgetedAmount: 100,
    dueDay: 1,
    category: 'Debt',
    priority: 'normal',
    isIncomeAttached: false,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...partial,
  };
}

function tracked(
  creditorName: string,
  overrides: Partial<DebtWithAmortization['debt']> & { dueDay?: number } = {}
): DebtWithAmortization {
  const linked = bill({
    id: overrides.billId ?? `bill-${creditorName}`,
    creditorName,
    dueDay: overrides.dueDay ?? 1,
    budgetedAmount: overrides.monthlyPayment ?? 100,
  });
  return {
    debt: {
      id: `debt-${creditorName}`,
      budgetId: 'b1',
      billId: linked.id,
      principalBalance: overrides.principalBalance ?? 1000,
      apr: overrides.apr ?? 0.1,
      monthlyPayment: overrides.monthlyPayment ?? 100,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
    bill: linked,
    amortization: null,
  };
}

describe('debtSorting', () => {
  it('groups by creditor prefix and sorts Other last', () => {
    expect(creditorPrefixGroupKey('CC: Navy')).toBe('CC');
    expect(creditorPrefixGroupKey('Ungrouped')).toBe('Other');
    expect(creditorPrefixGroupKey(': Bad')).toBe('Other');
    expect(sortGroupKeys(['Zebra', 'Other', 'Alpha'])).toEqual(['Alpha', 'Zebra', 'Other']);
  });

  it('compares tracked debts across sort modes', () => {
    const a = tracked('A Bank', { dueDay: 5, monthlyPayment: 200, principalBalance: 500 });
    const b = tracked('B Bank', { dueDay: 1, monthlyPayment: 50, principalBalance: 900 });

    expect(compareTrackedDebts(a, b, 'name')).toBeLessThan(0);
    expect(compareTrackedDebts(a, b, 'dueDay')).toBeGreaterThan(0);
    expect(compareTrackedDebts(a, b, 'minPayment')).toBeGreaterThan(0);
    expect(compareTrackedDebts(a, b, 'balance')).toBeGreaterThan(0);
  });

  it('compares untracked bills across sort modes', () => {
    const a = bill({ id: '1', creditorName: 'Alpha', dueDay: 10, budgetedAmount: 300 });
    const b = bill({ id: '2', creditorName: 'Beta', dueDay: 2, budgetedAmount: 50 });

    expect(compareUntrackedBills(a, b, 'name')).toBeLessThan(0);
    expect(compareUntrackedBills(a, b, 'dueDay')).toBeGreaterThan(0);
    expect(compareUntrackedBills(a, b, 'minPayment')).toBeGreaterThan(0);
    expect(compareUntrackedBills(a, b, 'balance')).toBeLessThan(0);
  });

  it('handles missing linked bills when comparing tracked debts', () => {
    const withBill = tracked('Has Bill');
    const withoutBill: DebtWithAmortization = {
      ...withBill,
      bill: null,
    };
    expect(compareTrackedDebts(withoutBill, withBill, 'name')).toBe(1);
    expect(compareTrackedDebts(withBill, withoutBill, 'name')).toBe(-1);
    expect(compareTrackedDebts(withoutBill, withoutBill, 'name')).toBe(0);
  });
});
