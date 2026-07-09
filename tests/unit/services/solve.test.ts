import { describe, it, expect } from 'vitest';
import { parseISO } from 'date-fns';
import { solveCluster } from '../../../electron/services/scheduler/solve';

const day = (s: string) => parseISO(s).getTime();

describe('solveCluster', () => {
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
