import { DEFAULT_CURRENCY } from './settingsDefaults';

export type FormatCurrencyOptions = {
  /** Whole dollars when 0; default is 2 decimal places. */
  fractionDigits?: 0 | 2;
};

let defaultCurrency = DEFAULT_CURRENCY;

export function setDefaultCurrency(currency: string): void {
  defaultCurrency = currency || DEFAULT_CURRENCY;
}

export function getDefaultCurrency(): string {
  return defaultCurrency;
}

export function formatCurrency(
  amount: number,
  currency = defaultCurrency,
  options?: FormatCurrencyOptions
): string {
  const fractionDigits = options?.fractionDigits ?? 2;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || DEFAULT_CURRENCY,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(amount);
}
