import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import {
  clampDiagnosticsLimit,
  DIAGNOSTICS_BAG_JSON_MAX,
  DIAGNOSTICS_COALESCE_MS,
  DIAGNOSTICS_DENYLIST_KEYS,
  DIAGNOSTICS_EXPORT_DEFAULT_LIMIT,
  DIAGNOSTICS_JSONL_MAX_LINES,
  DIAGNOSTICS_MAX_DEPTH,
  DIAGNOSTICS_MESSAGE_MAX,
  DIAGNOSTICS_RATE_LIMIT_PER_MINUTE,
  DIAGNOSTICS_RING_SIZE,
  DIAGNOSTICS_SOURCE_MAX,
  DIAGNOSTICS_STACK_MAX,
  type DiagnosticBundle,
  type DiagnosticEvent,
  type DiagnosticLevel,
  type DiagnosticReportInput,
} from '@shared/diagnostics';
import { validateExportPath } from '../utils/exportPaths';
import { logger } from './logger.service';

export type DiagnosticReportResult =
  | { success: true; id: string }
  | { success: false; error: string };

export type DiagnosticBundleResult =
  | { success: true; id: string; data: DiagnosticBundle }
  | { success: false; error: string };

type SessionHooks = {
  getBudgetUnlocked: () => boolean;
  startedAtMs: number;
};

const HOME_PATH_RE = /(?:\/Users\/[^/\s]+|\/home\/[^/\s]+)(?:\/[^\s]*)?/g;
const SECRET_LIKE_RE =
  /\b(?:[A-Fa-f0-9]{32,}|[A-Za-z0-9+]{40,}={1,2}|[a-z]+(?:-[a-z]+){8,})\b/g;
const MONEY_LIKE_RE = /(?:\$\s*)?\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+\.\d{2}\b/g;

