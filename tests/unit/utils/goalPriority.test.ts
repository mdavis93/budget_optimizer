import { describe, expect, it } from 'vitest';
import {
  assignPriorityFromOpenEnded,
  compactGoalPriorities,
  compareGoalsByPriority,
  goalsWithPrioritySwap,
  MAX_GOAL_PRIORITY,
  nextAvailableGoalPriority,
} from '../../../shared/goalPriority';

function goal(id: string, priority: number) {
  return { id, priority };
}

describe('goalPriority', () => {
  describe('nextAvailableGoalPriority', () => {
    it('returns the lowest unused priority', () => {
      expect(nextAvailableGoalPriority([])).toBe(1);
      expect(nextAvailableGoalPriority([goal('a', 1)])).toBe(2);
      expect(nextAvailableGoalPriority([goal('a', 1), goal('b', 3)])).toBe(2);
    });

    it('returns max when every slot is taken', () => {
      const full = [1, 2, 3, 4, 5].map((priority) => goal(String(priority), priority));
      expect(nextAvailableGoalPriority(full)).toBe(MAX_GOAL_PRIORITY);
    });

    it('ignores open-ended goals when finding a free rank', () => {
      expect(nextAvailableGoalPriority([
        goal('a', 1),
        { id: 'open', priority: 0, openEnded: true },
      ])).toBe(2);
    });
  });

  describe('goalsWithPrioritySwap', () => {
    it('swaps with the occupant of the target priority', () => {
      const result = goalsWithPrioritySwap(
        [goal('a', 3), goal('b', 1)],
        { movingId: 'a', fromPriority: 3, toPriority: 1 }
      );
      expect(result).toEqual([goal('a', 1), goal('b', 3)]);
    });

    it('is a no-op when from and to are the same', () => {
      const goals = [goal('a', 2), goal('b', 1)];
      expect(goalsWithPrioritySwap(goals, { movingId: 'a', fromPriority: 2, toPriority: 2 })).toEqual(goals);
    });

    it('moves onto a free slot without changing others', () => {
      const result = goalsWithPrioritySwap(
        [goal('a', 1), goal('b', 2)],
        { movingId: 'a', fromPriority: 1, toPriority: 4 }
      );
      expect(result).toEqual([goal('a', 4), goal('b', 2)]);
    });

    it('ignores the mover when finding an occupant', () => {
      const result = goalsWithPrioritySwap(
        [goal('a', 1), goal('b', 2)],
        { movingId: 'a', fromPriority: 1, toPriority: 1 }
      );
      expect(result).toEqual([goal('a', 1), goal('b', 2)]);
    });
  });

  describe('compactGoalPriorities', () => {
    it('shifts later ranks down after a gap', () => {
      expect(compactGoalPriorities([goal('a', 1), goal('b', 2), goal('d', 4), goal('e', 5)])).toEqual([
        goal('a', 1),
        goal('b', 2),
        goal('d', 3),
        goal('e', 4),
      ]);
    });

    it('leaves an already dense list unchanged', () => {
      const goals = [goal('a', 1), goal('b', 2), goal('c', 3)];
      expect(compactGoalPriorities(goals)).toEqual(goals);
    });

    it('keeps an open-ended goal out of the dated ranks', () => {
      expect(compactGoalPriorities([
        { id: 'a', priority: 1 },
        { id: 'b', priority: 3 },
        { id: 'open', priority: 2, openEnded: true },
      ])).toEqual([
        { id: 'a', priority: 1 },
        { id: 'b', priority: 2 },
        { id: 'open', priority: 0, openEnded: true },
      ]);
    });
  });

  describe('open-ended ranking', () => {
    it('sorts open-ended goals after every dated goal', () => {
      const goals = [
        { id: 'open', priority: 0, openEnded: true, createdAt: '2026-01-01' },
        { id: 'low', priority: 5, createdAt: '2026-01-02' },
        { id: 'high', priority: 1, createdAt: '2026-01-03' },
      ];
      expect([...goals].sort(compareGoalsByPriority).map((entry) => entry.id)).toEqual(['high', 'low', 'open']);
    });

    it('moves an occupant aside when an open-ended goal takes a dated rank', () => {
      expect(assignPriorityFromOpenEnded(
        [
          { id: 'dated', priority: 1 },
          { id: 'open', priority: 0, openEnded: true },
        ],
        'open',
        1
      )).toEqual([
        { id: 'dated', priority: 2 },
        { id: 'open', priority: 1, openEnded: false },
      ]);
    });
  });
});
