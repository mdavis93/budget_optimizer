import { EligibleBill } from './eligibility';

class UnionFind {
  private parent: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
  }

  find(x: number): number {
    if (this.parent[x] !== x) {
      this.parent[x] = this.find(this.parent[x]);
    }
    return this.parent[x];
  }

  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[rb] = ra;
  }
}

/**
 * Group bills into independent clusters: bills that share any eligible paycheck
 * must be solved together; otherwise capacity is partitioned exactly.
 */
export function clusterEligibleBills(eligible: EligibleBill[]): EligibleBill[][] {
  const n = eligible.length;
  if (n === 0) return [];

  const uf = new UnionFind(n);
  const paycheckToBillIndices = new Map<number, number[]>();

  for (let bi = 0; bi < n; bi++) {
    for (const pi of eligible[bi].candidateIndices) {
      if (!paycheckToBillIndices.has(pi)) {
        paycheckToBillIndices.set(pi, []);
      }
      paycheckToBillIndices.get(pi)!.push(bi);
    }
  }

  for (const billIndices of paycheckToBillIndices.values()) {
    for (let i = 1; i < billIndices.length; i++) {
      uf.union(billIndices[0], billIndices[i]);
    }
  }

  const groups = new Map<number, EligibleBill[]>();
  for (let bi = 0; bi < n; bi++) {
    const root = uf.find(bi);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(eligible[bi]);
  }

  return Array.from(groups.values()).map((group) =>
    group.sort((a, b) => a.billKey.localeCompare(b.billKey))
  );
}
