import { billOccurrenceKeyFromIso } from '@shared/billOccurrence';
import { fromCents, toCents } from './money';

/**
 * Charged amount for one occurrence: override only when finite and strictly
 * above the series floor (compared in cents).
 */
export function resolveBillOccurrenceAmount(
  billId: string,
  date: string,
  seriesAmount: number,
  overrides: Map<string, number> | undefined
): number {
  const seriesCents = toCents(seriesAmount);
  if (!overrides || overrides.size === 0) {
    return fromCents(seriesCents);
  }

  const override = overrides.get(billOccurrenceKeyFromIso(billId, date));
  if (
    typeof override !== 'number' ||
    !Number.isFinite(override) ||
    toCents(override) <= seriesCents
  ) {
    return fromCents(seriesCents);
  }

  return fromCents(toCents(override));
}
