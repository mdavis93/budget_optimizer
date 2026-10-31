import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MIN_CASH_ON_HAND,
  DEFAULT_TARGET_CASH_ON_HAND,
} from '@shared/constants';
import type { PaycheckBill, PaycheckEntry } from '@shared/types';
import {
  TIER_COUNT,
  UNPAID_PLACEMENT,
  compareTierVectors,
  isoDateToDayNumber,
  scoreObjective,
  scoreSchedule,
  type ObjectiveBill,
  type ObjectivePaycheck,
  type TierVector,
} from '../../../electron/services/scheduler/model/objective';

function bill(overrides: Partial<ObjectiveBill> & Pick<ObjectiveBill, 'amountCents' | 'priority' | 'dueDay'>): ObjectiveBill {
  return { ...overrides };
}

function paycheck(
  overrides: Partial<ObjectivePaycheck> &
    Pick<ObjectivePaycheck, 'day' | 'remainingCents' | 'minCashCents' | 'targetCashCents'>
): ObjectivePaycheck {
  return { ...overrides };
}

function zeros(): TierVector {
  return [0, 0, 0, 0, 0, 0, 0, 0];
}

function enginePaycheck(
  overrides: Partial<PaycheckEntry> & Pick<PaycheckEntry, 'date' | 'budgetRemaining'>
): PaycheckEntry {
  return {
    incomeSources: [],
    totalIncome: 0,
    bills: [],
    totalBills: 0,
    goalDeposits: [],
    totalGoalDeposits: 0,
    savingsDeposit: 0,
    totalSavings: 0,
    isShortfall: false,
    ...overrides,
  };
}

function engineBill(
  overrides: Partial<PaycheckBill> &
    Pick<PaycheckBill, 'billId' | 'amount' | 'billDate' | 'priority'>
): PaycheckBill {
  return {
    creditorName: overrides.billId,
    dueDay: 1,
    ...overrides,
  };
}

describe('isoDateToDayNumber', () => {
  it('counts calendar days from the unix epoch', () => {
    expect(isoDateToDayNumber('1970-01-01')).toBe(0);
    expect(isoDateToDayNumber('2026-01-02') - isoDateToDayNumber('2026-01-01')).toBe(1);
    expect(isoDateToDayNumber('2024-03-01') - isoDateToDayNumber('2024-02-28')).toBe(2);
  });
});

describe('scoreObjective', () => {
  const payday = paycheck({ day: 10, remainingCents: 0, minCashCents: 0, targetCashCents: 0 });

  it('rejects a placement that does not match the bills', () => {
    expect(() =>
      scoreObjective({
        bills: [bill({ amountCents: 100, priority: 'low', dueDay: 10 })],
        paychecks: [payday],
        placement: [],
      })
    ).toThrow(/placement length 0/);
  });

  it('rejects a placement outside the paycheck list', () => {
    const bills = [bill({ amountCents: 100, priority: 'low', dueDay: 10 })];
    const input = { bills, paychecks: [payday] };
    expect(() => scoreObjective({ ...input, placement: [1.5] })).toThrow(/outside the paycheck list/);
    expect(() => scoreObjective({ ...input, placement: [-2] })).toThrow(/outside the paycheck list/);
    expect(() => scoreObjective({ ...input, placement: [1] })).toThrow(/outside the paycheck list/);
  });

  it('puts pinned unpaid cents in T0 and other unpaid cents in the priority tier', () => {
    const vector = scoreObjective({
      bills: [
        bill({ amountCents: 500, priority: 'critical', dueDay: 10, isPinned: true }),
        bill({ amountCents: 400, priority: 'critical', dueDay: 10 }),
        bill({ amountCents: 300, priority: 'high', dueDay: 10 }),
        bill({ amountCents: 200, priority: 'normal', dueDay: 10 }),
        bill({ amountCents: 100, priority: 'low', dueDay: 10 }),
      ],
      paychecks: [payday],
      placement: [
        UNPAID_PLACEMENT,
        UNPAID_PLACEMENT,
        UNPAID_PLACEMENT,
        UNPAID_PLACEMENT,
        UNPAID_PLACEMENT,
      ],
    });
    expect(vector).toEqual([500, 400, 300, 200, 100, 0, 0, 0]);
  });

  it('counts whole-dollar-days only when a bill is paid early', () => {
    const early = scoreObjective({
      bills: [bill({ amountCents: 1050, priority: 'normal', dueDay: 12 })],
      paychecks: [paycheck({ day: 10, remainingCents: 5000, minCashCents: 0, targetCashCents: 0 })],
      placement: [0],
    });
    expect(early[7]).toBe(22);

    const onTime = scoreObjective({
      bills: [bill({ amountCents: 1050, priority: 'normal', dueDay: 10 })],
      paychecks: [payday],
      placement: [0],
    });
    expect(onTime[7]).toBe(0);

    const late = scoreObjective({
      bills: [bill({ amountCents: 1050, priority: 'normal', dueDay: 8 })],
      paychecks: [payday],
      placement: [0],
    });
    expect(late[7]).toBe(0);
  });

  it('scores cash floors on operating paychecks and skips reserved ones', () => {
    const vector = scoreObjective({
      bills: [],
      paychecks: [
        paycheck({ day: 1, remainingCents: 5_000, minCashCents: 10_000, targetCashCents: 25_000 }),
        paycheck({ day: 2, remainingCents: 10_000, minCashCents: 10_000, targetCashCents: 25_000 }),
        paycheck({ day: 3, remainingCents: 25_000, minCashCents: 10_000, targetCashCents: 25_000 }),
        paycheck({ day: 4, remainingCents: 40_000, minCashCents: 10_000, targetCashCents: 25_000 }),
        paycheck({
          day: 5,
          remainingCents: 0,
          minCashCents: 10_000,
          targetCashCents: 25_000,
          countsTowardCashFloors: false,
        }),
      ],
      placement: [],
    });
    expect(vector).toEqual([0, 0, 0, 0, 0, 5_000, 20_000 + 15_000, 0]);
  });
});

