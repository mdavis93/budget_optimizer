import { format } from 'date-fns';

export const ISO_DATE_LENGTH = 10;
export const OCCURRENCE_KEY_SEPARATOR_OFFSET = 11;

export function billOccurrenceKeyFromIso(billId: string, isoDate: string): string {
  return `${billId}-${isoDate}`;
}

export function billOccurrenceKey(billId: string, date: Date): string {
  return billOccurrenceKeyFromIso(billId, format(date, 'yyyy-MM-dd'));
}
