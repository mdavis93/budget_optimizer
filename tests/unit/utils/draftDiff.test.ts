import { describe, it, expect, vi } from 'vitest';
import {
  computeEntityDiff,
  computeKeyedDiff,
  applyIdMap,
  applyIdMapToField,
  remapBillReferences,
  remapDebtBillIds,
  persistEntityDiff,
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

    it('detects removed keyed entries absent from draft', () => {
      const committed = [
        { billId: 'b1', skipDate: '2026-01-01', reason: 'manual' },
        { billId: 'b2', skipDate: '2026-02-01', reason: 'manual' },
      ];
      const draft = [{ billId: 'b1', skipDate: '2026-01-01', reason: 'manual' }];

      const diff = computeKeyedDiff(
        committed,
        draft,
        (item) => `${item.billId}-${item.skipDate}`,
        (a, b) =>
          a.billId === b.billId &&
          a.skipDate === b.skipDate &&
          a.reason === b.reason
      );

      expect(diff.removed).toHaveLength(1);
      expect(diff.removed[0].billId).toBe('b2');
    });

    it('maps string field ids through applyIdMapToField', () => {
      const idMap = new Map([['draft-a', 'real-a']]);
      expect(applyIdMapToField(['draft-a', 'real-b'], idMap)).toEqual(['real-a', 'real-b']);
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

    it('leaves bill ids unchanged when no mapping exists', () => {
      const mapped = remapDebtBillIds([{ id: 'debt-1', billId: 'bill-1' }], new Map());
      expect(mapped[0].billId).toBe('bill-1');
    });
  });

  describe('persistEntityDiff', () => {
    const baseOptions = {
      isDraftId: (id: string) => id.startsWith('draft-'),
      toCreateInput: (item: TestEntity) => ({ name: item.name, amount: item.amount }),
      toUpdateInput: (item: TestEntity) => ({ name: item.name, amount: item.amount }),
      create: async () => ({ success: true, data: { id: 'real-1', name: 'A', amount: 1 } }),
      update: async () => ({ success: true, data: { id: '1', name: 'A', amount: 1 } }),
      remove: async () => ({ success: true }),
    };

    it('skips draft ids on delete and update', async () => {
      const remove = vi.fn(async () => ({ success: true }));
      const update = vi.fn(async () => ({ success: true }));

      const result = await persistEntityDiff(
        {
          created: [],
          updated: [{ id: 'draft-2', name: 'B', amount: 2 }],
          deleted: ['draft-1', 'real-9'],
        },
        { ...baseOptions, remove, update }
      );

      expect(result.success).toBe(true);
      expect(remove).toHaveBeenCalledWith('real-9');
      expect(remove).not.toHaveBeenCalledWith('draft-1');
      expect(update).not.toHaveBeenCalled();
    });

    it('returns failure when delete, update, or create fails', async () => {
      await expect(
        persistEntityDiff(
          { created: [], updated: [], deleted: ['real-1'] },
          { ...baseOptions, remove: async () => ({ success: false }) }
        )
      ).resolves.toEqual({ success: false, error: 'Failed to delete item' });

      await expect(
        persistEntityDiff(
          { created: [], updated: [{ id: 'real-1', name: 'A', amount: 2 }], deleted: [] },
          { ...baseOptions, update: async () => ({ success: false, error: 'nope' }) }
        )
      ).resolves.toEqual({ success: false, error: 'nope' });

      await expect(
        persistEntityDiff(
          { created: [{ id: 'draft-1', name: 'New', amount: 1 }], updated: [], deleted: [] },
          { ...baseOptions, create: async () => ({ success: true }) }
        )
      ).resolves.toEqual({ success: false, error: 'Failed to create item' });
    });

    it('maps created draft ids to persisted ids', async () => {
      const result = await persistEntityDiff(
        {
          created: [{ id: 'draft-1', name: 'New', amount: 5 }],
          updated: [],
          deleted: [],
        },
        {
          ...baseOptions,
          create: async () => ({ success: true, data: { id: 'persisted-1', name: 'New', amount: 5 } }),
        }
      );

      expect(result).toEqual({
        success: true,
        idMap: new Map([['draft-1', 'persisted-1']]),
      });
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
