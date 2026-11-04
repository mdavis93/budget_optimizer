import { roundCurrency } from './money';

/** Amount a shortfall paycheck is below its minimum cash floor. */
export function shortfallDeficitAmount(
  budgetRemaining: number,
  minCashOnHand: number
): number {
  return roundCurrency(Math.max(0, minCashOnHand - budgetRemaining));
}
