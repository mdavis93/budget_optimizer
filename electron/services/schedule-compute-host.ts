/**
 * ScheduleComputeHost — single-flight utilityProcess supervisor.
 *
 * - At most one live child (newest-wins; identical inputHash coalesces).
 * - Soft-cancels prior callers with ScheduleComputeError('superseded').
 * - Hard 60s timeout; SIGTERM then SIGKILL escalation.
 * - Never writes to SQLite; results are ephemeral validated payloads only.
 * - Worker has no DB/keytar/fs write access by construction.
 */

import { utilityProcess, type UtilityProcess } from 'electron';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import {
  SCHEDULE_COMPUTE_KILL_ESCALATION_MS,
  SCHEDULE_COMPUTE_PROTOCOL_VERSION,
  SCHEDULE_COMPUTE_SERVICE_NAME,
  SCHEDULE_COMPUTE_TIMEOUT_MS,
  ScheduleComputeError,
  type ScheduleComputeOp,
  type ScheduleComputeRequest,
  type ScheduleComputeSuccessMessage,
} from '@shared/scheduleComputeProtocol';
import {
  assertScheduleComputeSuccessMessage,
  isWorkerMessage,
} from '@shared/scheduleComputeValidate';
import { resolveScheduleWorkerPath } from '../utils/scheduleWorkerPath';
import { logger } from './logger.service';

export type { ScheduleComputeRequest, ScheduleComputeSuccessMessage };

type FlightWaiter = {
  resolve: (value: ScheduleComputeSuccessMessage) => void;
  reject: (error: ScheduleComputeError) => void;
};

type Flight = {
  jobId: string;
  inputHash: string;
  op: ScheduleComputeOp;
  child: UtilityProcess | null;
  waiters: FlightWaiter[];
  settled: boolean;
  killAfterSpawn: boolean;
  timeoutHandle: ReturnType<typeof setTimeout> | null;
  killEscalateHandle: ReturnType<typeof setTimeout> | null;
  startedAt: number;
};

export interface ScheduleComputeHostOptions {
  workerPath?: string;
  timeoutMs?: number;
  killEscalationMs?: number;
  /** When true, skip filesystem existence check (unit tests with mock fork). */
  skipWorkerExistsCheck?: boolean;
  /** Injected for unit tests. */
  forkFn?: (modulePath: string, args?: string[], options?: object) => UtilityProcess;
  /** Injected for unit tests (SIGKILL escalation). */
  forceKillPid?: (pid: number) => void;
}

function coalesceKey(op: ScheduleComputeOp, inputHash: string): string {
  return `${op}:${inputHash}`;
}

export class ScheduleComputeHost {
  private current: Flight | null = null;
  private coalesce = new Map<string, Promise<ScheduleComputeSuccessMessage>>();
  private disposed = false;
  private readonly timeoutMs: number;
  private readonly killEscalationMs: number;
  private readonly forkFn: (
    modulePath: string,
    args?: string[],
    options?: object
  ) => UtilityProcess;
  private readonly forceKillPid: (pid: number) => void;
  private readonly workerPath: string;
  private readonly skipWorkerExistsCheck: boolean;

  constructor(options: ScheduleComputeHostOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? SCHEDULE_COMPUTE_TIMEOUT_MS;
    this.killEscalationMs = options.killEscalationMs ?? SCHEDULE_COMPUTE_KILL_ESCALATION_MS;
    this.forkFn =
      options.forkFn ??
      ((modulePath, args, forkOptions) =>
        utilityProcess.fork(modulePath, args, forkOptions as Parameters<typeof utilityProcess.fork>[2]));
    this.forceKillPid =
      options.forceKillPid ??
      ((pid: number) => {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // already gone
        }
      });
    this.workerPath = options.workerPath ?? resolveScheduleWorkerPath();
    this.skipWorkerExistsCheck = options.skipWorkerExistsCheck ?? Boolean(options.forkFn);
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  /**
   * Run a compute job. Identical in-flight (op+inputHash) shares one Promise.
   * A newer distinct job soft-cancels the prior flight with `superseded`.
   */
  runJob(
    request: Omit<ScheduleComputeRequest, 'protocolVersion' | 'jobId'> & {
      jobId?: string;
    }
  ): Promise<ScheduleComputeSuccessMessage> {
    if (this.disposed) {
      return Promise.reject(
        new ScheduleComputeError('disposed', 'Schedule compute host is disposed')
      );
    }

    const fullRequest: ScheduleComputeRequest = {
      protocolVersion: SCHEDULE_COMPUTE_PROTOCOL_VERSION,
      jobId: request.jobId ?? randomUUID(),
      inputHash: request.inputHash,
      op: request.op,
      input: request.input,
    };

    const key = coalesceKey(fullRequest.op, fullRequest.inputHash);
    const existing = this.coalesce.get(key);
    if (existing) {
      return existing;
    }

    const promise = this.startFlight(fullRequest).finally(() => {
      if (this.coalesce.get(key) === promise) {
        this.coalesce.delete(key);
      }
    });
    this.coalesce.set(key, promise);
    return promise;
  }

