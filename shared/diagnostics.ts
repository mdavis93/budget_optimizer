/** Shared diagnostics schemas and security limits (main + renderer). */

export type DiagnosticLevel = 'error' | 'warn';

export interface DiagnosticEvent {
  id: string;
  ts: string;
  level: DiagnosticLevel;
  source: string;
  message: string;
  stack: string | null;
  componentStack: string | null;
  errorCode: string | null;
  diagnostics: Record<string, unknown>;
}

export interface DiagnosticBundle {
  exportedAt: string;
  app: {
    version: string;
    electron: string;
    platform: string;
    arch: string;
  };
  session: {
    uptimeMs: number;
    budgetUnlocked: boolean;
  };
  errors: DiagnosticEvent[];
}

export interface DiagnosticReportInput {
  source: string;
  level?: DiagnosticLevel;
  message?: string;
  error?: unknown;
  stack?: string | null;
  componentStack?: string | null;
  errorCode?: string | null;
  diagnostics?: Record<string, unknown>;
}

/** Caps for untrusted renderer reports and bag sanitization. */
export const DIAGNOSTICS_SOURCE_MAX = 200;
export const DIAGNOSTICS_MESSAGE_MAX = 2000;
export const DIAGNOSTICS_STACK_MAX = 8000;
export const DIAGNOSTICS_BAG_JSON_MAX = 4000;
export const DIAGNOSTICS_MAX_DEPTH = 4;
export const DIAGNOSTICS_RATE_LIMIT_PER_MINUTE = 30;
export const DIAGNOSTICS_COALESCE_MS = 1000;
export const DIAGNOSTICS_RING_SIZE = 200;
export const DIAGNOSTICS_JSONL_MAX_LINES = 500;
export const DIAGNOSTICS_BUNDLE_LIMIT_MIN = 1;
export const DIAGNOSTICS_BUNDLE_LIMIT_MAX = 200;
export const DIAGNOSTICS_EXPORT_DEFAULT_LIMIT = 100;

/** Secret + financial/body keys omitted or redacted in diagnostics bags. */
export const DIAGNOSTICS_DENYLIST_KEYS = [
  'password',
  'token',
  'secret',
  'key',
  'auth',
  'credential',
  'apikey',
  'recoverykey',
  'amount',
  'balance',
  'startingbalance',
  'targetcashonhand',
  'mincashonhand',
  'minsavingsperpaycheck',
  'monthlypayment',
  'paychecks',
  'assignments',
  'schedule',
  'bills',
  'incomes',
  'overlay',
  'fixes',
  'debts',
  'goals',
] as const;

export function clampDiagnosticsLimit(limit: unknown, fallback: number): number {
  const n = typeof limit === 'number' && Number.isFinite(limit) ? Math.floor(limit) : fallback;
  return Math.min(
    DIAGNOSTICS_BUNDLE_LIMIT_MAX,
    Math.max(DIAGNOSTICS_BUNDLE_LIMIT_MIN, n)
  );
}
