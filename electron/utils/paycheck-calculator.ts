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
  format,
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
    case 'semimonthly':
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

/**
 * Get all unique paycheck dates from multiple income sources
 * Returns dates sorted chronologically
 */
export function getPaycheckDatesInRange(
  incomes: Income[],
  startDate: Date,
  endDate: Date
): Date[] {
  const allDates = new Set<string>();

  for (const income of incomes) {
    const paychecks = getPaycheckDatesForIncome(income, startDate, endDate);
    for (const p of paychecks) {
      allDates.add(format(p.date, 'yyyy-MM-dd'));
    }
  }

  return Array.from(allDates)
    .sort()
    .map(d => parseISO(d));
}

/**
 * Count the number of paychecks in a date range
 */
export function countPaychecksInRange(
  incomes: Income[],
  startDate: Date,
  endDate: Date
): number {
  return getPaycheckDatesInRange(incomes, startDate, endDate).length;
}

/**
 * Count paychecks from today until a goal deadline
 * This is the key function for independent goal projection calculation
 */
export function countPaychecksUntilDate(
  incomes: Income[],
  goalDeadline: Date
): number {
  const today = startOfDay(new Date());
  return countPaychecksInRange(incomes, today, goalDeadline);
}

/**
 * Get all paycheck dates from today until a goal deadline
 */
export function getPaycheckDatesUntilGoal(
  incomes: Income[],
  goalDeadline: Date
): Date[] {
  const today = startOfDay(new Date());
  return getPaycheckDatesInRange(incomes, today, goalDeadline);
}

/**
 * Calculate the average income per paycheck
 * Useful for estimating surplus available for goals
 */
export function calculateAveragePaycheckIncome(incomes: Income[]): number {
  if (incomes.length === 0) return 0;
  
  // Use a 3-month window to get a representative sample
  const today = startOfDay(new Date());
  const threeMonthsLater = addMonths(today, 3);
  
  let totalIncome = 0;
  const paycheckDates = new Set<string>();
  
  for (const income of incomes) {
    if (!income.isActive) continue;
    
    const paychecks = getPaycheckDatesForIncome(income, today, threeMonthsLater);
    for (const p of paychecks) {
      totalIncome += p.amount;
      paycheckDates.add(format(p.date, 'yyyy-MM-dd'));
    }
  }
  
  const uniquePaycheckCount = paycheckDates.size;
  if (uniquePaycheckCount === 0) return 0;
  
  return totalIncome / uniquePaycheckCount;
}

/**
 * Calculate the glide path progress for a goal
 * Returns the expected savings at a given paycheck index
 */
export interface GlidePathPoint {
  paycheckIndex: number;
  paycheckDate: Date;
  expectedProgress: number;  // How much should be saved by this point
  idealContribution: number; // The base contribution per paycheck
}

export function calculateGlidePath(
  totalToSave: number,
  paycheckDates: Date[]
): GlidePathPoint[] {
  if (paycheckDates.length === 0) return [];
  
  const idealPerPaycheck = totalToSave / paycheckDates.length;
  
  return paycheckDates.map((date, index) => ({
    paycheckIndex: index,
    paycheckDate: date,
    expectedProgress: idealPerPaycheck * (index + 1),
    idealContribution: idealPerPaycheck,
  }));
}

/**
 * Calculate the allocation multiplier based on progress vs expected
 * Used to adjust goal contributions in buildPaycheckEntries
 */
export function calculateAllocationMultiplier(
  currentProgress: number,
  expectedProgress: number
): number {
  if (expectedProgress <= 0) return 1.0;
  
  const progressRatio = currentProgress / expectedProgress;
  
  if (progressRatio < 0.8) {
    return 1.5;  // Significantly behind: aggressive catch-up
  } else if (progressRatio < 1.0) {
    return 1.2;  // Slightly behind: gentle catch-up
  } else if (progressRatio < 1.2) {
    return 1.0;  // On track: normal allocation
  } else {
    return 0.7;  // Ahead: favor savings
  }
}

/**
 * Estimate the achievable amount for a goal given surplus per paycheck
 */
export function estimateAchievableAmount(
  paycheckCount: number,
  averageSurplusPerPaycheck: number,
  minSavingsPerPaycheck: number = 0
): number {
  const availableForGoals = Math.max(0, averageSurplusPerPaycheck - minSavingsPerPaycheck);
  return paycheckCount * availableForGoals;
}
