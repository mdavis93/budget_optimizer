export function isBreakGlassBand(budgetRemaining: number, target: number, min: number): boolean {
  return budgetRemaining < target && budgetRemaining >= min;
}

export function isLabeledBreakGlassPaycheck(
  paycheck: { isShortfall?: boolean; budgetRemaining: number; targetCashOnHand?: number; minCashOnHand?: number },
  fallbackTarget: number,
  fallbackMin: number
): boolean {
  const target = paycheck.targetCashOnHand ?? fallbackTarget;
  const min = paycheck.minCashOnHand ?? fallbackMin;
  return paycheck.isShortfall !== true && isBreakGlassBand(paycheck.budgetRemaining, target, min);
}
