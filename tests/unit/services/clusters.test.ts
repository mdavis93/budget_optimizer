import { describe, it, expect } from 'vitest';
import { parseISO } from 'date-fns';
import { clusterEligibleBills } from '../../../electron/services/scheduler/clusters';
import { EligibleBill } from '../../../electron/services/scheduler/eligibility';
import { ProjectedBill } from '../../../electron/services/scheduler/types';

function eligible(key: string, candidates: number[], amount = 100): EligibleBill {
  const date = parseISO('2026-08-25');
  const bill: ProjectedBill = {
    date,
    billId: key,
    creditorName: key,
    amount,
    dueDay: 25,
    priority: 'normal',
  };
  return { bill, billKey: `${key}-${key}`, candidateIndices: candidates };
}

describe('clusters', () => {
  it('puts bills sharing a paycheck in the same cluster', () => {
    const clusters = clusterEligibleBills([
      eligible('a', [0, 1]),
      eligible('b', [1, 2]),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toHaveLength(2);
  });

  it('splits disjoint bill windows into separate clusters', () => {
    const clusters = clusterEligibleBills([
      eligible('a', [0]),
      eligible('b', [2]),
    ]);
    expect(clusters).toHaveLength(2);
  });
});
