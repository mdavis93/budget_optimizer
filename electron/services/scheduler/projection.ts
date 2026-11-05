import {
  addMonths,
  isBefore,
  isAfter,
  setDate,
  getDaysInMonth,
  startOfMonth,
  endOfMonth,
  isEqual,
} from 'date-fns';
import { Income, Bill } from '../database.service';
import { getPaycheckDatesForIncome } from '../../utils/paycheck-calculator';
import { normalizeIncomePurpose } from '@shared/incomePurpose';
import { DebtPayoffInfo, ProjectedIncome, ProjectedBill } from './types';

export function projectIncome(income: Income, startDate: Date, endDate: Date): ProjectedIncome[] {
  return getPaycheckDatesForIncome(income, startDate, endDate).map((paycheck) => ({
    date: paycheck.date,
    sourceId: paycheck.incomeId,
    sourceName: paycheck.incomeName,
    amount: paycheck.amount,
    purpose: normalizeIncomePurpose(income.purpose),
  }));
}

export function projectBills(
  bill: Bill,
  startDate: Date,
  endDate: Date,
  debtPayoffInfo?: DebtPayoffInfo
): ProjectedBill[] {
  const events: ProjectedBill[] = [];

  let currentMonth = startOfMonth(startDate);
  const end = endOfMonth(endDate);

  while (isBefore(currentMonth, end) || isEqual(currentMonth, end)) {
    const daysInMonth = getDaysInMonth(currentMonth);
    const dueDay = Math.min(bill.dueDay, daysInMonth);
    const dueDate = setDate(currentMonth, dueDay);

    // Stop after the payoff *month*. Amortization payoffDate is often mid-month
    // (addMonths from today) while the bill is due later (e.g. dueDay 30 vs
    // payoff on the 23rd). Comparing calendar days dropped that final due date
    // entirely; finalPaymentAmount already keys off startOfMonth equality.
    if (
      debtPayoffInfo &&
      isAfter(startOfMonth(dueDate), startOfMonth(debtPayoffInfo.payoffDate))
    ) {
      break;
    }

    if (
      (isAfter(dueDate, startDate) || isEqual(dueDate, startDate)) &&
      (isBefore(dueDate, endDate) || isEqual(dueDate, endDate))
    ) {
      // Check if this is the final payment month for a debt
      const isFinalPayment = debtPayoffInfo &&
        startOfMonth(dueDate).getTime() === startOfMonth(debtPayoffInfo.payoffDate).getTime();

      events.push({
        date: dueDate,
        billId: bill.id,
        creditorName: bill.creditorName,
        amount: isFinalPayment ? debtPayoffInfo.finalPaymentAmount : bill.budgetedAmount,
        dueDay: bill.dueDay,
        priority: bill.priority,
        category: bill.category,
        preferredIncomeSourceId: bill.preferredIncomeSourceId,
        isIncomeAttached: bill.isIncomeAttached,
      });
    }

    currentMonth = addMonths(currentMonth, 1);

    if (!bill.isRecurring) break;
  }

  return events;
}
