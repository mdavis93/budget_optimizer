/** Convert dollars to integer cents for deterministic arithmetic. */
export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

/** Convert integer cents back to dollars (2 decimal places). */
export function fromCents(cents: number): number {
  return Math.round(cents) / 100;
}
