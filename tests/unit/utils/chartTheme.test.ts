import { describe, expect, it } from 'vitest';
import {
  formatTooltipCurrencyPair,
  formatTooltipCurrencyValue,
  formatTooltipDollarPair,
} from '@/components/charts/chartTheme';

const formatCurrency = (amount: number) => `$${amount.toFixed(2)}`;

describe('chart tooltip formatters', () => {
  it('formats currency pairs from numbers and strings', () => {
    expect(formatTooltipCurrencyPair(42.5, formatCurrency, 'Balance')).toEqual([
      '$42.50',
      'Balance',
    ]);
    expect(formatTooltipCurrencyPair('100', formatCurrency, 'Balance')).toEqual([
      '$100.00',
      'Balance',
    ]);
  });

  it('falls back to zero for invalid tooltip values', () => {
    expect(formatTooltipCurrencyPair(undefined, formatCurrency, 'Balance')).toEqual([
      '$0.00',
      'Balance',
    ]);
    expect(formatTooltipCurrencyPair('', formatCurrency, 'Balance')).toEqual([
      '$0.00',
      'Balance',
    ]);
    expect(formatTooltipCurrencyPair('not-a-number', formatCurrency, 'Balance')).toEqual([
      '$0.00',
      'Balance',
    ]);
  });

  it('formats single currency values', () => {
    expect(formatTooltipCurrencyValue(12.3, formatCurrency)).toBe('$12.30');
    expect(formatTooltipCurrencyValue(undefined, formatCurrency)).toBe('$0.00');
  });

  it('formats dollar pairs with capitalized labels', () => {
    expect(formatTooltipDollarPair(10, 'principal')).toEqual(['$10.00', 'Principal']);
    expect(formatTooltipDollarPair(undefined, 'interest')).toEqual(['$0.00', 'Interest']);
  });
});
