export const PRIORITY_ORDER: Record<'critical' | 'high' | 'normal' | 'low', number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

export function roundCurrency(amount: number): number {
  return Math.round(amount * 100) / 100;
}

export function formatCurrency(amount: number): string {
  return amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
