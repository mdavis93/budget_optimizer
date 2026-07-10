import { describe, expect, it } from 'vitest';
import { parseISO } from 'date-fns';
import { findPreferredPaycheck, getUniquePaycheckDates } from '../../../electron/services/scheduler/assignment';
import { ProjectedBill, PaycheckAssignment, ProjectedIncome } from '../../../electron/services/scheduler/types';

function bill(overrides: Partial<ProjectedBill> & Pick<ProjectedBill, 'billId' | 'date'>): ProjectedBill {
  return {
    creditorName: overrides.billId,
    amount: 100,
    dueDay: overrides.date.getDate(),
    priority: 'normal',
    ...overrides,
  };
}

function paycheck(date: string, sourceId = 'income-1'): PaycheckAssignment {
  return {
    date: parseISO(date),
    incomes: [{ sourceId, sourceName: 'Salary', amount: 1000, date: parseISO(date), cadence: 'weekly' }],
    bills: [],
  };
}

describe('getUniquePaycheckDates', () => {
  it('deduplicates incomes that share a paycheck date', () => {
    const incomes: ProjectedIncome[] = [
      { sourceId: 'a', sourceName: 'A', amount: 1000, date: parseISO('2026-01-01'), cadence: 'weekly' },
      { sourceId: 'b', sourceName: 'B', amount: 500, date: parseISO('2026-01-01'), cadence: 'weekly' },
      { sourceId: 'c', sourceName: 'C', amount: 500, date: parseISO('2026-01-08'), cadence: 'weekly' },
    ];

    expect(getUniquePaycheckDates(incomes).map((date) => date.toISOString())).toEqual([
      parseISO('2026-01-01').toISOString(),
      parseISO('2026-01-08').toISOString(),
    ]);
  });
});

describe('findPreferredPaycheck', () => {
  it('returns the closest eligible preferred paycheck date', () => {
    const result = findPreferredPaycheck(
      bill({ billId: 'bill-1', preferredIncomeSourceId: 'income-1', date: parseISO('2026-01-15') }),
      [paycheck('2026-01-01'), paycheck('2026-01-10')],
      new Set()
    );

    expect(result).toBe('2026-01-10');
  });

  it('skips paychecks listed in skippedBills', () => {
    const result = findPreferredPaycheck(
      bill({ billId: 'bill-1', preferredIncomeSourceId: 'income-1', date: parseISO('2026-01-15') }),
      [paycheck('2026-01-08'), paycheck('2026-01-10')],
      new Set(['bill-1-2026-01-10'])
    );

    expect(result).toBe('2026-01-08');
  });

  it('skips paychecks after the bill due date', () => {
    const result = findPreferredPaycheck(
      bill({ billId: 'bill-1', preferredIncomeSourceId: 'income-1', date: parseISO('2026-01-15') }),
      [paycheck('2026-01-20')],
      new Set()
    );

    expect(result).toBeNull();
  });
});
