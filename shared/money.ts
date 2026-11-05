export const CENTS_PER_DOLLAR = 100;

/** Convert dollars to integer cents for deterministic arithmetic. */
export function toCents(amount: number): number {
  return Math.round(amount * CENTS_PER_DOLLAR);
}

/** Convert integer cents back to dollars (2 decimal places). */
export function fromCents(cents: number): number {
  return Math.round(cents) / CENTS_PER_DOLLAR;
}

export function roundCurrency(amount: number): number {
  return Math.round(amount * CENTS_PER_DOLLAR) / CENTS_PER_DOLLAR;
}
