export const BILL_PRIORITIES = ['critical', 'high', 'normal', 'low'] as const;

export type BillPriority = (typeof BILL_PRIORITIES)[number];

export const PRIORITY_LABELS: Record<BillPriority, string> = {
  critical: 'Critical',
  high: 'High',
  normal: 'Normal',
  low: 'Low',
};

export const PRIORITY_ORDER: Record<BillPriority, number> = {
  critical: BILL_PRIORITIES.indexOf('critical'),
  high: BILL_PRIORITIES.indexOf('high'),
  normal: BILL_PRIORITIES.indexOf('normal'),
  low: BILL_PRIORITIES.indexOf('low'),
};

export function priorityTier(priority: BillPriority): 1 | 2 | 3 | 4 {
  return (PRIORITY_ORDER[priority] + 1) as 1 | 2 | 3 | 4;
}

export function priorityFromTier(tier: number): BillPriority {
  return BILL_PRIORITIES[tier - 1] ?? 'low';
}
