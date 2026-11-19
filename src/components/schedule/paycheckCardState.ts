import { isLabeledBreakGlassPaycheck } from '@shared/breakGlassBand';
import { isSavingsAndGoalsIncome, paycheckKey } from '@shared/incomePurpose';
import type { BillAssignment, PaycheckEntry } from '../../types';
import { filterPaycheckBills } from '../../utils/scheduleBills';

/** Hard failure: unfunded bills or negative remaining after obligations. */
export function isHardShortfallPaycheck(
  paycheck: PaycheckEntry,
  hasUnpayableBills: boolean
): boolean {
  if (hasUnpayableBills) return true;
  return paycheck.budgetRemaining < 0;
}

/**
 * Bills are funded but cash sits below the min floor — warning theme (not
 * the same as unpayable / negative remaining).
 */
export function isBelowMinimumPaycheck(
  paycheck: PaycheckEntry,
  hasUnpayableBills: boolean
): boolean {
  return (
    Boolean(paycheck.isShortfall) &&
    paycheck.budgetRemaining >= 0 &&
    !hasUnpayableBills
  );
}

export function paycheckWarningTooltip(
  paycheck: PaycheckEntry,
  hasUnpayableBills: boolean,
  unpayableCount: number,
  formatCurrency: (amount: number) => string,
  fallbackMinCashOnHand: number
): string {
  const min = paycheck.minCashOnHand ?? fallbackMinCashOnHand;
  if (hasUnpayableBills) {
    const noun = unpayableCount === 1 ? 'bill' : 'bills';
    return `${unpayableCount} ${noun} could not be funded from available income in this paycheck's window.`;
  }
  if (paycheck.budgetRemaining < 0) {
    return `Bills exceed this paycheck's income after reserves. Cash on hand would be ${formatCurrency(paycheck.budgetRemaining)}.`;
  }
  if (paycheck.isShortfall) {
    return `Cash on hand (${formatCurrency(paycheck.budgetRemaining)}) is below your minimum floor of ${formatCurrency(min)}. Bills are funded, but this week is tighter than your reserve.`;
  }
  return '';
}

export function resolvePaycheckCardState(
  paycheck: PaycheckEntry,
  billAssignments: BillAssignment[],
  validPaycheckDates: ReadonlySet<string>,
  maxBudgetRemaining: number,
  minCashOnHand: number,
  formatCurrency: (amount: number) => string,
  expandedPaychecks: Set<string>,
  dropTargetDate: string | null,
  draggedBillSourceDate: string | undefined
) {
  const entryKey = paycheckKey(paycheck);
  const isReserved = isSavingsAndGoalsIncome(paycheck);
  const visibleBills = filterPaycheckBills(
    paycheck.bills,
    billAssignments,
    paycheck.date,
    validPaycheckDates
  );
  const unpayableCount = visibleBills.filter(
    (bill) => bill.isUnpayable && !bill.isSkipped
  ).length;
  const hasUnpayableBills = unpayableCount > 0;
  return {
    entryKey,
    isReserved,
    blocksAssignment: isReserved,
    visibleBills,
    unpayableCount,
    hasUnpayableBills,
    isHardShortfall: !isReserved && isHardShortfallPaycheck(paycheck, hasUnpayableBills),
    isBelowMinimum: !isReserved && isBelowMinimumPaycheck(paycheck, hasUnpayableBills),
    isBreakGlass:
      !isReserved && isLabeledBreakGlassPaycheck(paycheck, maxBudgetRemaining, minCashOnHand),
    warningTooltip: isReserved
      ? null
      : paycheckWarningTooltip(
          paycheck,
          hasUnpayableBills,
          unpayableCount,
          formatCurrency,
          minCashOnHand
        ),
    isExpanded: expandedPaychecks.has(entryKey) || expandedPaychecks.has(paycheck.date),
    isDropTarget: !isReserved && dropTargetDate === paycheck.date,
    isDragSource: draggedBillSourceDate === paycheck.date,
  };
}
