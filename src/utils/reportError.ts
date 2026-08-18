import type { DiagnosticReportInput } from '@shared/diagnostics';
import {
  collectRendererDiagnostics,
  inferredErrorCode,
} from './diagnosticContext';

/**
 * Fire-and-forget renderer → main diagnostics report.
 * Only for UI/global errors — do not call for IPC failures already reported in main.
 */
export async function reportError(
  source: string,
  error: unknown,
  extras?: Omit<DiagnosticReportInput, 'source' | 'error' | 'message' | 'stack'>
): Promise<string | undefined> {
  try {
    if (!window.electronAPI?.diagnostics?.report) {
      return undefined;
    }
    const message =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : 'Unknown error';
    const stack = error instanceof Error ? error.stack ?? null : null;
    const { diagnostics: extraBag, errorCode: extraCode, ...rest } = extras ?? {};
    const diagnostics = {
      ...collectRendererDiagnostics(error),
      ...(extraBag && typeof extraBag === 'object' && !Array.isArray(extraBag)
        ? extraBag
        : {}),
    };
    const result = await window.electronAPI.diagnostics.report({
      source,
      message,
      stack,
      errorCode: inferredErrorCode(message, extraCode),
      diagnostics,
      ...rest,
    });
    if (result.success && result.data?.id) {
      return result.data.id;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export async function copyDiagnosticReport(eventId: string): Promise<boolean> {
  try {
    const result = await window.electronAPI.diagnostics.getEvent(eventId);
    if (!result.success || !result.data) {
      return false;
    }
    await navigator.clipboard.writeText(JSON.stringify(result.data, null, 2));
    return true;
  } catch {
    return false;
  }
}
