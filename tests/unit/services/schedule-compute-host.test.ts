import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  ScheduleComputeHost,
  createMockUtilityProcess,
} from '../../../electron/services/schedule-compute-host';
import { ScheduleComputeError } from '@shared/scheduleComputeProtocol';
import type { ScheduleComputeInputPayload } from '@shared/scheduleComputeProtocol';
import { SCHEDULE_COMPUTE_PROTOCOL_VERSION } from '@shared/scheduleComputeProtocol';

vi.mock('../../../electron/services/logger.service', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function minimalInput(overrides: Partial<ScheduleComputeInputPayload> = {}): ScheduleComputeInputPayload {
  return {
    incomes: [],
    bills: [],
    startDate: '2026-01-01',
    months: 1,
    startingBalance: 1000,
    skippedBills: [],
    manualAssignments: [],
    targetCashOnHand: 250,
    goals: [],
    minCashOnHand: 100,
    minSavingsPerPaycheck: 0,
    debtPayoffs: [],
    incomeOverrides: [],
    leaves: [],
    nowIso: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function scheduleResult(jobId: string, inputHash: string) {
  return {
    type: 'result' as const,
    protocolVersion: SCHEDULE_COMPUTE_PROTOCOL_VERSION,
    jobId,
    inputHash,
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
    },
  };
}

describe('ScheduleComputeHost', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves happy path after spawn + result message', async () => {
    const child = createMockUtilityProcess();
    const host = new ScheduleComputeHost({
      workerPath: '/fake/schedule-worker.js',
      skipWorkerExistsCheck: true,
      forkFn: () => child,
      timeoutMs: 5_000,
    });

    const input = minimalInput();
    const inputHash = 'hash-a';
    const pending = host.runJob({ op: 'schedule', inputHash, input, jobId: 'job-1' });

    child.__emitSpawn();
    child.emit('message', scheduleResult('job-1', inputHash));

    await expect(pending).resolves.toMatchObject({ jobId: 'job-1', op: 'schedule' });
    host.dispose();
  });

  it('coalesces identical in-flight op+hash into one fork', async () => {
    const child = createMockUtilityProcess();
    const forkFn = vi.fn(() => child);
    const host = new ScheduleComputeHost({
      workerPath: '/fake/schedule-worker.js',
      skipWorkerExistsCheck: true,
      forkFn,
      timeoutMs: 5_000,
    });

    const input = minimalInput();
    const inputHash = 'same-hash';
    const a = host.runJob({ op: 'schedule', inputHash, input, jobId: 'job-a' });
    const b = host.runJob({ op: 'schedule', inputHash, input, jobId: 'job-b' });

    expect(forkFn).toHaveBeenCalledTimes(1);
    child.__emitSpawn();
    child.emit('message', scheduleResult('job-a', inputHash));

    await expect(a).resolves.toMatchObject({ jobId: 'job-a' });
    await expect(b).resolves.toMatchObject({ jobId: 'job-a' });
    host.dispose();
  });

  it('soft-cancels prior distinct job with superseded', async () => {
    const first = createMockUtilityProcess();
    const second = createMockUtilityProcess();
    const children = [first, second];
    const host = new ScheduleComputeHost({
      workerPath: '/fake/schedule-worker.js',
      skipWorkerExistsCheck: true,
      forkFn: () => children.shift()!,
      timeoutMs: 5_000,
    });

    const firstJob = host.runJob({
      op: 'schedule',
      inputHash: 'hash-1',
      input: minimalInput({ months: 1 }),
      jobId: 'job-1',
    });
    const secondJob = host.runJob({
      op: 'schedule',
      inputHash: 'hash-2',
      input: minimalInput({ months: 2 }),
      jobId: 'job-2',
    });

    await expect(firstJob).rejects.toMatchObject({ code: 'superseded' });

    second.__emitSpawn();
    second.emit('message', scheduleResult('job-2', 'hash-2'));
    await expect(secondJob).resolves.toMatchObject({ jobId: 'job-2' });
    host.dispose();
  });

  it('times out and settles with timeout error', async () => {
    const child = createMockUtilityProcess();
    const forceKillPid = vi.fn();
    const host = new ScheduleComputeHost({
      workerPath: '/fake/schedule-worker.js',
      skipWorkerExistsCheck: true,
      forkFn: () => child,
      timeoutMs: 100,
      killEscalationMs: 50,
      forceKillPid,
    });

    const pending = host.runJob({
      op: 'schedule',
      inputHash: 'hash-timeout',
      input: minimalInput(),
      jobId: 'job-t',
    });

    child.__emitSpawn();
    const expectation = expect(pending).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(100);
    await expectation;
    host.dispose();
  });

  it('rejects when worker exits before result', async () => {
    const child = createMockUtilityProcess();
    const host = new ScheduleComputeHost({
      workerPath: '/fake/schedule-worker.js',
      skipWorkerExistsCheck: true,
      forkFn: () => child,
      timeoutMs: 5_000,
    });

    const pending = host.runJob({
      op: 'schedule',
      inputHash: 'hash-exit',
      input: minimalInput(),
      jobId: 'job-e',
    });

    child.__emitSpawn();
    child.emit('exit', 1);
    await expect(pending).rejects.toBeInstanceOf(ScheduleComputeError);
    await expect(pending).rejects.toMatchObject({ code: 'crashed' });
    host.dispose();
  });

  it('settle-once ignores a second result message', async () => {
    const child = createMockUtilityProcess();
    const host = new ScheduleComputeHost({
      workerPath: '/fake/schedule-worker.js',
      skipWorkerExistsCheck: true,
      forkFn: () => child,
      timeoutMs: 5_000,
    });

    const pending = host.runJob({
      op: 'schedule',
      inputHash: 'hash-once',
      input: minimalInput(),
      jobId: 'job-once',
    });

    child.__emitSpawn();
    child.emit('message', scheduleResult('job-once', 'hash-once'));
    child.emit('message', scheduleResult('job-once', 'hash-once'));

    await expect(pending).resolves.toMatchObject({ jobId: 'job-once' });
    host.dispose();
  });

  it('queues kill when kill is requested before spawn', async () => {
    const child = createMockUtilityProcess();
    const killSpy = vi.spyOn(child, 'kill');
    const host = new ScheduleComputeHost({
      workerPath: '/fake/schedule-worker.js',
      skipWorkerExistsCheck: true,
      forkFn: () => child,
      timeoutMs: 5_000,
    });

    const pending = host.runJob({
      op: 'schedule',
      inputHash: 'h1',
      input: minimalInput({ months: 1 }),
      jobId: 'j1',
    });

    // Dispose before spawn — pid still undefined → killAfterSpawn
    host.dispose();
    await expect(pending).rejects.toMatchObject({ code: 'disposed' });

    child.__emitSpawn();
    expect(killSpy).toHaveBeenCalled();
  });

  it('dispose rejects in-flight and is idempotent', async () => {
    const child = createMockUtilityProcess();
    const host = new ScheduleComputeHost({
      workerPath: '/fake/schedule-worker.js',
      skipWorkerExistsCheck: true,
      forkFn: () => child,
      timeoutMs: 5_000,
    });

    const pending = host.runJob({
      op: 'schedule',
      inputHash: 'hash-dispose',
      input: minimalInput(),
      jobId: 'job-d',
    });

    host.dispose();
    host.dispose();
    await expect(pending).rejects.toMatchObject({ code: 'disposed' });
    await expect(
      host.runJob({
        op: 'schedule',
        inputHash: 'after',
        input: minimalInput(),
      })
    ).rejects.toMatchObject({ code: 'disposed' });
  });

  it('rejects invalid schema results', async () => {
    const child = createMockUtilityProcess();
    const host = new ScheduleComputeHost({
      workerPath: '/fake/schedule-worker.js',
      skipWorkerExistsCheck: true,
      forkFn: () => child,
      timeoutMs: 5_000,
    });

    const pending = host.runJob({
      op: 'schedule',
      inputHash: 'hash-bad',
      input: minimalInput(),
      jobId: 'job-bad',
    });

    child.__emitSpawn();
    child.emit('message', {
      type: 'result',
      protocolVersion: SCHEDULE_COMPUTE_PROTOCOL_VERSION,
      jobId: 'job-bad',
      inputHash: 'hash-bad',
      op: 'schedule',
      schedule: { not: 'valid' },
    });

    await expect(pending).rejects.toMatchObject({ code: 'invalid_result' });
    host.dispose();
  });
});
