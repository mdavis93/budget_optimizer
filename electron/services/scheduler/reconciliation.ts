import { isBefore, format, parseISO, differenceInDays } from 'date-fns';
import { PRIORITY_ORDER } from '../../utils/constants';
import {
  MIN_BREATHING_ROOM,
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
    };
  }

  const shortfalls: ShortfallDetail[] = shortfallPaychecks.map(p => ({
    paycheckDate: p.date,
    deficit: Math.abs(p.budgetRemaining),
    bills: [...p.bills],
  }));

  const totalDeficit = shortfalls.reduce((sum, s) => sum + s.deficit, 0);
  const proposedFixes: ProposedFix[] = [];
  let fixIdCounter = 1;

  // Build a map of paycheck surpluses (non-shortfall paychecks)
  const paycheckSurplus = new Map<string, number>();
  for (const paycheck of schedule.paychecks) {
    if (!paycheck.isShortfall && paycheck.budgetRemaining > MIN_BREATHING_ROOM) {
      paycheckSurplus.set(paycheck.date, paycheck.budgetRemaining - MIN_BREATHING_ROOM);
    }
  }

  // Track which bills we've already proposed fixes for
  const proposedBillMoves = new Set<string>();

  // For each shortfall paycheck, try to find fixes
  for (const shortfall of shortfalls) {
    const shortfallPaycheck = schedule.paychecks.find(p => p.date === shortfall.paycheckDate);
    if (!shortfallPaycheck) continue;

    // Sort bills by priority for moves: Low → Normal → High → Critical last
    const movableBills = [...shortfallPaycheck.bills]
      .filter(b => !b.isIncomeAttached && !b.isUnpayable)
      .sort((a, b) => PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority]);

    for (const bill of movableBills) {
      const billKey = `${bill.billId}-${bill.billDate}`;
      if (proposedBillMoves.has(billKey)) continue;

      // Find earlier paychecks with enough surplus
      const earlierPaychecks = schedule.paychecks
        .filter(p => {
          const pDate = parseISO(p.date);
          const sDate = parseISO(shortfall.paycheckDate);
          return isBefore(pDate, sDate) && !p.isShortfall;
        })
        .sort((a, b) => {
          // Sort by date descending (closest to shortfall first)
          return parseISO(b.date).getTime() - parseISO(a.date).getTime();
        });

      for (const targetPaycheck of earlierPaychecks) {
        const availableSurplus = paycheckSurplus.get(targetPaycheck.date) || 0;

        if (availableSurplus >= bill.amount) {
          // Check prepay limit
          const billDueDate = parseISO(bill.billDate);
          const targetDate = parseISO(targetPaycheck.date);
          const daysEarly = differenceInDays(billDueDate, targetDate);

          if (daysEarly <= MAX_PREPAY_DAYS) {
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

            // Update surplus tracking
            paycheckSurplus.set(targetPaycheck.date, availableSurplus - bill.amount);
            proposedBillMoves.add(billKey);
            break;
          }
        }
      }
    }

    // If we still have deficit after move suggestions, suggest skipping low-priority bills
    const remainingDeficit = shortfall.deficit -
      proposedFixes
        .filter(f => f.fromPaycheckDate === shortfall.paycheckDate && f.type === 'move_bill')
        .reduce((sum, f) => sum + f.impact, 0);

    if (remainingDeficit > 0) {
      const skippableBills = shortfallPaycheck.bills
        .filter(b => !b.isIncomeAttached && !b.isUnpayable)
        .filter(b => b.priority === 'low' || b.priority === 'normal' || b.priority === 'high')
        .filter(b => !proposedBillMoves.has(`${b.billId}-${b.billDate}`))
        .sort((a, b) => PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority]);

      let deficitCovered = 0;
      for (const bill of skippableBills) {
        if (deficitCovered >= remainingDeficit) break;

        const billKey = `${bill.billId}-${bill.billDate}`;
        if (proposedBillMoves.has(billKey)) continue;

        proposedFixes.push({
          id: `fix-${fixIdCounter++}`,
          type: 'skip_bill',
          billId: bill.billId,
          billName: bill.creditorName,
          billAmount: bill.amount,
          fromPaycheckDate: shortfall.paycheckDate,
          billDueDate: bill.billDate,
          reason: `Skip this ${bill.priority}-priority bill for this cycle`,
          impact: bill.amount,
          reasonCode: bill.unfundableReason,
        });

        proposedBillMoves.add(billKey);
        deficitCovered += bill.amount;
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
  };
}
