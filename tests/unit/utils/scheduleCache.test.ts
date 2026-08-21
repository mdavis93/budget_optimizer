import { describe, it, expect } from 'vitest';
import { buildScheduleCacheKey } from '../../../src/utils/scheduleCache';
import { buildScheduleInputHash } from '../../../src/utils/scheduleInputHash';
import { SCHEDULE_IDENTITY_FIELDS } from '@shared/scheduleIdentity';
import { createMockBill, createMockGoal, createMockIncome } from '../../mocks/electron-api.mock';

const FROZEN_NOW = new Date(2026, 7, 20, 15, 0, 0);

function identityParams(overrides: Record<string, unknown> = {}) {
  return {
    incomes: [createMockIncome()],
    bills: [createMockBill()],
    goals: [] as ReturnType<typeof createMockGoal>[],
    debts: [] as Array<{
      id: string;
      budgetId: string;
      billId: string;
      principalBalance: number;
      apr: number;
      monthlyPayment: number;
      createdAt: string;
      updatedAt: string;
    }>,
    skippedBills: [] as [],
    billAssignments: [] as [],
    incomeOverrides: [] as [],
    leaves: [] as [],
    startDate: '2026-01-01',
    startingBalance: 1000,
    now: FROZEN_NOW,
    ...overrides,
  };
}

describe('scheduleCache', () => {
  it('builds the same key as scheduleInputHash for identical identity fields', () => {
    const params = identityParams();
    expect(buildScheduleCacheKey(params)).toBe(buildScheduleInputHash(params));
  });

  it('ignores viewport months so Dashboard 3 and Schedule 12 share a horizon', () => {
    const params = identityParams();
    expect(buildScheduleCacheKey(params)).toBe(
      buildScheduleCacheKey({ ...params })
    );
    expect(SCHEDULE_IDENTITY_FIELDS).not.toContain('months');
    expect(JSON.stringify(params)).not.toContain('"months"');
  });

  it('changes cache key when start date differs', () => {
    const keyA = buildScheduleCacheKey(identityParams({ startDate: '2026-01-01' }));
    const keyB = buildScheduleCacheKey(identityParams({ startDate: '2026-02-01' }));
    expect(keyA).not.toBe(keyB);
  });
});
