import { describe, it, expect } from 'vitest';
import { parseISO } from 'date-fns';
import { solveCluster, solveClusterBounded } from '../../../electron/services/scheduler/solve';

const day = (s: string) => parseISO(s).getTime();

describe('solveCluster', () => {
  it('returns empty array for empty bill list', () => {
    expect(
      solveCluster([{ index: 0, dateMs: day('2026-01-01'), capacityCents: 100_000 }], [])
    ).toEqual([]);
  });

  it('respects locked paycheck index during exact solve', () => {
    const paychecks = [
      { index: 0, dateMs: day('2026-08-14'), capacityCents: 200_000 },
      { index: 1, dateMs: day('2026-08-21'), capacityCents: 200_000 },
    ];
    const bills = [
      {
        billKey: 'locked-2026-08-25',
        amountCents: 50_000,
        dueDateMs: day('2026-08-25'),
        candidateIndices: [0, 1],
        lockedIndex: 0,
      },
    ];

    const result = solveCluster(paychecks, bills);
    expect(result[0].paycheckIndex).toBe(0);
    expect(result[0].isUnpayable).toBe(false);
  });

  it('funds all bills when capacity allows deferral to a later paycheck', () => {
    const paychecks = [
      { index: 0, dateMs: day('2026-08-14'), capacityCents: 265_000 },
      { index: 1, dateMs: day('2026-08-21'), capacityCents: 100_000 },
    ];
    const bills = [
      {
        billKey: 'amazon-2026-08-15',
        amountCents: 16_500,
        dueDateMs: day('2026-08-15'),
        candidateIndices: [0],
      },
      {
        billKey: 'water-2026-08-25',
        amountCents: 10_000,
        dueDateMs: day('2026-08-25'),
        candidateIndices: [0, 1],
      },
    ];

    const result = solveCluster(paychecks, bills);
    const byKey = new Map(result.map((r) => [r.billKey, r]));

    expect(byKey.get('amazon-2026-08-15')?.isUnpayable).toBe(false);
    expect(byKey.get('water-2026-08-25')?.isUnpayable).toBe(false);
    expect(byKey.get('water-2026-08-25')?.paycheckIndex).toBe(1);
  });

  it('minimizes unpaid cents when cluster is infeasible', () => {
    const paychecks = [{ index: 0, dateMs: day('2026-09-04'), capacityCents: 100_000 }];
    const bills = [
      {
        billKey: 'a-2026-09-05',
        amountCents: 60_000,
        dueDateMs: day('2026-09-05'),
        candidateIndices: [0],
      },
      {
        billKey: 'b-2026-09-05',
        amountCents: 60_000,
        dueDateMs: day('2026-09-05'),
        candidateIndices: [0],
      },
    ];

    const result = solveCluster(paychecks, bills);
    const unpaid = result.filter((r) => r.isUnpayable);
    expect(unpaid).toHaveLength(1);
  });

  it('prefers fewer days-early when unpaid is equal', () => {
    const paychecks = [
      { index: 0, dateMs: day('2026-08-14'), capacityCents: 200_000 },
      { index: 1, dateMs: day('2026-08-21'), capacityCents: 200_000 },
    ];
    const bills = [
      {
        billKey: 'bill-2026-08-25',
        amountCents: 50_000,
        dueDateMs: day('2026-08-25'),
        candidateIndices: [0, 1],
      },
    ];

    const result = solveCluster(paychecks, bills);
    expect(result[0].paycheckIndex).toBe(1);
    expect(result[0].isUnpayable).toBe(false);
  });

  it('is deterministic for identical inputs', () => {
    const paychecks = [
      { index: 0, dateMs: day('2026-08-14'), capacityCents: 150_000 },
      { index: 1, dateMs: day('2026-08-21'), capacityCents: 150_000 },
    ];
    const bills = [
      {
        billKey: 'x-2026-08-20',
        amountCents: 80_000,
        dueDateMs: day('2026-08-20'),
        candidateIndices: [0, 1],
      },
      {
        billKey: 'y-2026-08-25',
        amountCents: 80_000,
        dueDateMs: day('2026-08-25'),
        candidateIndices: [0, 1],
      },
    ];

    const a = solveCluster(paychecks, bills);
    const b = solveCluster(paychecks, bills);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('solveClusterBounded', () => {
  it('uses greedy fallback for mega-clusters over 16 bills', () => {
    const paychecks = [
      { index: 0, dateMs: day('2026-08-01'), capacityCents: 1_000_000 },
      { index: 1, dateMs: day('2026-08-08'), capacityCents: 1_000_000 },
    ];
    const bills = Array.from({ length: 17 }, (_, index) => ({
      billKey: `bill-${index}-2026-08-10`,
      amountCents: 10_000,
      dueDateMs: day('2026-08-10'),
      candidateIndices: [0, 1],
    }));

    const result = solveClusterBounded(paychecks, bills);

    expect(result).toHaveLength(17);
    expect(result.every((entry) => !entry.isUnpayable)).toBe(true);
  });

  it('marks bills unpayable in greedy fallback when no capacity remains', () => {
    const paychecks = [{ index: 0, dateMs: day('2026-09-01'), capacityCents: 50_000 }];
    const bills = Array.from({ length: 17 }, (_, index) => ({
      billKey: `bill-${index}-2026-09-05`,
      amountCents: 10_000,
      dueDateMs: day('2026-09-05'),
      candidateIndices: [0],
    }));

    const result = solveClusterBounded(paychecks, bills);
    const unpaid = result.filter((entry) => entry.isUnpayable);

    expect(unpaid.length).toBeGreaterThan(0);
  });

  it('respects locked paycheck index during greedy fallback', () => {
    const paychecks = [
      { index: 0, dateMs: day('2026-08-01'), capacityCents: 1_000_000 },
      { index: 1, dateMs: day('2026-08-08'), capacityCents: 1_000_000 },
    ];
    const bills = [
      ...Array.from({ length: 16 }, (_, index) => ({
        billKey: `bill-${index}-2026-08-10`,
        amountCents: 10_000,
        dueDateMs: day('2026-08-10'),
        candidateIndices: [0, 1],
      })),
      {
        billKey: 'locked-2026-08-10',
        amountCents: 10_000,
        dueDateMs: day('2026-08-10'),
        candidateIndices: [0, 1],
        lockedIndex: 0,
      },
    ];

    const result = solveClusterBounded(paychecks, bills);
    const locked = result.find((entry) => entry.billKey === 'locked-2026-08-10');

    expect(locked?.paycheckIndex).toBe(0);
    expect(locked?.isUnpayable).toBe(false);
  });

  it('defers overloaded greedy assignments to later paychecks', () => {
    const paychecks = [
      { index: 0, dateMs: day('2026-10-01'), capacityCents: 120_000 },
      { index: 1, dateMs: day('2026-10-08'), capacityCents: 500_000 },
    ];
    const bills = Array.from({ length: 17 }, (_, index) => ({
      billKey: `bill-${index}-2026-10-15`,
      amountCents: 50_000,
      dueDateMs: day('2026-10-15'),
      candidateIndices: [0, 1],
    }));

    const result = solveClusterBounded(paychecks, bills);
    const onFirst = result.filter((entry) => entry.paycheckIndex === 0 && !entry.isUnpayable);

    expect(onFirst.length).toBeLessThan(17);
  });
});
