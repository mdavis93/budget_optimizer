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
  readScheduleComputeProgressMessage,
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
      preferredAssignments: new Map([['bill-2-2026-03-01', '2026-02-28']]),
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
    expect(restored.preferredAssignments.get('bill-2-2026-03-01')).toBe('2026-02-28');
    expect(restored.incomeOverrides.get('inc-1-2026-01-15')).toBe(0);
    expect(restored.debtPayoffs.get('bill-1')?.payoffDate.toISOString()).toBe(
      '2026-06-01T00:00:00.000Z'
    );
    expect(computeScheduleInputHash('schedule', serialized)).toHaveLength(64);
    expect(serialized.months).toBe(12);
    expect(serialized.nowIso).toBe('2026-01-10T12:00:00.000Z');

    const monthsChanged = { ...serialized, months: 3 };
    expect(computeScheduleInputHash('schedule', monthsChanged)).toBe(
      computeScheduleInputHash('schedule', serialized)
    );

    const morning = {
      ...serialized,
      nowIso: new Date(2026, 7, 20, 8, 15, 30).toISOString(),
    };
    const evening = {
      ...serialized,
      nowIso: new Date(2026, 7, 20, 21, 45, 10).toISOString(),
    };
    const nextDay = {
      ...serialized,
      nowIso: new Date(2026, 7, 21, 8, 15, 30).toISOString(),
    };
    expect(computeScheduleInputHash('schedule', morning)).toBe(
      computeScheduleInputHash('schedule', evening)
    );
    expect(computeScheduleInputHash('schedule', morning)).not.toBe(
      computeScheduleInputHash('schedule', nextDay)
    );
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
      preferredAssignments: new Map(),
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

  it('produces goal projections for the goals compute path', () => {
    const income: Income = {
      id: 'inc-1',
      sourceName: 'Job',
      amount: 2500,
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
    const goal = {
      id: 'goal-1',
      name: 'Emergency',
      targetAmount: 3000,
      targetDate: '2026-12-01',
      priority: 1,
      alreadySaved: 500,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const input = serializeScheduleComputeInput({
      incomes: [income],
      bills: [bill],
      startDate: '2026-01-01',
      months: 6,
      startingBalance: 1000,
      skippedBills: new Set(),
      manualAssignments: new Map(),
      preferredAssignments: new Map(),
      targetCashOnHand: 250,
      goals: [goal],
      minCashOnHand: 100,
      minSavingsPerPaycheck: 0,
      debtPayoffs: new Map(),
      incomeOverrides: new Map(),
      leaves: [],
      nowIso: '2026-01-01T00:00:00.000Z',
    });

    const result = runScheduleCompute({
      protocolVersion: SCHEDULE_COMPUTE_PROTOCOL_VERSION,
      jobId: 'goals-1',
      inputHash: computeScheduleInputHash('goals', input),
      op: 'goals',
      input,
    });

    expect(result.op).toBe('goals');
    if (result.op === 'goals') {
      expect(result.goalProjections.length).toBeGreaterThan(0);
      expect(result.goalProjections[0]).toMatchObject({
        goalId: 'goal-1',
      });
    }
  });

  it('reports ordered stage tokens through the progress sink', () => {
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
      preferredAssignments: new Map(),
      targetCashOnHand: 250,
      goals: [],
      minCashOnHand: 100,
      minSavingsPerPaycheck: 0,
      debtPayoffs: new Map(),
      incomeOverrides: new Map(),
      leaves: [],
      nowIso: '2026-01-01T00:00:00.000Z',
    });
    const stages: Array<{ stage: string; current?: number; total?: number }> = [];
    runScheduleCompute(
      {
        protocolVersion: SCHEDULE_COMPUTE_PROTOCOL_VERSION,
        jobId: 'run-progress',
        inputHash: computeScheduleInputHash('schedule', input),
        op: 'schedule',
        input,
      },
      (report) => {
        stages.push(report);
      }
    );
    expect(stages[0]?.stage).toBe('assigning');
    expect(stages.map((s) => s.stage)).toContain('reconciling');
    expect(stages.map((s) => s.stage)).toContain('advising');
    const advising = stages.find((s) => s.stage === 'advising');
    expect(advising).toMatchObject({ stage: 'advising' });
    expect(advising?.total).toBeTypeOf('number');
    expect(stages.at(-1)?.stage).toBe('finishing');
  });

  it('validates break-glass plans when a paycheck sits in the band', () => {
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
    const earlier: Bill = {
      id: 'bill-flex',
      creditorName: 'Flex',
      budgetedAmount: 400,
      dueDay: 20,
      isRecurring: true,
      priority: 'low',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const heavy: Bill = {
      id: 'bill-heavy',
      creditorName: 'Heavy',
      budgetedAmount: 1700,
      dueDay: 28,
      isRecurring: true,
      priority: 'normal',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const input = serializeScheduleComputeInput({
      incomes: [income],
      bills: [earlier, heavy],
      startDate: '2026-01-01',
      months: 3,
      startingBalance: 200,
      skippedBills: new Set(),
      manualAssignments: new Map(),
      preferredAssignments: new Map(),
      targetCashOnHand: 250,
      goals: [],
      minCashOnHand: 100,
      minSavingsPerPaycheck: 0,
      debtPayoffs: new Map(),
      incomeOverrides: new Map(),
      leaves: [],
      nowIso: '2026-01-01T00:00:00.000Z',
    });
    const stages: string[] = [];
    const result = runScheduleCompute(
      {
        protocolVersion: SCHEDULE_COMPUTE_PROTOCOL_VERSION,
        jobId: 'run-bg',
        inputHash: computeScheduleInputHash('schedule', input),
        op: 'schedule',
        input,
      },
      (report) => {
        stages.push(report.stage);
      }
    );
    expect(result.op).toBe('schedule');
    expect(stages).toContain('advising');
    if (result.op === 'schedule') {
      expect(result.schedule.breakGlassAdvisor).toBeDefined();
    }
  });

  it('drops malformed progress without throwing', () => {
    expect(
      readScheduleComputeProgressMessage(
        { type: 'progress', extra: 'nope' },
        { jobId: 'j', inputHash: 'h', op: 'schedule' }
      )
    ).toBeNull();
    expect(
      readScheduleComputeProgressMessage(
        {
          type: 'progress',
          protocolVersion: SCHEDULE_COMPUTE_PROTOCOL_VERSION,
          jobId: 'j',
          inputHash: 'h',
          op: 'schedule',
          stage: 'assigning',
        },
        { jobId: 'j', inputHash: 'h', op: 'schedule' }
      )
    ).toMatchObject({ type: 'progress', stage: 'assigning' });
  });
});
