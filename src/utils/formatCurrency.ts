export type FormatCurrencyOptions = {
  /** Whole dollars when 0; default is 2 decimal places. */
  fractionDigits?: 0 | 2;
};

export function formatCurrency(amount: number, options?: FormatCurrencyOptions): string {
  const fractionDigits = options?.fractionDigits ?? 2;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(amount);
}
