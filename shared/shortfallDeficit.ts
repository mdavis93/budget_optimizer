/** Amount a shortfall paycheck is below its minimum cash floor. */
export function shortfallDeficitAmount(
  budgetRemaining: number,
  minCashOnHand: number
): number {
  return Math.round(Math.max(0, minCashOnHand - budgetRemaining) * 100) / 100;
}
