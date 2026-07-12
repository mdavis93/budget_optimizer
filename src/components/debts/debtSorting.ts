import { Bill, DebtWithAmortization } from '../../types';

export type TimePeriod = 3 | 6 | 12 | 'max';
export type DebtSortMode = 'name' | 'dueDay' | 'minPayment' | 'balance';

export function creditorPrefixGroupKey(creditorName: string): string {
  const i = creditorName.indexOf(':');
  if (i === -1) return 'Other';
  const prefix = creditorName.slice(0, i).trim();
  return prefix.length > 0 ? prefix : 'Other';
}

export function compareTrackedDebts(a: DebtWithAmortization, b: DebtWithAmortization, mode: DebtSortMode): number {
  const billA = a.bill;
  const billB = b.bill;
  if (!billA && !billB) return 0;
  if (!billA) return 1;
  if (!billB) return -1;
  const nameA = billA.creditorName;
  const nameB = billB.creditorName;
  if (mode === 'name') return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
  if (mode === 'dueDay') return billA.dueDay !== billB.dueDay ? billA.dueDay - billB.dueDay : nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
  if (mode === 'minPayment') return a.debt.monthlyPayment !== b.debt.monthlyPayment ? a.debt.monthlyPayment - b.debt.monthlyPayment : nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
  return b.debt.principalBalance !== a.debt.principalBalance ? b.debt.principalBalance - a.debt.principalBalance : nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
}

export function compareUntrackedBills(a: Bill, b: Bill, mode: DebtSortMode): number {
  const nameA = a.creditorName;
  const nameB = b.creditorName;
  if (mode === 'name') return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
  if (mode === 'dueDay') return a.dueDay !== b.dueDay ? a.dueDay - b.dueDay : nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
  if (mode === 'minPayment') return a.budgetedAmount !== b.budgetedAmount ? a.budgetedAmount - b.budgetedAmount : nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
  return b.budgetedAmount !== a.budgetedAmount ? b.budgetedAmount - a.budgetedAmount : nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
}

export function sortGroupKeys(keys: string[]): string[] {
  return [...keys].sort((a, b) => {
    if (a === 'Other') return 1;
    if (b === 'Other') return -1;
    return a.localeCompare(b, undefined, { sensitivity: 'base' });
  });
}
