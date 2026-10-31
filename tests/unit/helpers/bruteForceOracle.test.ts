import { describe, expect, it } from 'vitest';
import { UNPAID_PLACEMENT } from '../../../electron/services/scheduler/model/objective';
import {
  MAX_ORACLE_BILLS,
  MAX_ORACLE_PAYCHECKS,
  bruteForceOracle,
  type OracleBill,
  type OraclePaycheck,
} from '../../helpers/bruteForceOracle';

function paycheck(
  overrides: Partial<OraclePaycheck> & Pick<OraclePaycheck, 'day' | 'capacityCents'>
): OraclePaycheck {
  return {
    minCashCents: 0,
    targetCashCents: 0,
    ...overrides,
  };
}

function bill(overrides: Partial<OracleBill> & Pick<OracleBill, 'amountCents' | 'dueDay'>): OracleBill {
  return {
    priority: 'low',
    eligiblePaycheckIndexes: [0],
    ...overrides,
  };
}

describe('bruteForceOracle', () => {
  it('rejects instances above the brute-force limits', () => {
    const tinyPaycheck = paycheck({ day: 0, capacityCents: 100 });
    const tinyBill = bill({ amountCents: 1, dueDay: 0 });
    expect(() =>
      bruteForceOracle({
        bills: Array.from({ length: MAX_ORACLE_BILLS + 1 }, () => tinyBill),
        paychecks: [tinyPaycheck],
      })
    ).toThrow(/at most 8 bills/);
    expect(() =>
      bruteForceOracle({
        bills: [tinyBill],
        paychecks: Array.from({ length: MAX_ORACLE_PAYCHECKS + 1 }, () => tinyPaycheck),
      })
    ).toThrow(/at most 8 bills/);
  });

  it('rejects an eligible or fixed paycheck outside the list', () => {
    expect(() =>
      bruteForceOracle({
        bills: [bill({ amountCents: 1, dueDay: 0, eligiblePaycheckIndexes: [4] })],
        paychecks: [paycheck({ day: 0, capacityCents: 100 })],
      })
    ).toThrow(/outside the paycheck list/);
    expect(() =>
      bruteForceOracle({
        bills: [bill({ amountCents: 1, dueDay: 0, fixedPaycheckIndex: 1, eligiblePaycheckIndexes: [] })],
        paychecks: [paycheck({ day: 0, capacityCents: 100 })],
      })
    ).toThrow(/outside the paycheck list/);
  });

  it('leaves a bill with no paycheck unpaid in its tier, and pins locks at T0', () => {
    const unpaid = bruteForceOracle({
      bills: [bill({ amountCents: 100, dueDay: 5, priority: 'low', eligiblePaycheckIndexes: [] })],
      paychecks: [paycheck({ day: 5, capacityCents: 1_000 })],
    });
    expect(unpaid.placement).toEqual([UNPAID_PLACEMENT]);
    expect(unpaid.vector).toEqual([0, 0, 0, 0, 100, 0, 0, 0]);

    const pinned = bruteForceOracle({
      bills: [bill({
        amountCents: 100,
        dueDay: 5,
        priority: 'critical',
        eligiblePaycheckIndexes: [],
        isPinned: true,
      })],
      paychecks: [paycheck({ day: 5, capacityCents: 1_000 })],
    });
    expect(pinned.vector[0]).toBe(100);
    expect(pinned.vector[1]).toBe(0);
  });

  it('pays a bill that has a paycheck even when that drops the cash floor', () => {
    const result = bruteForceOracle({
      bills: [bill({ amountCents: 5_000, dueDay: 10, priority: 'low' })],
      paychecks: [paycheck({
        day: 10,
        capacityCents: 10_000,
        minCashCents: 8_000,
        targetCashCents: 8_000,
      })],
    });
    expect(result.placement).toEqual([0]);
    expect(result.vector[4]).toBe(0);
    expect(result.vector[5]).toBe(3_000);
  });

  it('never plans a paycheck negative', () => {
    const tooBig = bruteForceOracle({
      bills: [bill({ amountCents: 5_001, dueDay: 10, priority: 'critical' })],
      paychecks: [paycheck({ day: 10, capacityCents: 5_000 })],
    });
    expect(tooBig.placement).toEqual([UNPAID_PLACEMENT]);
    expect(tooBig.vector[1]).toBe(5_001);

    const onlyOneFits = bruteForceOracle({
      bills: [
        bill({ amountCents: 3_000, dueDay: 10, priority: 'low' }),
        bill({ amountCents: 3_000, dueDay: 10, priority: 'critical' }),
      ],
      paychecks: [paycheck({ day: 10, capacityCents: 5_000 })],
    });
    expect(onlyOneFits.placement).toEqual([UNPAID_PLACEMENT, 0]);

    const pinnedTooBig = bruteForceOracle({
      bills: [bill({
        amountCents: 6_000,
        dueDay: 10,
        eligiblePaycheckIndexes: [],
        fixedPaycheckIndex: 0,
        isPinned: true,
      })],
      paychecks: [paycheck({ day: 10, capacityCents: 5_000 })],
    });
    expect(pinnedTooBig.placement).toEqual([UNPAID_PLACEMENT]);
    expect(pinnedTooBig.vector[0]).toBe(6_000);
  });

  it('allows an overdrawn paycheck when nothing is paid on it', () => {
    const result = bruteForceOracle({
      bills: [bill({ amountCents: 100, dueDay: 10 })],
      paychecks: [paycheck({ day: 10, capacityCents: -500, minCashCents: 0, targetCashCents: 0 })],
    });
    expect(result.placement).toEqual([UNPAID_PLACEMENT]);
    expect(result.vector[4]).toBe(100);
  });

  it('pays a fixed bill when the eligible list is empty', () => {
    const result = bruteForceOracle({
      bills: [bill({
        amountCents: 100,
        dueDay: 10,
        eligiblePaycheckIndexes: [],
        fixedPaycheckIndex: 0,
        isPinned: true,
      })],
      paychecks: [paycheck({ day: 10, capacityCents: 500 })],
    });
    expect(result.placement).toEqual([0]);
    expect(result.vector).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('protects the floor, then the target, then pays later when those tie', () => {
    const floor = bruteForceOracle({
      bills: [bill({ amountCents: 2_000, dueDay: 10, eligiblePaycheckIndexes: [0, 1] })],
      paychecks: [
        paycheck({ day: 0, capacityCents: 8_000, minCashCents: 2_500, targetCashCents: 2_500 }),
        paycheck({ day: 10, capacityCents: 3_000, minCashCents: 2_500, targetCashCents: 2_500 }),
      ],
    });
    expect(floor.placement).toEqual([0]);

    const target = bruteForceOracle({
      bills: [bill({ amountCents: 2_000, dueDay: 10, eligiblePaycheckIndexes: [0, 1] })],
      paychecks: [
        paycheck({ day: 0, capacityCents: 20_000, minCashCents: 0, targetCashCents: 4_000 }),
        paycheck({ day: 10, capacityCents: 5_000, minCashCents: 0, targetCashCents: 4_000 }),
      ],
    });
    expect(target.placement).toEqual([0]);

    const later = bruteForceOracle({
      bills: [bill({ amountCents: 2_000, dueDay: 10, eligiblePaycheckIndexes: [0, 1] })],
      paychecks: [
        paycheck({ day: 0, capacityCents: 20_000, minCashCents: 0, targetCashCents: 4_000 }),
        paycheck({ day: 10, capacityCents: 20_000, minCashCents: 0, targetCashCents: 4_000 }),
      ],
    });
    expect(later.placement).toEqual([1]);
    expect(later.vector[7]).toBe(0);
  });

  it('keeps the earliest paycheck when two assignments share a tier vector', () => {
    const result = bruteForceOracle({
      bills: [bill({ amountCents: 100, dueDay: 4, eligiblePaycheckIndexes: [0, 1] })],
      paychecks: [
        paycheck({ day: 4, capacityCents: 1_000 }),
        paycheck({ day: 4, capacityCents: 1_000 }),
      ],
    });
    expect(result.placement).toEqual([0]);
  });

  it('accepts a full 8-bill 4-paycheck instance', () => {
    const result = bruteForceOracle({
      bills: Array.from({ length: MAX_ORACLE_BILLS }, (_, index) =>
        bill({
          amountCents: 100,
          dueDay: index,
          eligiblePaycheckIndexes: [index % MAX_ORACLE_PAYCHECKS],
        })
      ),
      paychecks: Array.from({ length: MAX_ORACLE_PAYCHECKS }, (_, index) =>
        paycheck({ day: index, capacityCents: 10_000 })
      ),
    });
    expect(result.placement).toHaveLength(MAX_ORACLE_BILLS);
    expect(result.placement.every((index) => index !== UNPAID_PLACEMENT)).toBe(true);
  });

  it('scores an empty bill list from paycheck cash alone', () => {
    const result = bruteForceOracle({
      bills: [],
      paychecks: [paycheck({ day: 0, capacityCents: 1_000, minCashCents: 0, targetCashCents: 2_000 })],
    });
    expect(result.placement).toEqual([]);
    expect(result.vector[6]).toBe(1_000);
  });
});
