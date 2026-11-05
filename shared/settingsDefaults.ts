export const DEFAULT_THEME = 'system' as const;
export const DEFAULT_CURRENCY = 'USD';
export const DEFAULT_AUTO_LOCK_MINUTES = 5;
export const DEFAULT_SAVINGS_APY = 0;
export const MIN_SAVINGS_APY = 0;
export const MAX_SAVINGS_APY = 100;
export const MIN_AUTO_LOCK_MINUTES = 0;
export const MAX_AUTO_LOCK_MINUTES = 1440;

export function clampSavingsApy(value: number): number {
  return Math.min(MAX_SAVINGS_APY, Math.max(MIN_SAVINGS_APY, value));
}
