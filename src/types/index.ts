export * from '@shared/types';

import type { Income, Bill } from '@shared/types';

export const CADENCE_LABELS: Record<Income['cadence'], string> = {
  weekly: 'Weekly',
  biweekly: 'Bi-weekly',
  semimonthly: 'Semi-monthly',
  monthly: 'Monthly',
};

export const PRIORITY_LABELS: Record<Bill['priority'], string> = {
  critical: 'Critical',
  high: 'High',
  normal: 'Normal',
  low: 'Low',
};

export const PRIORITY_COLORS: Record<Bill['priority'], string> = {
  critical: 'text-danger-500',
  high: 'text-warning-500',
  normal: 'text-primary-500',
  low: 'text-[var(--color-text-muted)]',
};

export const CATEGORY_OPTIONS = [
  'Housing',
  'Utilities',
  'Transportation',
  'Insurance',
  'Debt',
  'Subscriptions',
  'Food',
  'Healthcare',
  'Entertainment',
  'Savings',
  'Other',
] as const;

export type Category = typeof CATEGORY_OPTIONS[number];
