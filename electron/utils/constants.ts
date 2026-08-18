import { PRIORITY_LABELS } from '@shared/constants';

export { PRIORITY_LABELS };

export const PRIORITY_ORDER: Record<'critical' | 'high' | 'normal' | 'low', number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

export function roundCurrency(amount: number): number {
  return Math.round(amount * 100) / 100;
}

export { formatCurrency, formatCurrency as formatCurrencyDisplay } from '@shared/formatCurrency';
