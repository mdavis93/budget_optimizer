/** Renderer-side navigation trail and runtime context for diagnostics reports. */

export interface DiagnosticBreadcrumb {
  ts: string;
  kind: string;
  detail: string;
}

const TRAIL_MAX = 20;
const KIND_MAX = 40;
const DETAIL_MAX = 160;
const IMPORT_RE = /Failed to fetch dynamically imported module:\s*(\S+)/i;

const trail: DiagnosticBreadcrumb[] = [];

export function recordDiagnosticBreadcrumb(kind: string, detail: string): void {
  trail.push({
    ts: new Date().toISOString(),
    kind: String(kind).slice(0, KIND_MAX),
    detail: String(detail).slice(0, DETAIL_MAX),
  });
  if (trail.length > TRAIL_MAX) {
    trail.splice(0, trail.length - TRAIL_MAX);
  }
}

export function getDiagnosticBreadcrumbs(): DiagnosticBreadcrumb[] {
  return trail.slice();
}

export function resetDiagnosticBreadcrumbsForTests(): void {
  trail.length = 0;
}

export function parseDynamicImportPath(message: string): string | null {
  const match = IMPORT_RE.exec(message);
  if (!match) return null;
  const raw = match[1].replace(/[.,;)]+$/, '');
  try {
    return new URL(raw, 'http://localhost').pathname;
  } catch {
    return raw;
  }
}

export function inferredErrorCode(message: string, explicit?: string | null): string | null {
  if (explicit) return explicit;
  return parseDynamicImportPath(message) ? 'DYNAMIC_IMPORT' : null;
}

function currentRouteFromHash(): string {
  if (typeof window === 'undefined') return '';
  const hash = window.location.hash || '';
  const trimmed = hash.startsWith('#') ? hash.slice(1) : hash;
  return trimmed || '/';
}

export function collectRendererDiagnostics(error?: unknown): Record<string, unknown> {
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const importPath = parseDynamicImportPath(message);
  const bag: Record<string, unknown> = {
    route: currentRouteFromHash(),
    hash: typeof window !== 'undefined' ? window.location.hash : '',
    online: typeof navigator !== 'undefined' ? navigator.onLine : null,
    visibility: typeof document !== 'undefined' ? document.visibilityState : null,
    dev: Boolean(import.meta.env?.DEV),
    navTrail: getDiagnosticBreadcrumbs(),
  };
  if (error instanceof Error && error.name) {
    bag.errorName = error.name;
  }
  if (importPath) {
    bag.importPath = importPath;
  }
  const memory = (
    typeof performance !== 'undefined'
      ? (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
      : undefined
  );
  if (memory && typeof memory.usedJSHeapSize === 'number') {
    bag.jsHeapMb = Math.round(memory.usedJSHeapSize / 1_048_576);
  }
  return bag;
}
