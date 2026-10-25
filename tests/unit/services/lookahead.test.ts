import { describe, expect, it } from 'vitest';
import { addDays, parseISO } from 'date-fns';
import { MAX_PREPAY_DAYS } from '@shared/constants';
import {
  billsEligibleOnFundingHorizon,
  dropLookaheadAssignments,
  resolveSolveEndDate,
} from '../../../electron/services/scheduler/lookahead';
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
    it('keeps funding-horizon paychecks and drops paychecks after the funding end', () => {
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

describe('billsEligibleOnFundingHorizon', () => {
  describe('happy', () => {
    it('keeps a bill that can land on the last funded paycheck', () => {
      const kept = billsEligibleOnFundingHorizon(
        [
          bill({ billId: 'early-jan', date: parseISO('2027-01-05') }),
          bill({ billId: 'late-jan', date: parseISO('2027-01-25') }),
        ],
        [parseISO('2026-12-18'), parseISO('2027-01-01'), parseISO('2027-01-15')],
        parseISO('2027-01-01')
      );
      expect(kept.map((item) => item.billId)).toEqual(['early-jan']);
    });
  });

  describe('sad', () => {
    it('keeps an in-horizon bill that has no eligible paycheck', () => {
      const kept = billsEligibleOnFundingHorizon(
        [bill({ billId: 'in-horizon', date: parseISO('2026-12-28') })],
        [parseISO('2026-12-01')],
        parseISO('2027-01-01')
      );
      expect(kept.map((item) => item.billId)).toEqual(['in-horizon']);
    });

    it('omits a post-horizon bill when no funded paycheck is eligible', () => {
      const kept = billsEligibleOnFundingHorizon(
        [bill({ billId: 'late-jan', date: parseISO('2027-01-25') })],
        [parseISO('2026-12-18'), parseISO('2027-01-01'), parseISO('2027-01-15')],
        parseISO('2027-01-01')
      );
      expect(kept).toEqual([]);
    });
  });
});

describe('resolveSolveEndDate', () => {
  it('extends the funding end by MAX_PREPAY_DAYS', () => {
    const fundingEnd = parseISO('2027-01-01');
    expect(resolveSolveEndDate(fundingEnd).toISOString()).toBe(
      addDays(fundingEnd, MAX_PREPAY_DAYS).toISOString()
    );
  });
});
