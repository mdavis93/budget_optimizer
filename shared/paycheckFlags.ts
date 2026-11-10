export function allBillsSkippedOrUnpayable(
  bills: ReadonlyArray<{ isSkipped?: boolean; isUnpayable?: boolean }>
): boolean {
  return bills.length > 0 && bills.every((bill) => bill.isSkipped || bill.isUnpayable);
}

export function isPaycheckShortfall(input: {
  isReserved: boolean;
  budgetRemaining: number;
  effectiveMin: number;
}): boolean {
  if (input.isReserved) return false;
  return input.budgetRemaining < input.effectiveMin;
}

export function isSavingsSqueezed(
  totalGoalDeposits: number,
  savingsDeposit: number,
  fallbackDollars: number
): boolean {
  return totalGoalDeposits > 0 && savingsDeposit < fallbackDollars;
}
