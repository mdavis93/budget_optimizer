function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

export function formatTooltipCurrencyPair(
  value: unknown,
  formatCurrency: (amount: number) => string,
  label: string
): [string, string] {
  return [formatCurrency(toNumber(value)), label];
}

export function formatTooltipCurrencyValue(
  value: unknown,
  formatCurrency: (amount: number) => string
): string {
  return formatCurrency(toNumber(value));
}

export function formatTooltipDollarPair(
  value: unknown,
  name: string
): [string, string] {
  const label = name.charAt(0).toUpperCase() + name.slice(1);
  return [`$${toNumber(value).toFixed(2)}`, label];
}

export const CHART_COLORS = {
  primary: '#3b82f6',
  success: '#22c55e',
  danger: '#ef4444',
  warning: '#f59e0b',
  purple: '#a855f7',
  cyan: '#06b6d4',
  pink: '#ec4899',
  teal: '#14b8a6',
  orange: '#f97316',
  lime: '#84cc16',
  indigo: '#6366f1',
  principal: '#3b82f6',
  interest: '#f59e0b',
};
