import { describe, it, expect } from 'vitest';
import { formatCurrency } from '../../../src/utils/formatCurrency';

describe('formatCurrency', () => {
  it('formats USD with two decimal places by default', () => {
    expect(formatCurrency(1234.5)).toBe('$1,234.50');
  });

  it('formats whole dollars when fractionDigits is 0', () => {
    expect(formatCurrency(1234.5, { fractionDigits: 0 })).toBe('$1,235');
  });
});
