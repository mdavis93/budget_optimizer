import {
  addMonths,
  isBefore,
  isAfter,
  startOfDay,
  setDate,
  getDaysInMonth,
  startOfMonth,
  endOfMonth,
  isEqual,
  parseISO,
} from 'date-fns';
import { Income, Bill } from '../database.service';
import { getNextIncomeDate } from '../../utils/paycheck-calculator';
import { DebtPayoffInfo, ProjectedIncome, ProjectedBill } from './types';

export function projectIncome(income: Income, startDate: Date, endDate: Date): ProjectedIncome[] {
  const events: ProjectedIncome[] = [];
  if (!income.isActive) return events;

  const incomeEnd = income.endDate ? startOfDay(parseISO(income.endDate)) : null;

  let currentDate = parseISO(income.startDate);
  currentDate = startOfDay(currentDate);

  while (isBefore(currentDate, startDate)) {
    currentDate = getNextIncomeDate(currentDate, income.cadence);
    if (incomeEnd && isAfter(currentDate, incomeEnd)) return events;
  }

  while (
    (isBefore(currentDate, endDate) || isEqual(currentDate, endDate)) &&
    (!incomeEnd || !isAfter(currentDate, incomeEnd))
  ) {
    events.push({
      date: currentDate,
      sourceId: income.id,
      sourceName: income.sourceName,
      amount: income.amount,
    });
    currentDate = getNextIncomeDate(currentDate, income.cadence);
  }

  return events;
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

    // If this bill has debt payoff info, stop projecting after payoff date
    if (debtPayoffInfo && isAfter(dueDate, debtPayoffInfo.payoffDate)) {
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
