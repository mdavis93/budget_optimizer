import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SCHEDULE_COMPUTE_PROTOCOL_VERSION } from '@shared/scheduleComputeProtocol';

const postMessage = vi.fn();
const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

vi.mock('../../../electron/services/schedule-compute-run', () => ({
  runScheduleCompute: vi.fn(),
}));

describe('scheduleCompute.worker handleMessage', () => {
  beforeEach(() => {
    vi.resetModules();
    postMessage.mockReset();
    exit.mockClear();
    (process as NodeJS.Process & { parentPort?: unknown }).parentPort = {
      postMessage,
      on: vi.fn(),
    };
  });

  afterEach(() => {
    delete (process as NodeJS.Process & { parentPort?: unknown }).parentPort;
  });

  it('replies with an error and exits when the message is not an object', async () => {
    const { handleMessage } = await import('../../../electron/workers/scheduleCompute.worker');
    handleMessage(null);
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        jobId: 'unknown',
        error: 'Invalid worker message',
        protocolVersion: SCHEDULE_COMPUTE_PROTOCOL_VERSION,
      })
    );
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('replies pong to ping and exits cleanly', async () => {
    const { handleMessage } = await import('../../../electron/workers/scheduleCompute.worker');
    handleMessage({ type: 'ping', jobId: 'smoke' });
    expect(postMessage).toHaveBeenCalledWith({ type: 'pong', jobId: 'smoke' });
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('defaults ping jobId when omitted', async () => {
    const { handleMessage } = await import('../../../electron/workers/scheduleCompute.worker');
    handleMessage({ type: 'ping' });
    expect(postMessage).toHaveBeenCalledWith({ type: 'pong', jobId: 'ping' });
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('reports compute failures with the request job id', async () => {
    const { runScheduleCompute } = await import(
      '../../../electron/services/schedule-compute-run'
    );
    vi.mocked(runScheduleCompute).mockImplementationOnce(() => {
      throw new Error('boom');
    });

    const { handleMessage } = await import('../../../electron/workers/scheduleCompute.worker');
    handleMessage({
      type: 'compute',
      protocolVersion: SCHEDULE_COMPUTE_PROTOCOL_VERSION,
      jobId: 'job-9',
      inputHash: 'abc',
      op: 'schedule',
      input: {},
    });

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        jobId: 'job-9',
        inputHash: 'abc',
        error: 'boom',
      })
    );
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('stringifies non-Error compute failures for the protocol error payload', async () => {
    const { runScheduleCompute } = await import(
      '../../../electron/services/schedule-compute-run'
    );
    vi.mocked(runScheduleCompute).mockImplementationOnce(() => {
      throw 'raw-failure';
    });

    const { handleMessage } = await import('../../../electron/workers/scheduleCompute.worker');
    handleMessage({
      protocolVersion: SCHEDULE_COMPUTE_PROTOCOL_VERSION,
      op: 'schedule',
      input: {},
    });

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        jobId: 'unknown',
        inputHash: '',
        error: 'raw-failure',
      })
    );
    expect(exit).toHaveBeenCalledWith(1);
  });
});
