import { Bill, Income } from '../types';

export function getCadenceMonthlyMultiplier(cadence: Income['cadence']): number {
  switch (cadence) {
    case 'weekly':
      return 4.33;
    case 'biweekly':
      return 2.17;
    case 'semimonthly':
      return 2;
    case 'monthly':
      return 1;
  }
}

export function getMonthlyIncomeEquivalent(income: Income): number {
  return income.amount * getCadenceMonthlyMultiplier(income.cadence);
}

export function getMonthlyBillEquivalent(bill: Bill, incomes: Income[]): number {
  if (!bill.isIncomeAttached) {
    return bill.budgetedAmount;
  }

  const attachedIncome = incomes.find(
    (income) => income.id === bill.preferredIncomeSourceId && income.isActive
  );

  if (!attachedIncome) {
    return bill.budgetedAmount;
  }

  return bill.budgetedAmount * getCadenceMonthlyMultiplier(attachedIncome.cadence);
}
