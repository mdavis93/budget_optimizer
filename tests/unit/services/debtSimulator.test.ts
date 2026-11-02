import { describe, expect, it } from 'vitest';
import { DebtService } from '../../../electron/services/debt.service';
import {
  DEBT_MAX_WORK,
  DebtWorkCounter,
  simulateMonthlyAmortization,
} from '../../../electron/services/scheduler/debt/debtSimulator';
import { toCents } from '../../../electron/services/scheduler/money';

describe('debtSimulator', () => {
  it('matches DebtService payoff and interest for the same start date, principal, APR, and payment', () => {
    const service = new DebtService();
    const start = new Date('2026-01-15T00:00:00');
    const fromService = service.calculateAmortization(1000, 0.12, 100, 0, 'none', start, 15);
    const fromSimulator = simulateMonthlyAmortization({
      principalCents: toCents(1000),
      apr: 0.12,
      monthlyPaymentCents: toCents(100),
      startIso: '2026-01-15',
      dueDay: 15,
    });
    expect(fromSimulator.monthsToPayoff).toBe(fromService.monthsToPayoff);
    expect(fromSimulator.totalInterestCents).toBe(Math.round(fromService.totalInterest * 100));
    expect(fromSimulator.payoffDate).toBe(fromService.payoffDate);
  });

  it('caps a zero payment with interest and flags never-payoff', () => {
    const result = simulateMonthlyAmortization({
      principalCents: toCents(5000),
      apr: 0.24,
      monthlyPaymentCents: 0,
      startIso: '2026-01-01',
      dueDay: 1,
    });
    expect(result.monthsToPayoff).toBe(-1);
    expect(result.capped).toBe(true);
    expect(result.paymentBelowInterest).toBe(true);
    expect(result.payoffDate).toBe('Never');
  });

  it('keeps 100 debts over 60 months under DEBT_MAX_WORK', () => {
    const work = new DebtWorkCounter();
    for (let i = 0; i < 100; i++) {
      simulateMonthlyAmortization(
        {
          principalCents: toCents(1000),
          apr: 0.1,
          monthlyPaymentCents: toCents(50),
          startIso: '2026-01-01',
          dueDay: 1,
        },
        work
      );
    }
    expect(work.count).toBeLessThan(DEBT_MAX_WORK);
  });
});
