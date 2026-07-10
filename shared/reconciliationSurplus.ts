/**
 * Bill-move capacity for reconciliation — mirrors rebalance target/min tiers.
 */
export function movableBillCapacity(
  budgetRemaining: number,
  targetCashOnHand: number,
  minCashOnHand: number,
  isShortfall: boolean
): number {
  if (isShortfall || budgetRemaining < minCashOnHand) {
    return 0;
  }
  if (budgetRemaining >= targetCashOnHand) {
    return budgetRemaining - targetCashOnHand;
  }
  return budgetRemaining - minCashOnHand;
}
