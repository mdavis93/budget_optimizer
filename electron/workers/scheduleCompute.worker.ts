/**
 * Schedule compute utilityProcess entry.
 *
 * Quarantine: this process must stay compute-only — no persistence layer,
 * credential vault, filesystem writes, or network I/O. Main alone owns those.
 */

import { runScheduleCompute } from '../services/schedule-compute-run';
import type { ScheduleComputeRequest } from '@shared/scheduleComputeProtocol';
import { SCHEDULE_COMPUTE_PROTOCOL_VERSION } from '@shared/scheduleComputeProtocol';

type ParentPort = {
  on: (event: 'message', listener: (e: { data: unknown }) => void) => void;
  postMessage: (message: unknown) => void;
};

const parentPort = (process as NodeJS.Process & { parentPort?: ParentPort }).parentPort;

function reply(message: unknown): void {
  parentPort?.postMessage(message);
}

const HIGHS_SPIKE_LP = `Minimize
 obj: v0
Subject To
 c0: v0 >= 0
Bounds
 0 <= v0 <= 1
Binary
 v0
End`;

/** 2a only: prove packaged utilityProcess can load and solve with HiGHS. Removed in 2e. */
async function replyHighsSpikePong(jobId: string): Promise<void> {
  try {
    const { loadHighs } = await import('../services/scheduler/solvers/loadHighs');
    const { HIGHS_SOLVE_OPTIONS } = await import('../services/scheduler/solvers/highsSolver');
    const highs = await loadHighs();
    const result = highs.solve(HIGHS_SPIKE_LP, HIGHS_SOLVE_OPTIONS);
    if (result.Status !== 'Optimal') {
      reply({
        type: 'error',
        protocolVersion: SCHEDULE_COMPUTE_PROTOCOL_VERSION,
        jobId,
        inputHash: '',
        error: `highs spike ${result.Status}`,
      });
      process.exit(1);
      return;
    }
    reply({ type: 'pong', jobId, solver: 'highs' });
    process.exit(0);
  } catch (error) {
    reply({
      type: 'error',
      protocolVersion: SCHEDULE_COMPUTE_PROTOCOL_VERSION,
      jobId,
      inputHash: '',
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
}

/** Exported for unit tests of the worker protocol contract. */
export function handleMessage(data: unknown): void {
  if (!data || typeof data !== 'object') {
    reply({
      type: 'error',
      protocolVersion: SCHEDULE_COMPUTE_PROTOCOL_VERSION,
      jobId: 'unknown',
      inputHash: '',
      error: 'Invalid worker message',
    });
    process.exit(1);
    return;
  }

  const msg = data as { type?: string; jobId?: string };

  if (msg.type === 'ping') {
    const jobId = msg.jobId ?? 'ping';
    if (process.env.SCHEDULE_HIGHS_SPIKE === '1') {
      void replyHighsSpikePong(jobId);
      return;
    }
    reply({ type: 'pong', jobId });
    process.exit(0);
    return;
  }

  const request = data as ScheduleComputeRequest;
  try {
    const result = runScheduleCompute(request, (report) => {
      reply({
        type: 'progress',
        protocolVersion: SCHEDULE_COMPUTE_PROTOCOL_VERSION,
        jobId: request.jobId,
        inputHash: request.inputHash,
        op: request.op,
        ...report,
      });
    });
    reply(result);
    process.exit(0);
  } catch (error) {
    reply({
      type: 'error',
      protocolVersion: SCHEDULE_COMPUTE_PROTOCOL_VERSION,
      jobId: request.jobId ?? 'unknown',
      inputHash: request.inputHash ?? '',
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
}

if (!parentPort) {
  if (process.env.VITEST !== 'true') {
    console.error('schedule-worker: process.parentPort is unavailable');
    process.exit(1);
  }
} else {
  parentPort.on('message', (e) => {
    handleMessage(e.data);
  });
}
