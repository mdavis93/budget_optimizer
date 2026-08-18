import {
  formatCurrency as formatShared,
  getDefaultCurrency,
  setDefaultCurrency,
  type FormatCurrencyOptions,
} from '@shared/formatCurrency';

export type { FormatCurrencyOptions };
export { getDefaultCurrency, setDefaultCurrency };

export function formatCurrency(amount: number, options?: FormatCurrencyOptions): string {
  return formatShared(amount, getDefaultCurrency(), options);
}
