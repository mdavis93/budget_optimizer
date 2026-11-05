import {
  addWeeks,
  addMonths,
  isBefore,
  isAfter,
  isEqual,
  parseISO,
  startOfDay,
  setDate,
  getDate,
} from 'date-fns';
import { Income } from '../services/database.service';

export interface PaycheckDate {
  date: Date;
  incomeId: string;
  incomeName: string;
  amount: number;
}

/**
 * Calculate the next income date based on cadence
 */
export function getNextIncomeDate(current: Date, cadence: Income['cadence']): Date {
  switch (cadence) {
    case 'weekly':
      return addWeeks(current, 1);
    case 'biweekly':
      return addWeeks(current, 2);
    case 'semimonthly': {
      const day = getDate(current);
      if (day === 1) {
        return setDate(current, 15);
      } else if (day === 15) {
        return setDate(addMonths(current, 1), 1);
      } else if (day < 15) {
        return setDate(current, 15);
      } else {
        return setDate(addMonths(current, 1), 1);
      }
    }
    case 'monthly':
      return addMonths(current, 1);
    default:
      return addMonths(current, 1);
  }
}

/**
 * Get all paycheck dates for a single income source in a date range
 */
export function getPaycheckDatesForIncome(
  income: Income,
  startDate: Date,
  endDate: Date
): PaycheckDate[] {
  const paychecks: PaycheckDate[] = [];
  
  if (!income.isActive) return paychecks;

  const incomeEnd = income.endDate ? startOfDay(parseISO(income.endDate)) : null;

  let currentDate = parseISO(income.startDate);
  currentDate = startOfDay(currentDate);

  // Fast-forward to start date
  while (isBefore(currentDate, startDate)) {
    currentDate = getNextIncomeDate(currentDate, income.cadence);
    if (incomeEnd && isAfter(currentDate, incomeEnd)) return paychecks;
  }

  // Collect paychecks until end date (and income endDate if set)
  while (
    (isBefore(currentDate, endDate) || isEqual(currentDate, endDate)) &&
    (!incomeEnd || !isAfter(currentDate, incomeEnd))
  ) {
    paychecks.push({
      date: currentDate,
      incomeId: income.id,
      incomeName: income.sourceName,
      amount: income.amount,
    });
    currentDate = getNextIncomeDate(currentDate, income.cadence);
  }

  return paychecks;
}

