import { isBefore, format, parseISO, differenceInDays } from 'date-fns';
import { movableBillCapacity } from '@shared/reconciliationSurplus';
import { PRIORITY_ORDER } from '../../utils/constants';
import {
  DEFAULT_MIN_CASH_ON_HAND,
  DEFAULT_TARGET_CASH_ON_HAND,
  MAX_PREPAY_DAYS,
  ScheduleData,
  ReconciliationReport,
  ShortfallDetail,
  ProposedFix,
} from './types';

export function analyzeAndProposeFixes(schedule: ScheduleData): ReconciliationReport {
  const shortfallPaychecks = schedule.paychecks.filter(p => p.isShortfall);

  if (shortfallPaychecks.length === 0) {
    return {
      needsReconciliation: false,
      shortfalls: [],
      proposedFixes: [],
      canBeFullyResolved: true,
      totalDeficit: 0,
      estimatedResolution: 0,
      minCashOnHand: schedule.minCashOnHand ?? DEFAULT_MIN_CASH_ON_HAND,
    };
  }

  const budgetMinCashOnHand = schedule.minCashOnHand ?? DEFAULT_MIN_CASH_ON_HAND;
  const budgetTargetCashOnHand = schedule.maxBudgetRemaining ?? DEFAULT_TARGET_CASH_ON_HAND;
  const shortfalls: ShortfallDetail[] = shortfallPaychecks.map(p => ({
    paycheckDate: p.date,
    deficit: Math.abs(p.budgetRemaining),
    budgetRemaining: p.budgetRemaining,
    bills: [...p.bills],
  }));

  const totalDeficit = shortfalls.reduce((sum, s) => sum + s.deficit, 0);
  const proposedFixes: ProposedFix[] = [];
  let fixIdCounter = 1;

  const paycheckSurplus = new Map<string, number>();
  for (const paycheck of schedule.paychecks) {
    const target = paycheck.targetCashOnHand ?? budgetTargetCashOnHand;
    const min = paycheck.minCashOnHand ?? budgetMinCashOnHand;
    const movable = movableBillCapacity(
      paycheck.budgetRemaining,
      target,
      min,
      paycheck.isShortfall
    );
    if (movable > 0) {
      paycheckSurplus.set(paycheck.date, movable);
    }
  }

  const proposedBillMoves = new Set<string>();

  for (const shortfall of shortfalls) {
    const shortfallPaycheck = schedule.paychecks.find(p => p.date === shortfall.paycheckDate);
    if (!shortfallPaycheck) continue;

    const movableBills = [...shortfallPaycheck.bills]
      .filter(b => !b.isIncomeAttached && !b.isUnpayable && !b.isSkipped)
      .sort((a, b) => PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority]);

    for (const bill of movableBills) {
      const billKey = `${bill.billId}-${bill.billDate}`;
      if (proposedBillMoves.has(billKey)) continue;

      const earlierPaychecks = schedule.paychecks
        .filter(p => {
          const pDate = parseISO(p.date);
          const sDate = parseISO(shortfall.paycheckDate);
          return isBefore(pDate, sDate) && !p.isShortfall;
        })
        .sort((a, b) => parseISO(b.date).getTime() - parseISO(a.date).getTime());

      for (const targetPaycheck of earlierPaychecks) {
        const availableSurplus = paycheckSurplus.get(targetPaycheck.date) || 0;

        if (availableSurplus >= bill.amount) {
          const billDueDate = parseISO(bill.billDate);
          const targetDate = parseISO(targetPaycheck.date);
          const daysEarly = differenceInDays(billDueDate, targetDate);

          if (daysEarly <= MAX_PREPAY_DAYS) {
            const targetMin = targetPaycheck.minCashOnHand ?? budgetMinCashOnHand;
            const remainingAfterMove = targetPaycheck.budgetRemaining - bill.amount;
            if (remainingAfterMove < targetMin) {
              continue;
            }

            proposedFixes.push({
              id: `fix-${fixIdCounter++}`,
              type: 'move_bill',
              billId: bill.billId,
              billName: bill.creditorName,
              billAmount: bill.amount,
              fromPaycheckDate: shortfall.paycheckDate,
              toPaycheckDate: targetPaycheck.date,
              billDueDate: bill.billDate,
              reason: `Move to ${format(targetDate, 'MMM d')} paycheck which has surplus capacity`,
              impact: bill.amount,
            });

            paycheckSurplus.set(targetPaycheck.date, availableSurplus - bill.amount);
            proposedBillMoves.add(billKey);
            break;
          }
        }
      }
    }
  }

  const estimatedResolution = proposedFixes.reduce((sum, f) => sum + f.impact, 0);
  const canBeFullyResolved = estimatedResolution >= totalDeficit;

  return {
    needsReconciliation: true,
    shortfalls,
    proposedFixes,
    canBeFullyResolved,
    totalDeficit,
    estimatedResolution,
    minCashOnHand: budgetMinCashOnHand,
  };
}