  /** App lifecycle: kill child and reject waiters. Idempotent. */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.settleCurrent(
      new ScheduleComputeError('disposed', 'Schedule compute host disposed')
    );
    this.coalesce.clear();
  }

  /** Handle app `child-process-gone` for our serviceName. */
  notifyChildProcessGone(serviceName: string | undefined): void {
    if (serviceName !== SCHEDULE_COMPUTE_SERVICE_NAME) {
      return;
    }
    this.settleCurrent(
      new ScheduleComputeError('crashed', 'Schedule utility process gone unexpectedly')
    );
  }

  private startFlight(
    request: ScheduleComputeRequest
  ): Promise<ScheduleComputeSuccessMessage> {
    if (this.current && !this.current.settled) {
      this.settleFlight(
        this.current,
        new ScheduleComputeError('superseded', 'Schedule compute job superseded')
      );
    }

    if (!this.skipWorkerExistsCheck && !fs.existsSync(this.workerPath)) {
      return Promise.reject(
        new ScheduleComputeError(
          'worker_unavailable',
          `Schedule worker not found at ${this.workerPath}`
        )
      );
    }

    return new Promise<ScheduleComputeSuccessMessage>((resolve, reject) => {
      const flight: Flight = {
        jobId: request.jobId,
        inputHash: request.inputHash,
        op: request.op,
        child: null,
        waiters: [{ resolve, reject }],
        settled: false,
        killAfterSpawn: false,
        timeoutHandle: null,
        killEscalateHandle: null,
        startedAt: Date.now(),
      };
      this.current = flight;

      let child: UtilityProcess;
      try {
        child = this.forkFn(this.workerPath, [], {
          serviceName: SCHEDULE_COMPUTE_SERVICE_NAME,
          stdio: 'ignore',
          allowLoadingUnsignedLibraries: false,
        });
      } catch (error) {
        this.settleFlight(
          flight,
          new ScheduleComputeError(
            'worker_unavailable',
            error instanceof Error ? error.message : 'Failed to fork schedule worker'
          )
        );
        return;
      }

      flight.child = child;

      const onMessage = (message: unknown) => {
        if (flight.settled) {
          return;
        }
        if (!isWorkerMessage(message)) {
          this.settleFlight(
            flight,
            new ScheduleComputeError('invalid_result', 'Malformed worker message')
          );
          return;
        }
        if (message.type === 'error') {
          if (message.jobId !== flight.jobId) {
            return;
          }
          this.settleFlight(
            flight,
            new ScheduleComputeError('worker_error', message.error || 'Worker error')
          );
          return;
        }
        if (message.type !== 'result') {
          return;
        }
        try {
          assertScheduleComputeSuccessMessage(message, {
            jobId: flight.jobId,
            inputHash: flight.inputHash,
            op: flight.op,
          });
          this.settleFlight(flight, null, message);
        } catch (error) {
          this.settleFlight(
            flight,
            new ScheduleComputeError(
              'invalid_result',
              error instanceof Error ? error.message : 'Invalid compute result'
            )
          );
        }
      };

      const onExit = (code: number) => {
        if (flight.settled) {
          return;
        }
        this.settleFlight(
          flight,
          new ScheduleComputeError(
            'crashed',
            `Schedule worker exited before result (code ${code})`
          )
        );
      };

      const onError = () => {
        if (flight.settled) {
          return;
        }
        this.settleFlight(
          flight,
          new ScheduleComputeError('crashed', 'Schedule worker fatal V8 error')
        );
      };

      child.on('message', onMessage);
      child.on('exit', onExit);
      child.on('error', onError);

      child.on('spawn', () => {
        // Reap immediately if the flight already settled or kill was queued pre-PID.
        if (flight.settled || flight.killAfterSpawn) {
          try {
            if (child.pid != null) {
              child.kill();
            }
          } catch {
            // ignore
          }
          return;
        }
        try {
          child.postMessage(request);
        } catch (error) {
          this.settleFlight(
            flight,
            new ScheduleComputeError(
              'worker_unavailable',
              error instanceof Error
                ? error.message
                : 'Failed to postMessage to worker'
            )
          );
        }
      });

      flight.timeoutHandle = setTimeout(() => {
        if (flight.settled) {
          return;
        }
        this.killChild(flight);
        this.settleFlight(
          flight,
          new ScheduleComputeError('timeout', 'Schedule compute timed out')
        );
      }, this.timeoutMs);
    });
  }

  private killChild(flight: Flight): void {
    const child = flight.child;
    if (!child) {
      return;
    }
    if (child.pid == null) {
      flight.killAfterSpawn = true;
      return;
    }
    try {
      child.kill();
    } catch {
      // ignore
    }
    if (flight.killEscalateHandle) {
      clearTimeout(flight.killEscalateHandle);
    }
    const pid = child.pid;
    flight.killEscalateHandle = setTimeout(() => {
      if (pid != null) {
        this.forceKillPid(pid);
      }
    }, this.killEscalationMs);
  }

  private settleCurrent(error: ScheduleComputeError): void {
    if (this.current && !this.current.settled) {
      this.settleFlight(this.current, error);
    }
  }

  private settleFlight(
    flight: Flight,
    error: ScheduleComputeError | null,
    success?: ScheduleComputeSuccessMessage
  ): void {
    if (flight.settled) {
      return;
    }
    flight.settled = true;

    if (flight.timeoutHandle) {
      clearTimeout(flight.timeoutHandle);
      flight.timeoutHandle = null;
    }
    if (flight.killEscalateHandle) {
      clearTimeout(flight.killEscalateHandle);
      flight.killEscalateHandle = null;
    }

    if (error && flight.child) {
      this.killChild(flight);
    }

    const durationMs = Date.now() - flight.startedAt;
    logger.info('schedule-compute', {
      jobId: flight.jobId,
      op: flight.op,
      durationMs,
      outcome: error ? error.code : 'ok',
    });

    if (this.current === flight) {
      this.current = null;
    }

    flight.child = null;

    for (const waiter of flight.waiters) {
      if (error) {
        waiter.reject(error);
      } else if (success) {
        waiter.resolve(success);
      } else {
        waiter.reject(
          new ScheduleComputeError('crashed', 'Schedule compute settled without result')
        );
      }
    }
    flight.waiters = [];
  }
}

