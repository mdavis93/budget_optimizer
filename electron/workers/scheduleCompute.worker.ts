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

function handleMessage(data: unknown): void {
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
    reply({ type: 'pong', jobId: msg.jobId ?? 'ping' });
    process.exit(0);
    return;
  }

  const request = data as ScheduleComputeRequest;
  try {
    const result = runScheduleCompute(request);
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
  // eslint-disable-next-line no-console
  console.error('schedule-worker: process.parentPort is unavailable');
  process.exit(1);
} else {
  parentPort.on('message', (e) => {
    handleMessage(e.data);
  });
}
