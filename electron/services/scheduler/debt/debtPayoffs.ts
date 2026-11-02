import type { Bill, Debt } from '@shared/types';
import type { DebtPayoffInfo } from '../types';
import { toCents } from '../money';
import {
  extraPaymentCents,
  simulateMonthlyAmortization,
  DebtWorkCounter,
  dollarsToPrincipalCents,
} from './debtSimulator';

/**
 * Baseline truncation map: schedule start, scheduled bill payment (minimum plus
 * extra already on the bill). Intentionally not "today" and not minimum-only.
 */
export function buildDebtPayoffsFromStart(
  debts: readonly Debt[],
  bills: readonly Bill[],
  startIso: string,
  work = new DebtWorkCounter()
): Map<string, DebtPayoffInfo> {
  const debtPayoffs = new Map<string, DebtPayoffInfo>();
  const billsById = new Map(bills.map((bill) => [bill.id, bill]));

  for (const debt of debts) {
    work.tick();
    const principalCents = dollarsToPrincipalCents(debt.principalBalance);
    if (principalCents === null) continue;
    const linkedBill = billsById.get(debt.billId);
    if (!linkedBill) continue;
    if (!Number.isFinite(debt.apr) || debt.apr > 1) continue;

    const { extraCents, extraType } = extraPaymentCents(
      linkedBill.budgetedAmount,
      debt.monthlyPayment
    );
    const result = simulateMonthlyAmortization(
      {
        principalCents,
        apr: debt.apr,
        monthlyPaymentCents: toCents(debt.monthlyPayment),
        extraCents,
        extraType,
        startIso,
        dueDay: linkedBill.dueDay,
      },
      work
    );
    if (result.monthsToPayoff > 0) {
      const last = result.payments[result.payments.length - 1];
      debtPayoffs.set(debt.billId, {
        billId: debt.billId,
        payoffDate: new Date(`${result.payoffDate}T00:00:00`),
        finalPaymentAmount: last ? last.paymentCents / 100 : linkedBill.budgetedAmount,
      });
    }
  }

  return debtPayoffs;
}
