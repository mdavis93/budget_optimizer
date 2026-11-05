/** Auto-legal prepay window: eligibility, preferred income, reconciliation, and the drag confirmation floor. Silent — no user confirmation. */
export const MAX_PREPAY_DAYS = 20;
/** Break-Glass advisor early-day cap only; never auto-applied. Steps past MAX_PREPAY_DAYS require confirmation. */
export const MAX_ADVISOR_EARLY_DAYS = 28;
export const SCHEDULE_CALCULATION_MONTHS = 12;
export const SCHEDULE_MAX_CALCULATION_MONTHS = 60;
export const DEFAULT_TARGET_CASH_ON_HAND = 250;
export const DEFAULT_MIN_CASH_ON_HAND = 100;
export const DEFAULT_MIN_SAVINGS_PER_PAYCHECK = 0;

export { PRIORITY_LABELS } from './billPriority';
