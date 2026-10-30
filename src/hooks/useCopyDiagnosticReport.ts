import { useCallback } from 'react';
import { useToast } from '../components/Toast';
import { copyDiagnosticReport } from '../utils/reportError';

/**
 * Copies a diagnostic report and always tells the user the outcome;
 * `copyDiagnosticReport` reports failure only through its return value.
 */
export function useCopyDiagnosticReport(): (eventId: string) => Promise<void> {
  const { showToast } = useToast();
  return useCallback(
    async (eventId: string) => {
      const copied = await copyDiagnosticReport(eventId);
      if (copied) {
        showToast('success', 'Report copied to clipboard');
        return;
      }
      showToast(
        'error',
        'Could not copy the report. Use Settings → Diagnostics to export it instead.'
      );
    },
    [showToast]
  );
}
