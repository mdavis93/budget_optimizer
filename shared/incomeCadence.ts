export const INCOME_CADENCES = [
  { value: 'weekly', shortLabel: 'Weekly', longLabel: 'Weekly' },
  { value: 'biweekly', shortLabel: 'Bi-weekly', longLabel: 'Bi-weekly (every 2 weeks)' },
  { value: 'semimonthly', shortLabel: 'Semi-monthly', longLabel: 'Semi-monthly (1st and 15th)' },
  { value: 'monthly', shortLabel: 'Monthly', longLabel: 'Monthly' },
] as const;

export type IncomeCadence = (typeof INCOME_CADENCES)[number]['value'];

export const INCOME_CADENCE_VALUES = INCOME_CADENCES.map((cadence) => cadence.value);

export const CADENCE_LABELS = Object.fromEntries(
  INCOME_CADENCES.map((cadence) => [cadence.value, cadence.shortLabel])
) as Record<IncomeCadence, string>;
