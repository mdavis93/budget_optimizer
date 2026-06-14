/**
 * Paycheck pressure scoring for automatic bill assignment (Phase B).
 * Kept pure for unit testing without running the full scheduler pipeline.
 */

export interface PaycheckPressureSnapshot {
  billLoadRatio: number;
  goalReserve: number;
  income: number;
  billTotal: number;
}

export function scoreEligiblePaycheck(
  daysEarly: number,
  pressure: PaycheckPressureSnapshot,
  billAmount: number,
  minCashOnHand: number,
  minSavingsPerPaycheck: number
): number {
  const reliefHeadroom =
    pressure.income -
    pressure.billTotal -
    minCashOnHand -
    minSavingsPerPaycheck -
    pressure.goalReserve -
    billAmount;
  return (
    -daysEarly * 10 -
    pressure.billLoadRatio * 100 +
    Math.max(0, reliefHeadroom) * 0.05 -
    pressure.goalReserve * 0.1
  );
}
