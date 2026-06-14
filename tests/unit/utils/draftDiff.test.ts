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
  describe('happy', () => {
    it('detects created, updated, and deleted entities in one pass', () => {
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

    it('returns create-only, update-only, and delete-only paths', () => {
      const base: TestEntity[] = [{ id: '1', name: 'A', amount: 10 }];

      const createOnly = computeEntityDiff([], [{ id: 'draft-1', name: 'New', amount: 1 }], (a, b) => a.amount === b.amount);
      const updateOnly = computeEntityDiff(base, [{ id: '1', name: 'A', amount: 11 }], (a, b) => a.amount === b.amount);
      const deleteOnly = computeEntityDiff(base, [], (a, b) => a.amount === b.amount);

      expect(createOnly.created).toHaveLength(1);
      expect(createOnly.updated).toEqual([]);
      expect(createOnly.deleted).toEqual([]);

      expect(updateOnly.created).toEqual([]);
      expect(updateOnly.updated).toEqual([{ id: '1', name: 'A', amount: 11 }]);
      expect(updateOnly.deleted).toEqual([]);

      expect(deleteOnly.created).toEqual([]);
      expect(deleteOnly.updated).toEqual([]);
      expect(deleteOnly.deleted).toEqual(['1']);
    });

    it('detects keyed collection adds/removes/changes', () => {
      const committed = [{ billId: 'b1', skipDate: '2026-01-01' }];
      const draft = [
        { billId: 'b1', skipDate: '2026-01-01', reason: 'manual' },
        { billId: 'b2', skipDate: '2026-02-01', reason: 'manual' },
      ];

      const diff = computeKeyedDiff(
        committed,
        draft,
        (item) => `${item.billId}-${item.skipDate}`,
        (a, b) =>
          a.billId === b.billId &&
          a.skipDate === b.skipDate &&
          (a as { reason?: string }).reason === (b as { reason?: string }).reason
      );

      expect(diff.added).toHaveLength(1);
      expect(diff.removed).toHaveLength(0);
      expect(diff.changed).toHaveLength(1);
    });

    it('replaces draft ids with persisted ids', () => {
      const idMap = new Map([['draft-1', 'real-1']]);
      const items = [{ id: 'draft-1', name: 'Test', amount: 1 }];
      const mapped = applyIdMap(items, idMap);
      expect(mapped[0].id).toBe('real-1');
    });

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

  describe('sad', () => {
    it('returns empty diffs for unchanged collections', () => {
      const committed: TestEntity[] = [{ id: '1', name: 'A', amount: 10 }];
      const draft: TestEntity[] = [{ id: '1', name: 'A', amount: 10 }];

      const diff = computeEntityDiff(
        committed,
        draft,
        (a, b) => a.name === b.name && a.amount === b.amount
      );

      expect(diff.created).toEqual([]);
      expect(diff.updated).toEqual([]);
      expect(diff.deleted).toEqual([]);
    });
  });

  describe('hostile', () => {
    it('leaves bill references unchanged when no mapping exists', () => {
      const bills = [
        { id: 'bill-1', preferredIncomeSourceId: 'income-a' },
        { id: 'bill-2' },
      ];
      const mapped = remapBillReferences(bills, new Map([['other-income', 'income-z']]));

      expect(mapped[0].preferredIncomeSourceId).toBe('income-a');
      expect(mapped[1].preferredIncomeSourceId).toBeUndefined();
    });
  });
});
