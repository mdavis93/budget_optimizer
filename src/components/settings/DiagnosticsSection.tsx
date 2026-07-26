import { useState } from 'react';
import { FileDown } from 'lucide-react';
import { DIAGNOSTICS_EXPORT_DEFAULT_LIMIT } from '@shared/diagnostics';

interface DiagnosticsSectionProps {
  onStatus: (status: { type: 'success' | 'error' | null; message: string }) => void;
}

export function DiagnosticsSection({ onStatus }: DiagnosticsSectionProps) {
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const dialog = await window.electronAPI.showSaveDialog({
        title: 'Export diagnostics',
        defaultPath: `budget-optimizer-diagnostics-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (dialog.canceled || !dialog.filePath) {
        return;
      }
      const result = await window.electronAPI.diagnostics.export(
        dialog.filePath,
        DIAGNOSTICS_EXPORT_DEFAULT_LIMIT
      );
      if (!result.success) {
        onStatus({
          type: 'error',
          message: result.error || 'Failed to export diagnostics',
        });
        return;
      }
      onStatus({ type: 'success', message: 'Diagnostics exported' });
    } catch {
      onStatus({ type: 'error', message: 'Failed to export diagnostics' });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="card">
      <h3 className="font-semibold mb-2">Diagnostics</h3>
      <p className="text-sm text-(--color-text-secondary) mb-4">
        Export recent error reports for troubleshooting. Contains error messages and stacks;
        review before sharing.
      </p>
      <button
        type="button"
        onClick={() => void handleExport()}
        disabled={isExporting}
        className="inline-flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white rounded-sm text-sm transition-colors"
      >
        <FileDown className="w-4 h-4" />
        {isExporting ? 'Exporting…' : 'Export diagnostics…'}
      </button>
    </div>
  );
}
