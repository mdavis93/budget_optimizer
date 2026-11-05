export * from '@shared/types';
export { PRIORITY_LABELS } from '@shared/billPriority';
export { CADENCE_LABELS } from '@shared/incomeCadence';

import type { Bill } from '@shared/types';
import { BILL_PRIORITY_STYLES } from '@shared/billPriorityStyle';
import { CHART_COLORS } from '../components/charts/chartTheme';

export const PRIORITY_COLORS: Record<Bill['priority'], string> = {
  critical: BILL_PRIORITY_STYLES.critical.text,
  high: BILL_PRIORITY_STYLES.high.text,
  normal: BILL_PRIORITY_STYLES.normal.text,
  low: BILL_PRIORITY_STYLES.low.text,
};

export const BILL_CATEGORY_CATALOG = [
  { name: 'Housing', chartColor: CHART_COLORS.primary },
  { name: 'Utilities', chartColor: CHART_COLORS.warning },
  { name: 'Transportation', chartColor: CHART_COLORS.purple },
  { name: 'Insurance', chartColor: CHART_COLORS.cyan },
  { name: 'Debt', chartColor: CHART_COLORS.danger },
  { name: 'Subscriptions', chartColor: CHART_COLORS.pink },
  { name: 'Food', chartColor: CHART_COLORS.success },
  { name: 'Healthcare', chartColor: CHART_COLORS.teal },
  { name: 'Entertainment', chartColor: CHART_COLORS.orange },
  { name: 'Savings', chartColor: CHART_COLORS.lime },
  { name: 'Other', chartColor: CHART_COLORS.indigo },
] as const;

export const CATEGORY_OPTIONS = BILL_CATEGORY_CATALOG.map((category) => category.name);

export type Category = (typeof BILL_CATEGORY_CATALOG)[number]['name'];

export const DEBT_CATEGORY = 'Debt';

export function billCategoryChartColor(name: string): string {
  const match = BILL_CATEGORY_CATALOG.find((category) => category.name === name);
  return match?.chartColor ?? CHART_COLORS.indigo;
}
