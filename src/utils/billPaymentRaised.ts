import { toCents } from '@shared/money';
import type { PaycheckBill } from '../types';

/** True when charged amount is strictly above this occurrence's series floor. */
export function isBillPaymentRaised(bill: Pick<PaycheckBill, 'amount' | 'seriesAmount'>): boolean {
  const series = bill.seriesAmount ?? bill.amount;
  return toCents(bill.amount) > toCents(series);
}

export function billPaymentEditorKey(billId: string, billDate: string): string {
  return `${billId}\0${billDate}`;
}
