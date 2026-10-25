import { describe, expect, it } from 'vitest';
import { parseISO } from 'date-fns';
import { dropLookaheadAssignments } from '../../../electron/services/scheduler/lookahead';
import type { PaycheckAssignment, ProjectedBill } from '../../../electron/services/scheduler/types';

function bill(overrides: Partial<ProjectedBill> & Pick<ProjectedBill, 'billId' | 'date'>): ProjectedBill {
  return {
    creditorName: overrides.billId,
    amount: 200,
    dueDay: overrides.date.getDate(),
    priority: 'normal',
    ...overrides,
  };
}

function assignment(
  date: string,
  bills: ProjectedBill[] = [],
  purpose?: PaycheckAssignment['purpose']
): PaycheckAssignment {
  return {
    date: parseISO(date),
    incomes: [{ sourceId: 'inc-1', sourceName: 'Job', amount: 2000, date: parseISO(date) }],
    bills,
    purpose,
  };
}

describe('dropLookaheadAssignments', () => {
  describe('happy', () => {
    it('keeps funding-horizon paychecks and drops the two-month buffer', () => {
      const kept = dropLookaheadAssignments(
        [
          assignment('2026-12-18', [bill({ billId: 'dec', date: parseISO('2026-12-18') })]),
          assignment('2027-01-01', [bill({ billId: 'early-jan', date: parseISO('2027-01-05') })]),
          assignment('2027-01-15', [bill({ billId: 'late-jan', date: parseISO('2027-01-25') })]),
          assignment('2027-02-15', [bill({ billId: 'feb', date: parseISO('2027-02-20') })]),
        ],
        parseISO('2027-01-01')
      );

      expect(kept.map((item) => item.date.toISOString())).toEqual([
        parseISO('2026-12-18').toISOString(),
        parseISO('2027-01-01').toISOString(),
      ]);
      expect(kept[1].bills.map((item) => item.billId)).toEqual(['early-jan']);
      expect(kept.some((item) => item.bills.some((entry) => entry.billId === 'late-jan'))).toBe(false);
      expect(kept.some((item) => item.bills.some((entry) => entry.billId === 'feb'))).toBe(false);
    });
  });

  describe('sad', () => {
    it('does not throw on an empty paycheck list', () => {
      expect(dropLookaheadAssignments([], parseISO('2027-01-01'))).toEqual([]);
    });

    it('leaves in-horizon bills unchanged when there are no lookahead paychecks', () => {
      const assignments = [
        assignment('2026-12-15', [bill({ billId: 'current', date: parseISO('2026-12-15') })]),
        assignment('2027-01-01'),
      ];
      const kept = dropLookaheadAssignments(assignments, parseISO('2027-01-01'));
      expect(kept).toHaveLength(2);
      expect(kept[0].bills).toHaveLength(1);
      expect(kept[1].bills).toEqual([]);
    });
  });
});
