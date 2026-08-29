import { Bill, Income } from '../types';
import { isOperatingIncome } from '@shared/incomePurpose';

export { isOperatingIncome, isSavingsAndGoalsIncome } from '@shared/incomePurpose';

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

export function getMonthlyOperatingIncomeTotal(incomes: Income[]): number {
  return incomes
    .filter((income) => income.isActive && isOperatingIncome(income))
    .reduce((sum, income) => sum + getMonthlyIncomeEquivalent(income), 0);
}

export function getMonthlyBillEquivalent(bill: Bill, incomes: Income[]): number {
  if (!bill.isIncomeAttached) {
    return bill.budgetedAmount;
  }

  const attachedIncome = incomes.find(
    (income) =>
      income.id === bill.preferredIncomeSourceId &&
      income.isActive &&
      isOperatingIncome(income)
  );

  if (!attachedIncome) {
    return bill.budgetedAmount;
  }

  return bill.budgetedAmount * getCadenceMonthlyMultiplier(attachedIncome.cadence);
}
