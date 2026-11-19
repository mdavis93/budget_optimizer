import { billOccurrenceKeyFromIso } from '@shared/billOccurrence';
import { fromCents, toCents } from './money';

/**
 * Charged amount for one occurrence. A finite override above zero replaces
 * the series amount for that date, including amounts below the series.
 * Non-finite, non-positive, and cent-equal overrides keep the series amount.
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
    toCents(override) <= 0 ||
    toCents(override) === seriesCents
  ) {
    return fromCents(seriesCents);
  }

  return fromCents(toCents(override));
}
