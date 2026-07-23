import {
  format,
} from 'date-fns';
import { SavingsGoal } from '../database.service';
import {
  cashMinForDate,
  cashTargetForDate,
  type CashOnHandByDate,
} from './cashOnHandOverrides';
import {
  DEFAULT_TARGET_CASH_ON_HAND,
  DEFAULT_MIN_CASH_ON_HAND,
  PaycheckEntry,
  PaycheckAssignment,
  GoalDeposit,
  billOccurrenceKey,
} from './types';
import { allocateGoalsAndSavings } from './goalSavingsAllocator';
export {
  calculateSummary,
  convertToLegacyEntries,
  generateRecommendations,
} from '@shared/schedulePresentation';

export function buildPaycheckEntries(
  assignments: PaycheckAssignment[],
  startingBalance: number,
  maxBudgetRemaining: number = DEFAULT_TARGET_CASH_ON_HAND,
  goals: SavingsGoal[] = [],
  minCashOnHand: number = DEFAULT_MIN_CASH_ON_HAND,
  minSavingsPerPaycheck: number = 0,
  cashOnHandByDate?: CashOnHandByDate
): PaycheckEntry[] {
  const paychecks: PaycheckEntry[] = [];
  let totalSavings = 0;

  const meta = assignments.map((assignment, i) => {
    const seenBills = new Set<string>();
    const uniqueBills = assignment.bills.filter(bill => {
      const key = billOccurrenceKey(bill.billId, bill.date);
      if (seenBills.has(key)) return false;
      seenBills.add(key);
      return true;
    });

    const totalIncome = assignment.incomes.reduce((sum, inc) => sum + inc.amount, 0);
    const fundedBills = uniqueBills.filter(bill => !bill.isUnpayable && !bill.isSkipped);
    const totalBillsAmount = fundedBills.reduce((sum, bill) => sum + bill.amount, 0);
    const unpayableBillsAmount = uniqueBills
      .filter(bill => bill.isUnpayable && !bill.isSkipped)
      .reduce((sum, bill) => sum + bill.amount, 0);
    const hasUnpayableBills = unpayableBillsAmount > 0;
    const ledgerBoost = i === 0 ? startingBalance : 0;
    const paycheckDateStr = format(assignment.date, 'yyyy-MM-dd');
    const effectiveTarget = cashTargetForDate(
      cashOnHandByDate,
      paycheckDateStr,
      maxBudgetRemaining
    );
    const effectiveMin = cashMinForDate(cashOnHandByDate, paycheckDateStr, minCashOnHand);

    const grossRemaining = hasUnpayableBills
      ? totalIncome - totalBillsAmount - unpayableBillsAmount + ledgerBoost
      : totalIncome - totalBillsAmount + ledgerBoost;

    const surplus = hasUnpayableBills
      ? 0
      : grossRemaining >= effectiveTarget
        ? Math.max(0, grossRemaining - effectiveTarget)
        : 0;

    return {
      assignment,
      uniqueBills,
      totalIncome,
      totalBillsAmount,
      grossRemaining,
      surplus,
      effectiveTarget,
      effectiveMin,
      paycheckDateStr,
    };
  });

  const allocation = allocateGoalsAndSavings(
    meta.map(m => ({ date: m.paycheckDateStr, surplus: m.surplus })),
    goals.map(goal => ({
      id: goal.id,
      name: goal.name,
      targetAmount: goal.targetAmount,
      alreadySaved: goal.alreadySaved,
      priority: goal.priority,
      targetDate: goal.targetDate,
    })),
    { minSavingsPerPaycheck }
  );

  for (let assignmentIndex = 0; assignmentIndex < meta.length; assignmentIndex++) {
    const {
      assignment,
      uniqueBills,
      totalIncome,
      totalBillsAmount,
      grossRemaining,
      surplus,
      effectiveTarget,
      effectiveMin,
      paycheckDateStr,
    } = meta[assignmentIndex];
    const alloc = allocation.paychecks[assignmentIndex];

    const goalDeposits: GoalDeposit[] = alloc.goalDeposits.map(deposit => ({
      goalId: deposit.goalId,
      goalName: deposit.goalName,
      amount: Math.round(deposit.amount),
    }));
    const totalGoalDeposits = alloc.totalGoalDeposits;
    const savingsDeposit = alloc.savingsDeposit;
    const savingsSqueezed = alloc.savingsSqueezed;

    let budgetRemaining = grossRemaining;
    if (surplus > 0) {
      budgetRemaining = effectiveTarget;
      totalSavings += savingsDeposit;
    }

    const isShortfall = budgetRemaining < effectiveMin;

    const unpayableCount = uniqueBills.filter(bill => bill.isUnpayable && !bill.isSkipped).length;
    const hasUnpayableBills = unpayableCount > 0;

    const paycheck: PaycheckEntry = {
      date: paycheckDateStr,
      incomeSources: assignment.incomes.map(inc => ({
        id: inc.sourceId,
        name: inc.sourceName,
        amount: inc.amount,
      })),
      totalIncome,
      bills: uniqueBills.map(bill => ({
        billId: bill.billId,
        creditorName: bill.creditorName,
        amount: bill.amount,
        dueDay: bill.dueDay,
        priority: bill.priority,
        category: bill.category,
        billDate: format(bill.date, 'yyyy-MM-dd'),
        isIncomeAttached: bill.isIncomeAttached,
        isUnpayable: bill.isUnpayable,
        isSkipped: bill.isSkipped,
        unfundableReason: bill.unfundableReason,
      })),
      totalBills: Math.round(totalBillsAmount * 100) / 100,
      goalDeposits,
      totalGoalDeposits: Math.round(totalGoalDeposits * 100) / 100,
      budgetRemaining: Math.round(budgetRemaining * 100) / 100,
      savingsDeposit: Math.round(savingsDeposit * 100) / 100,
      totalSavings: Math.round(totalSavings * 100) / 100,
      isShortfall,
      targetCashOnHand: effectiveTarget,
      minCashOnHand: effectiveMin,
      savingsSqueezed,
      unpayableCount,
      hasUnpayableBills,
    };

    paychecks.push(paycheck);
  }

  return paychecks;
}
