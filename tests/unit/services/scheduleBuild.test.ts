import { format } from 'date-fns';
import { describe, expect, it } from 'vitest';
import type { Bill, Income } from '@shared/types';
import {
  assembleAssignedSchedule,
  assignPreparedHorizon,
  prepareScheduleHorizon,
} from '../../../electron/services/scheduler/scheduleBuild';

const income: Income = {
  id: 'inc-1',
  sourceName: 'Job',
  amount: 2000,
  cadence: 'biweekly',
  startDate: '2026-01-02',
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function rent(overrides: Partial<Bill> = {}): Bill {
  return {
    id: 'bill-1',
    creditorName: 'Rent',
    budgetedAmount: 800,
    dueDay: 5,
    isRecurring: true,
    priority: 'critical',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('scheduleBuild', () => {
  it('dedupes occurrences, records skipped bills, and can assemble without presentation', () => {
    const prepared = prepareScheduleHorizon({
      incomes: [income],
      bills: [rent(), rent()],
      startDateStr: '2026-01-01',
      startingBalance: 1000,
      skippedBills: new Set(['bill-1-2026-01-05']),
    });

    expect(prepared.skippedForDisplay.length).toBeGreaterThan(0);
    expect(
      prepared.uniqueBills.some((bill) => format(bill.date, 'yyyy-MM-dd') === '2026-01-05')
    ).toBe(false);

    const paychecks = assignPreparedHorizon(prepared);
    const dryRun = assembleAssignedSchedule(prepared, paychecks, {
      includePresentation: false,
    });
    expect(dryRun.entries).toEqual([]);
    expect(dryRun.recommendations).toEqual([]);
    expect(dryRun.goalProjections).toBeUndefined();
  });
});