describe('compareTierVectors', () => {
  it('orders vectors lexicographically', () => {
    const base = zeros();
    expect(compareTierVectors(base, base)).toBe(0);
    expect(compareTierVectors([0, 0, 0, 0, 0, 0, 0, 1], base)).toBe(1);
    expect(compareTierVectors(base, [1, 0, 0, 0, 0, 0, 0, 0])).toBe(-1);
    expect(compareTierVectors([0, 0, 0, 0, 1, 9, 0, 0], [0, 0, 0, 0, 2, 0, 0, 0])).toBe(-1);
  });
});

describe('scoreSchedule', () => {
  it('uses default cash floors when a paycheck omits them', () => {
    const vector = scoreSchedule([
      enginePaycheck({ date: '2026-01-02', budgetRemaining: 0 }),
    ]);
    expect(vector).toHaveLength(TIER_COUNT);
    expect(vector[5]).toBe(DEFAULT_MIN_CASH_ON_HAND * 100);
    expect(vector[6]).toBe(DEFAULT_TARGET_CASH_ON_HAND * 100);
  });

  it('adds unpaid bills back to remaining, skips reserved paychecks, and ignores skipped bills', () => {
    const vector = scoreSchedule(
      [
        enginePaycheck({
          date: '2026-01-16',
          budgetRemaining: -20,
          minCashOnHand: 100,
          targetCashOnHand: 150,
          purpose: 'operating',
          bills: [
            engineBill({
              billId: 'rent',
              amount: 50,
              billDate: '2026-01-20',
              priority: 'critical',
              isUnpayable: true,
            }),
            engineBill({
              billId: 'dues',
              amount: 25,
              billDate: '2026-01-16',
              priority: 'critical',
              isIncomeAttached: true,
              isUnpayable: true,
            }),
            engineBill({
              billId: 'gym',
              amount: 10.4,
              billDate: '2026-01-18',
              priority: 'low',
            }),
            engineBill({
              billId: 'skipped',
              amount: 999,
              billDate: '2026-01-16',
              priority: 'critical',
              isSkipped: true,
              isUnpayable: true,
            }),
          ],
        }),
        enginePaycheck({
          date: '2026-01-01',
          budgetRemaining: 0,
          minCashOnHand: 100,
          targetCashOnHand: 250,
          purpose: 'savingsAndGoals',
          bills: [
            engineBill({
              billId: 'ghost',
              amount: 5,
              billDate: '2026-01-01',
              priority: 'low',
              isUnpayable: true,
            }),
          ],
        }),
      ],
      new Set(['rent-2026-01-20'])
    );

    expect(vector[0]).toBe(7_500);
    expect(vector[1]).toBe(0);
    expect(vector[4]).toBe(500);
    expect(vector[5]).toBe(4_500);
    expect(vector[6]).toBe(9_500);
    expect(vector[7]).toBe(20);
  });
});
