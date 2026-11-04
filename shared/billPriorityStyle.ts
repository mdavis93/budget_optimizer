import type { BillPriority } from './billPriority';

export interface BillPriorityStyle {
  text: string;
  billsIconWrap: string;
  billsIcon: string;
  billsBadge: string;
  paycheckBadge: string;
  reconciliationDot: string;
  pdfBackground: string;
  pdfColor: string;
}

export const BILL_PRIORITY_STYLES: Record<BillPriority, BillPriorityStyle> = {
  critical: {
    text: 'text-danger-500',
    billsIconWrap: 'bg-danger-100 dark:bg-danger-500/20',
    billsIcon: 'text-danger-600 dark:text-danger-500',
    billsBadge: 'bg-danger-100 text-danger-700 dark:bg-danger-900 dark:text-danger-200',
    paycheckBadge: 'bg-danger-200 text-danger-800 dark:bg-danger-800 dark:text-danger-200',
    reconciliationDot: 'bg-danger-500',
    pdfBackground: '#fecaca',
    pdfColor: '#991b1b',
  },
  high: {
    text: 'text-warning-500',
    billsIconWrap: 'bg-warning-100 dark:bg-warning-500/20',
    billsIcon: 'text-warning-600 dark:text-warning-500',
    billsBadge: 'bg-warning-100 text-warning-800 dark:bg-warning-900 dark:text-warning-200',
    paycheckBadge: 'bg-warning-200 text-warning-800 dark:bg-warning-800 dark:text-warning-200',
    reconciliationDot: 'bg-warning-500',
    pdfBackground: '#fde68a',
    pdfColor: '#92400e',
  },
  normal: {
    text: 'text-primary-500',
    billsIconWrap: 'bg-primary-100 dark:bg-primary-500/20',
    billsIcon: 'text-primary-600 dark:text-primary-500',
    billsBadge: 'bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-200',
    paycheckBadge: 'bg-primary-200 text-primary-800 dark:bg-primary-800 dark:text-primary-200',
    reconciliationDot: 'bg-primary-500',
    pdfBackground: '#bfdbfe',
    pdfColor: '#1e40af',
  },
  low: {
    text: 'text-(--color-text-muted)',
    billsIconWrap: 'bg-(--color-bg-tertiary)',
    billsIcon: 'text-(--color-text-muted)',
    billsBadge: 'bg-(--color-bg-tertiary) text-(--color-text-secondary)',
    paycheckBadge: 'bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
    reconciliationDot: 'bg-gray-400',
    pdfBackground: '#e5e7eb',
    pdfColor: '#374151',
  },
};
