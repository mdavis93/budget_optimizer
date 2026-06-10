import { describe, it, expect } from 'vitest';
import {
  computeEntityDiff,
  computeKeyedDiff,
  applyIdMap,
  remapBillReferences,
  remapDebtBillIds,
} from '../../../src/utils/draftDiff';

interface TestEntity {
  id: string;
  name: string;
  amount: number;
}

describe('draftDiff', () => {
  describe('computeEntityDiff', () => {
    it('detects created, updated, and deleted entities', () => {
      const committed: TestEntity[] = [
        { id: '1', name: 'A', amount: 10 },
        { id: '2', name: 'B', amount: 20 },
      ];
      const draft: TestEntity[] = [
        { id: '1', name: 'A', amount: 15 },
        { id: 'draft-3', name: 'C', amount: 30 },
      ];

      const diff = computeEntityDiff(
        committed,
        draft,
        (a, b) => a.name === b.name && a.amount === b.amount
      );

      expect(diff.deleted).toEqual(['2']);
      expect(diff.updated).toEqual([{ id: '1', name: 'A', amount: 15 }]);
      expect(diff.created).toEqual([{ id: 'draft-3', name: 'C', amount: 30 }]);
    });
  });

  describe('computeKeyedDiff', () => {
    it('detects keyed collection changes', () => {
      const committed = [{ billId: 'b1', skipDate: '2026-01-01' }];
      const draft = [
        { billId: 'b1', skipDate: '2026-01-01' },
        { billId: 'b2', skipDate: '2026-02-01' },
      ];

      const diff = computeKeyedDiff(
        committed,
        draft,
        (item) => `${item.billId}-${item.skipDate}`,
        (a, b) => a.billId === b.billId && a.skipDate === b.skipDate
      );

      expect(diff.added).toHaveLength(1);
      expect(diff.removed).toHaveLength(0);
      expect(diff.changed).toHaveLength(0);
    });
  });

  describe('applyIdMap', () => {
    it('replaces draft ids with persisted ids', () => {
      const idMap = new Map([['draft-1', 'real-1']]);
      const items = [{ id: 'draft-1', name: 'Test', amount: 1 }];
      const mapped = applyIdMap(items, idMap);
      expect(mapped[0].id).toBe('real-1');
    });
  });

  describe('remapBillReferences', () => {
    it('remaps preferred income source ids', () => {
      const idMap = new Map([['draft-income', 'income-1']]);
      const bills = [{ preferredIncomeSourceId: 'draft-income' }];
      const mapped = remapBillReferences(bills, idMap);
      expect(mapped[0].preferredIncomeSourceId).toBe('income-1');
    });
  });

  describe('remapDebtBillIds', () => {
    it('remaps linked bill ids on debts', () => {
      const idMap = new Map([['draft-bill', 'bill-1']]);
      const debts = [{ id: 'debt-1', billId: 'draft-bill' }];
      const mapped = remapDebtBillIds(debts, idMap);
      expect(mapped[0].billId).toBe('bill-1');
    });
  });
});
