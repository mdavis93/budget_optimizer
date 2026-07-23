import { describe, expect, it } from 'vitest';
import { applyProjectedIncomeAdjustments } from '../../../electron/services/scheduler/incomeAdjustments';
import type { ProjectedIncome } from '../../../electron/services/scheduler/types';
import { createMockLeave } from '../../mocks/electron-api.mock';

function makeProjected(overrides: Partial<ProjectedIncome> = {}): ProjectedIncome {
  return {
    date: new Date('2026-02-05T12:00:00'),
    sourceId: 'income-1',
    sourceName: 'Salary',
    amount: 2000,
    ...overrides,
  };
}

describe('applyProjectedIncomeAdjustments', () => {
  it('omits unpaid leave pay dates and leaves paid untouched', () => {
    const unpaid = createMockLeave({
      type: 'unpaid',
      startDate: '2026-02-01',
      endDate: '2026-02-14',
    });
    const paid = createMockLeave({
      id: 'leave-2',
      type: 'paid',
      startDate: '2026-02-01',
      endDate: '2026-02-14',
    });
    const events = [
      makeProjected({ date: new Date('2026-02-01T12:00:00'), amount: 2000 }),
      makeProjected({ date: new Date('2026-02-14T12:00:00'), amount: 2000 }),
      makeProjected({ date: new Date('2026-02-15T12:00:00'), amount: 2000 }),
      makeProjected({
        date: new Date('2026-02-05T12:00:00'),
        sourceId: 'income-2',
        amount: 900,
      }),
    ];

    applyProjectedIncomeAdjustments(events, [unpaid, paid]);

    expect(events).toHaveLength(2);
    expect(events.map((e) => e.date.toISOString().slice(0, 10)).sort()).toEqual([
      '2026-02-05',
      '2026-02-15',
    ]);
    expect(events.find((e) => e.sourceId === 'income-2')?.amount).toBe(900);
    expect(events.find((e) => e.date.toISOString().startsWith('2026-02-15'))?.amount).toBe(2000);
  });

  it('lets income overrides win and keep a leave paycheck when amount is positive', () => {
    const unpaid = createMockLeave({
      type: 'unpaid',
      startDate: '2026-02-01',
      endDate: '2026-02-28',
    });
    const events = [makeProjected({ date: new Date('2026-02-05T12:00:00'), amount: 2000 })];
    const overrides = new Map([['income-1-2026-02-05', 750]]);

    applyProjectedIncomeAdjustments(events, [unpaid], overrides);

    expect(events).toHaveLength(1);
    expect(events[0].amount).toBe(750);
  });

  it('omits leave paychecks even when override sets amount to zero', () => {
    const unpaid = createMockLeave({
      type: 'unpaid',
      startDate: '2026-02-01',
      endDate: '2026-02-28',
    });
    const events = [makeProjected({ date: new Date('2026-02-05T12:00:00'), amount: 2000 })];
    const overrides = new Map([['income-1-2026-02-05', 0]]);

    applyProjectedIncomeAdjustments(events, [unpaid], overrides);

    expect(events).toHaveLength(0);
  });

  it('keeps a shared pay date when only one source is on unpaid leave', () => {
    const unpaid = createMockLeave({
      type: 'unpaid',
      incomeId: 'angela',
      startDate: '2026-09-01',
      endDate: '2026-09-30',
    });
    const events = [
      makeProjected({
        date: new Date('2026-09-18T12:00:00'),
        sourceId: 'angela',
        sourceName: 'Angela',
        amount: 1000,
      }),
      makeProjected({
        date: new Date('2026-09-18T12:00:00'),
        sourceId: 'michael',
        sourceName: 'Michael',
        amount: 2000,
      }),
    ];

    applyProjectedIncomeAdjustments(events, [unpaid]);

    expect(events).toHaveLength(1);
    expect(events[0].sourceId).toBe('michael');
    expect(events[0].amount).toBe(2000);
  });

  it('is a no-op with empty leaves and no overrides', () => {
    const events = [makeProjected()];
    applyProjectedIncomeAdjustments(events);
    expect(events[0].amount).toBe(2000);
  });
});