function isDeniedKey(key: string): boolean {
  const lower = key.toLowerCase().replace(/[_-]/g, '');
  return DIAGNOSTICS_DENYLIST_KEYS.some((k) => lower.includes(k));
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

function scrubFreeText(value: string | null | undefined): string | null {
  if (value == null) return null;
  let out = value;
  out = out.replace(HOME_PATH_RE, '[USER_PATH]');
  out = out.replace(SECRET_LIKE_RE, '[REDACTED]');
  out = out.replace(MONEY_LIKE_RE, '[AMOUNT]');
  return out;
}

function clampBag(diagnostics: Record<string, unknown>): Record<string, unknown> {
  if (JSON.stringify(diagnostics).length <= DIAGNOSTICS_BAG_JSON_MAX) {
    return diagnostics;
  }
  const compact: Record<string, unknown> = { truncated: true };
  for (const [key, value] of Object.entries(diagnostics)) {
    if (value === null || typeof value === 'number' || typeof value === 'boolean') {
      compact[key] = value;
    } else if (typeof value === 'string' && value.length <= 200) {
      compact[key] = value;
    }
  }
  const trail = diagnostics.navTrail;
  if (Array.isArray(trail)) {
    compact.navTrail = trail.slice(-5);
  }
  if (JSON.stringify(compact).length <= DIAGNOSTICS_BAG_JSON_MAX) {
    return compact;
  }
  return { truncated: true };
}

function sanitizeBag(
  value: unknown,
  depth: number
): { ok: true; value: unknown } | { ok: false; error: string } {
  if (depth > DIAGNOSTICS_MAX_DEPTH) {
    return { ok: false, error: 'Diagnostics bag exceeds max depth' };
  }
  if (value === null || value === undefined) {
    return { ok: true, value };
  }
  if (typeof value !== 'object') {
    if (typeof value === 'string') {
      return { ok: true, value: scrubFreeText(value) ?? value };
    }
    return { ok: true, value };
  }
  if (Array.isArray(value)) {
    const items: unknown[] = [];
    for (const item of value) {
      const nested = sanitizeBag(item, depth + 1);
      if (!nested.ok) return nested;
      items.push(nested.value);
    }
    return { ok: true, value: items };
  }

  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (isDeniedKey(key)) {
      result[key] = '[REDACTED]';
      continue;
    }
    const nested = sanitizeBag(child, depth + 1);
    if (!nested.ok) return nested;
    result[key] = nested.value;
  }
  return { ok: true, value: result };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function errorStack(error: unknown): string | null {
  if (error instanceof Error && error.stack) return error.stack;
  return null;
}

class DiagnosticsService {
  private ring: DiagnosticEvent[] = [];
  private hydrated = false;
  private writeChain: Promise<void> = Promise.resolve();
  private reportTimestamps: number[] = [];
  private coalesceMap = new Map<string, { id: string; at: number }>();
  private session: SessionHooks = {
    getBudgetUnlocked: () => false,
    startedAtMs: Date.now(),
  };

  setSessionHooks(hooks: Partial<SessionHooks>): void {
    this.session = { ...this.session, ...hooks };
  }

  private logsDir(): string {
    return path.join(app.getPath('userData'), 'logs');
  }

  private logFile(): string {
    return path.join(this.logsDir(), 'errors.jsonl');
  }

  private ensureDirs(): void {
    const dir = this.logsDir();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    try {
      fs.chmodSync(dir, 0o700);
    } catch {
      /* ignore */
    }
  }

  private hydrate(): void {
    if (this.hydrated) return;
    this.hydrated = true;
    try {
      this.ensureDirs();
      const file = this.logFile();
      if (!fs.existsSync(file)) return;
      const text = fs.readFileSync(file, 'utf8');
      const events: DiagnosticEvent[] = [];
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as DiagnosticEvent;
          if (parsed && typeof parsed.id === 'string' && typeof parsed.ts === 'string') {
            events.push(parsed);
          }
        } catch {
          /* skip corrupt line */
        }
      }
      this.ring = events.slice(-DIAGNOSTICS_RING_SIZE);
    } catch (error) {
      logger.warn('diagnostics hydrate failed:', errorMessage(error));
    }
  }

  private enqueueWrite(fn: () => void): void {
    this.writeChain = this.writeChain
      .then(() => {
        fn();
      })
      .catch((error) => {
        logger.warn('diagnostics write failed:', errorMessage(error));
      });
  }

  private appendAndRotate(event: DiagnosticEvent): void {
    this.ensureDirs();
    const file = this.logFile();
    fs.appendFileSync(file, `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
    try {
      fs.chmodSync(file, 0o600);
    } catch {
      /* ignore */
    }

    let lines: string[];
    try {
      lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim());
    } catch {
      return;
    }
    if (lines.length <= DIAGNOSTICS_JSONL_MAX_LINES) return;

    const kept = lines.slice(-DIAGNOSTICS_JSONL_MAX_LINES);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${kept.join('\n')}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, file);
    try {
      fs.chmodSync(file, 0o600);
    } catch {
      /* ignore */
    }
  }

  private pruneRateWindow(now: number): void {
    const cutoff = now - 60_000;
    this.reportTimestamps = this.reportTimestamps.filter((t) => t >= cutoff);
  }

  private coalesceKey(source: string, message: string, errorCode: string | null): string {
    return `${source}\0${message}\0${errorCode ?? ''}`;
  }

  report(input: DiagnosticReportInput): DiagnosticReportResult {
    try {
      this.hydrate();

      if (!input || typeof input !== 'object' || typeof input.source !== 'string') {
        return { success: false, error: 'Invalid diagnostics report' };
      }

      const source = truncate(input.source.trim(), DIAGNOSTICS_SOURCE_MAX);
      if (!source) {
        return { success: false, error: 'Invalid diagnostics report' };
      }

      const level: DiagnosticLevel = input.level === 'warn' ? 'warn' : 'error';
      const rawMessage =
        input.message ??
        (input.error !== undefined ? errorMessage(input.error) : 'Unknown error');
      const message = truncate(scrubFreeText(String(rawMessage)) ?? '', DIAGNOSTICS_MESSAGE_MAX);
      const rawStack =
        input.stack !== undefined
          ? input.stack
          : input.error !== undefined
            ? errorStack(input.error)
            : null;
      const stack = scrubFreeText(rawStack ? truncate(rawStack, DIAGNOSTICS_STACK_MAX) : null);
      const componentStack = scrubFreeText(
        input.componentStack
          ? truncate(input.componentStack, DIAGNOSTICS_STACK_MAX)
          : null
      );
      const errorCode =
        input.errorCode == null || input.errorCode === ''
          ? null
          : truncate(String(input.errorCode), 100);

      let diagnostics: Record<string, unknown> = {};
      if (input.diagnostics !== undefined) {
        if (
          input.diagnostics === null ||
          typeof input.diagnostics !== 'object' ||
          Array.isArray(input.diagnostics)
        ) {
          return { success: false, error: 'Invalid diagnostics bag' };
        }
        const sanitized = sanitizeBag(input.diagnostics, 1);
        if (!sanitized.ok) {
          return { success: false, error: sanitized.error };
        }
        diagnostics = sanitized.value as Record<string, unknown>;
        diagnostics = clampBag(diagnostics);
      }

      const now = Date.now();
      const key = this.coalesceKey(source, message, errorCode);
      const prior = this.coalesceMap.get(key);
      if (prior && now - prior.at <= DIAGNOSTICS_COALESCE_MS) {
        const existing = this.ring.find((e) => e.id === prior.id);
        if (existing) {
          const count =
            typeof existing.diagnostics.count === 'number'
              ? existing.diagnostics.count + 1
              : 2;
          existing.diagnostics = { ...existing.diagnostics, count };
          prior.at = now;
          this.enqueueWrite(() => {
            /* count only in ring until next full rewrite; acceptable for coalesce window */
          });
          return { success: true, id: prior.id };
        }
      }

      this.pruneRateWindow(now);
      if (this.reportTimestamps.length >= DIAGNOSTICS_RATE_LIMIT_PER_MINUTE) {
        return { success: false, error: 'Diagnostics rate limit exceeded' };
      }
      this.reportTimestamps.push(now);

      const event: DiagnosticEvent = {
        id: randomUUID(),
        ts: new Date(now).toISOString(),
        level,
        source,
        message,
        stack,
        componentStack,
        errorCode,
        diagnostics,
      };

      this.ring.push(event);
      if (this.ring.length > DIAGNOSTICS_RING_SIZE) {
        this.ring = this.ring.slice(-DIAGNOSTICS_RING_SIZE);
      }
      this.coalesceMap.set(key, { id: event.id, at: now });
      this.enqueueWrite(() => this.appendAndRotate(event));

      return { success: true, id: event.id };
    } catch (error) {
      try {
        logger.warn('diagnostics.report failed:', errorMessage(error));
      } catch {
        /* ignore */
      }
      return { success: false, error: 'Diagnostics report failed' };
    }
  }

  private buildAppMeta(): DiagnosticBundle['app'] {
    let version = 'unknown';
    try {
      version = app.getVersion();
    } catch {
      /* tests / early boot */
    }
    return {
      version,
      electron: process.versions.electron ?? 'unknown',
      platform: process.platform,
      arch: process.arch,
    };
  }

  private buildEnvelope(errors: DiagnosticEvent[]): DiagnosticBundle {
    return {
      exportedAt: new Date().toISOString(),
      app: this.buildAppMeta(),
      session: {
        uptimeMs: Math.max(0, Date.now() - this.session.startedAtMs),
        budgetUnlocked: this.session.getBudgetUnlocked(),
      },
      errors,
    };
  }

  getEventBundle(eventId: string): DiagnosticBundleResult {
    try {
      this.hydrate();
      if (typeof eventId !== 'string' || !eventId.trim()) {
        return { success: false, error: 'Event not found' };
      }
      const event = this.ring.find((e) => e.id === eventId);
      if (!event) {
        return { success: false, error: 'Event not found' };
      }
      return {
        success: true,
        id: event.id,
        data: {
          ...this.buildEnvelope([event]),
          copiedEventId: event.id,
          recent: this.ring.slice(-25),
        },
      };
    } catch (error) {
      logger.warn('diagnostics.getEventBundle failed:', errorMessage(error));
      return { success: false, error: 'Failed to get event' };
    }
  }

  getBundle(limit?: unknown): DiagnosticBundleResult {
    try {
      this.hydrate();
      const n = clampDiagnosticsLimit(limit, DIAGNOSTICS_EXPORT_DEFAULT_LIMIT);
      const errors = this.ring.slice(-n);
      return {
        success: true,
        id: errors[errors.length - 1]?.id ?? '',
        data: this.buildEnvelope(errors),
      };
    } catch (error) {
      logger.warn('diagnostics.getBundle failed:', errorMessage(error));
      return { success: false, error: 'Failed to get bundle' };
    }
  }

  exportBundle(
    filePath: string,
    limit?: unknown
  ): DiagnosticReportResult {
    try {
      if (!validateExportPath(filePath)) {
        return { success: false, error: 'Invalid export path' };
      }
      const bundleResult = this.getBundle(limit);
      if (!bundleResult.success) {
        return { success: false, error: bundleResult.error };
      }
      if (bundleResult.data.errors.length === 0) {
        return { success: false, error: 'No diagnostics to export' };
      }
      fs.writeFileSync(filePath, `${JSON.stringify(bundleResult.data, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      return { success: true, id: bundleResult.id };
    } catch (error) {
      logger.warn('diagnostics.exportBundle failed:', errorMessage(error));
      return { success: false, error: 'Failed to export diagnostics' };
    }
  }

  /** Test helper: reset in-memory state (does not delete files unless path cleared). */
  resetForTests(): void {
    this.ring = [];
    this.hydrated = false;
    this.reportTimestamps = [];
    this.coalesceMap.clear();
    this.writeChain = Promise.resolve();
    this.session = {
      getBudgetUnlocked: () => false,
      startedAtMs: Date.now(),
    };
  }

  async flushForTests(): Promise<void> {
    await this.writeChain;
  }
}

export const diagnostics = new DiagnosticsService();