/**
 * Dev-only smoke: fork worker, ping/pong, exit.
 * Gated by SCHEDULE_WORKER_SMOKE=1 — never a production always-on path.
 */
export async function runScheduleWorkerSmoke(
  hostOptions: ScheduleComputeHostOptions = {}
): Promise<void> {
  if (process.env.SCHEDULE_WORKER_SMOKE !== '1') {
    return;
  }

  const workerPath = hostOptions.workerPath ?? resolveScheduleWorkerPath();
  const forkFn =
    hostOptions.forkFn ??
    ((modulePath: string, args?: string[], forkOptions?: object) =>
      utilityProcess.fork(
        modulePath,
        args,
        forkOptions as Parameters<typeof utilityProcess.fork>[2]
      ));
  const child = forkFn(workerPath, [], {
    serviceName: SCHEDULE_COMPUTE_SERVICE_NAME,
    stdio: 'pipe',
    allowLoadingUnsignedLibraries: false,
  });

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // ignore
      }
      reject(new Error('schedule worker smoke timed out'));
    }, 10_000);

    child.on('spawn', () => {
      child.postMessage({ type: 'ping', jobId: 'smoke' });
    });
    child.on('message', (message: unknown) => {
      if (
        message &&
        typeof message === 'object' &&
        (message as { type?: string }).type === 'pong'
      ) {
        clearTimeout(timeout);
        try {
          child.kill();
        } catch {
          // ignore
        }
        resolve();
      }
    });
    child.on('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  logger.info('schedule-compute smoke ok');
}

/** Minimal EventEmitter stand-in for unit tests (Electron UtilityProcess shape). */
export function createMockUtilityProcess(): UtilityProcess &
  EventEmitter & {
    __setPid: (value: number | undefined) => void;
    __emitSpawn: () => void;
  } {
  const ee = new EventEmitter() as UtilityProcess &
    EventEmitter & {
      __setPid: (value: number | undefined) => void;
      __emitSpawn: () => void;
    };
  let pid: number | undefined;
  Object.defineProperty(ee, 'pid', {
    get: () => pid,
    configurable: true,
  });
  ee.kill = () => {
    pid = undefined;
    queueMicrotask(() => ee.emit('exit', 1));
    return true;
  };
  ee.postMessage = () => undefined;
  ee.__setPid = (value) => {
    pid = value;
  };
  ee.__emitSpawn = () => {
    if (pid == null) {
      pid = 4242;
    }
    ee.emit('spawn');
  };
  return ee;
}
