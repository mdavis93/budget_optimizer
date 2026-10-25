/** Auto-legal prepay window: solver, rebalance, preferred income, reconciliation, and the drag confirmation floor. Silent — no user confirmation. */
export const MAX_PREPAY_DAYS = 20;
/** Break-Glass advisor search radius only; never auto-applied. Steps past MAX_PREPAY_DAYS require confirmation. */
export const MAX_ADVISOR_EARLY_DAYS = 28;
export const SCHEDULE_CALCULATION_MONTHS = 12;
/** Extra months solved past the funding horizon so the last funded month can reserve the next month's bills. */
export const SCHEDULE_LOOKAHEAD_MONTHS = 2;
export const SCHEDULE_MAX_CALCULATION_MONTHS = 60;
export const DEFAULT_TARGET_CASH_ON_HAND = 250;
export const DEFAULT_MIN_CASH_ON_HAND = 100;

export const PRIORITY_LABELS: Record<'critical' | 'high' | 'normal' | 'low', string> = {
  critical: 'Critical',
  high: 'High',
  normal: 'Normal',
  low: 'Low',
};
