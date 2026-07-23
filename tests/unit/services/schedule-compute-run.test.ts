import { describe, expect, it } from 'vitest';
import {
  computeScheduleInputHash,
  deserializeScheduleComputeInput,
  serializeScheduleComputeInput,
} from '../../../electron/services/schedule-compute-serialize';
import { runScheduleCompute } from '../../../electron/services/schedule-compute-run';
import { SCHEDULE_COMPUTE_PROTOCOL_VERSION } from '@shared/scheduleComputeProtocol';
import {
  assertScheduleComputeSuccessMessage,
  estimatePayloadBytes,
} from '@shared/scheduleComputeValidate';
import type { Income, Bill } from '@shared/types';

describe('schedule compute serialize', () => {
  it('round-trips Maps/Sets/Dates for unpaid-leave style inputs', () => {
    const native = {
      incomes: [{ id: 'inc-1' }],
      bills: [{ id: 'bill-1' }],
      startDate: '2026-01-01',
      months: 12,
      startingBalance: 500,
      skippedBills: new Set(['bill-1-2026-01-15']),
      manualAssignments: new Map([['bill-1-2026-02-01', '2026-01-31']]),
      targetCashOnHand: 250,
      goals: [],
      minCashOnHand: 100,
      minSavingsPerPaycheck: 25,
      debtPayoffs: new Map([
        [
          'bill-1',
          {
            billId: 'bill-1',
            payoffDate: new Date('2026-06-01T00:00:00.000Z'),
            finalPaymentAmount: 40,
          },
        ],
      ]),
      incomeOverrides: new Map([['inc-1-2026-01-15', 0]]),
      leaves: [
        {
          id: 'leave-1',
          incomeId: 'inc-1',
          startDate: '2026-03-01',
          endDate: '2026-03-31',
          kind: 'unpaid',
        },
      ],
      nowIso: '2026-01-10T12:00:00.000Z',
    };

    const serialized = serializeScheduleComputeInput(native);
    const restored = deserializeScheduleComputeInput(serialized);

    expect(restored.skippedBills.has('bill-1-2026-01-15')).toBe(true);
    expect(restored.manualAssignments.get('bill-1-2026-02-01')).toBe('2026-01-31');
    expect(restored.incomeOverrides.get('inc-1-2026-01-15')).toBe(0);
    expect(restored.debtPayoffs.get('bill-1')?.payoffDate.toISOString()).toBe(
      '2026-06-01T00:00:00.000Z'
    );
    expect(computeScheduleInputHash('schedule', serialized)).toHaveLength(64);
  });
});

describe('schedule compute validate', () => {
  it('accepts a minimal valid schedule result', () => {
    const message = {
      type: 'result' as const,
      protocolVersion: SCHEDULE_COMPUTE_PROTOCOL_VERSION,
      jobId: 'j1',
      inputHash: 'h1',
      op: 'schedule' as const,
      schedule: {
        startDate: '2026-01-01',
        endDate: '2026-01-31',
        paychecks: [],
        fullPaychecks: [],
        viewportMonths: 1,
        entries: [],
        summary: {
          totalIncome: 0,
          totalExpenses: 0,
          netBalance: 0,
          shortfallCount: 0,
        },
        recommendations: [],
        maxBudgetRemaining: 250,
        minCashOnHand: 100,
        extraFutureField: true,
      },
    };

    expect(() =>
      assertScheduleComputeSuccessMessage(message, {
        jobId: 'j1',
        inputHash: 'h1',
        op: 'schedule',
      })
    ).not.toThrow();
    expect(estimatePayloadBytes(message)).toBeGreaterThan(0);
  });

  it('rejects mismatched jobId', () => {
    expect(() =>
      assertScheduleComputeSuccessMessage(
        {
          type: 'result',
          protocolVersion: SCHEDULE_COMPUTE_PROTOCOL_VERSION,
          jobId: 'other',
          inputHash: 'h1',
          op: 'schedule',
          schedule: {
            startDate: '2026-01-01',
            endDate: '2026-01-31',
            paychecks: [],
            fullPaychecks: [],
            viewportMonths: 1,
            entries: [],
            summary: {
              totalIncome: 0,
              totalExpenses: 0,
              netBalance: 0,
              shortfallCount: 0,
            },
            recommendations: [],
            maxBudgetRemaining: 250,
            minCashOnHand: 100,
          },
        },
        { jobId: 'j1', inputHash: 'h1', op: 'schedule' }
      )
    ).toThrow(/jobId/);
  });
});

describe('runScheduleCompute', () => {
  it('produces a structurally valid schedule for a simple paycheck', () => {
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
    const bill: Bill = {
      id: 'bill-1',
      creditorName: 'Rent',
      budgetedAmount: 800,
      dueDay: 5,
      isRecurring: true,
      priority: 'critical',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const input = serializeScheduleComputeInput({
      incomes: [income],
      bills: [bill],
      startDate: '2026-01-01',
      months: 3,
      startingBalance: 1000,
      skippedBills: new Set(),
      manualAssignments: new Map(),
      targetCashOnHand: 250,
      goals: [],
      minCashOnHand: 100,
      minSavingsPerPaycheck: 0,
      debtPayoffs: new Map(),
      incomeOverrides: new Map(),
      leaves: [],
      nowIso: '2026-01-01T00:00:00.000Z',
    });

    const result = runScheduleCompute({
      protocolVersion: SCHEDULE_COMPUTE_PROTOCOL_VERSION,
      jobId: 'run-1',
      inputHash: computeScheduleInputHash('schedule', input),
      op: 'schedule',
      input,
    });

    assertScheduleComputeSuccessMessage(result, {
      jobId: 'run-1',
      inputHash: computeScheduleInputHash('schedule', input),
      op: 'schedule',
    });
    expect(result.op).toBe('schedule');
    if (result.op === 'schedule') {
      expect((result.schedule as { paychecks: unknown[] }).paychecks.length).toBeGreaterThan(0);
    }
  });
});
