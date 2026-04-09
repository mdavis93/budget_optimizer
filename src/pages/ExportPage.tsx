import { useState, useEffect } from 'react';
import { 
  FileText, 
  Table, 
  Download, 
  ExternalLink, 
  CheckCircle, 
  AlertCircle,
  Loader2
} from 'lucide-react';
import { useData } from '../context/DataContext';
import { format, parseISO, startOfMonth } from 'date-fns';
import clsx from 'clsx';

export default function ExportPage() {
  const { schedule, generateSchedule, incomes, bills } = useData();
  const [isGoogleAuthed, setIsGoogleAuthed] = useState(false);
  const [exportStatus, setExportStatus] = useState<{
    type: 'success' | 'error' | null;
    message: string;
  }>({ type: null, message: '' });
  const [isExporting, setIsExporting] = useState(false);
  const [startDate, setStartDate] = useState(() => format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [months, setMonths] = useState(3);
  const [startingBalance, setStartingBalance] = useState(0);

  useEffect(() => {
    let isMounted = true;
    
    const checkGoogleAuth = async () => {
      try {
        const authed = await window.electronAPI.export.isGoogleAuthed();
        if (isMounted) {
          setIsGoogleAuthed(authed);
        }
      } catch {
        if (isMounted) {
          setIsGoogleAuthed(false);
        }
      }
    };
    
    checkGoogleAuth();
    
    return () => { isMounted = false; };
  }, []);

  useEffect(() => {
    if ((incomes.length > 0 || bills.length > 0) && !schedule) {
      generateSchedule(startDate, months, startingBalance);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: generateSchedule/schedule excluded to prevent infinite loops
  }, [incomes, bills, startDate, months, startingBalance]);

  const handleExportPdf = async () => {
    if (!schedule) {
      setExportStatus({ type: 'error', message: 'No schedule to export. Generate one first.' });
      return;
    }

    setIsExporting(true);
    setExportStatus({ type: null, message: '' });

    try {
      const result = await window.electronAPI.showSaveDialog({
        title: 'Save Budget Report',
        defaultPath: `budget-report-${format(new Date(), 'yyyy-MM-dd')}.html`,
        filters: [
          { name: 'HTML Files', extensions: ['html'] },
        ],
      });

      if (result.canceled || !result.filePath) {
        setIsExporting(false);
        return;
      }

      const exportResult = await window.electronAPI.export.toPdf(schedule, result.filePath);
      
      if (exportResult.success) {
        setExportStatus({ 
          type: 'success', 
          message: `Report saved to ${result.filePath}. Open in a browser to print as PDF.` 
        });
      } else {
        setExportStatus({ type: 'error', message: exportResult.error || 'Export failed' });
      }
    } catch {
      setExportStatus({ type: 'error', message: 'Failed to export report' });
    } finally {
      setIsExporting(false);
    }
  };

  const handleGoogleAuth = async () => {
    setExportStatus({ type: null, message: '' });
    
    try {
      const authUrl = await window.electronAPI.export.googleAuthUrl();
      if (authUrl) {
        window.open(authUrl, '_blank');
        setExportStatus({ 
          type: 'success', 
          message: 'Complete authentication in your browser, then try exporting again.' 
        });
      } else {
        setExportStatus({ 
          type: 'error', 
          message: 'Google API not configured. Please set up API credentials.' 
        });
      }
    } catch {
      setExportStatus({ type: 'error', message: 'Failed to start Google authentication' });
    }
  };

  const handleExportGoogleSheets = async () => {
    if (!schedule) {
      setExportStatus({ type: 'error', message: 'No schedule to export. Generate one first.' });
      return;
    }

    if (!isGoogleAuthed) {
      await handleGoogleAuth();
      return;
    }

    setIsExporting(true);
    setExportStatus({ type: null, message: '' });

    try {
      const result = await window.electronAPI.export.toGoogleSheets(schedule);
      
      if (result.success && result.url) {
        setExportStatus({ 
          type: 'success', 
          message: 'Spreadsheet created successfully!' 
        });
        window.open(result.url, '_blank');
      } else {
        setExportStatus({ type: 'error', message: result.error || 'Export failed' });
      }
    } catch {
      setExportStatus({ type: 'error', message: 'Failed to export to Google Sheets' });
    } finally {
      setIsExporting(false);
    }
  };

  const handleRefreshSchedule = async () => {
    await generateSchedule(startDate, months, startingBalance);
    setExportStatus({ type: 'success', message: 'Schedule refreshed' });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Export</h2>
        <p className="text-[var(--color-text-secondary)]">
          Export your budget report as PDF or Google Sheets
        </p>
      </div>

      {exportStatus.type && (
        <div className={clsx(
          'flex items-center gap-2 p-4 rounded-lg',
          exportStatus.type === 'success' 
            ? 'bg-success-50 dark:bg-success-500/10 text-success-700 dark:text-success-400'
            : 'bg-danger-50 dark:bg-danger-500/10 text-danger-700 dark:text-danger-400'
        )}>
          {exportStatus.type === 'success' ? (
            <CheckCircle className="w-5 h-5 flex-shrink-0" />
          ) : (
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
          )}
          {exportStatus.message}
        </div>
      )}

      <div className="card">
        <h3 className="font-semibold mb-4">Schedule Settings</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label htmlFor="export-start-date" className="label">Start Date</label>
            <input
              id="export-start-date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="input"
            />
          </div>
          
          <div>
            <label htmlFor="export-duration" className="label">Duration</label>
            <select
              id="export-duration"
              value={months}
              onChange={(e) => setMonths(parseInt(e.target.value))}
              className="input"
            >
              <option value={1}>1 Month</option>
              <option value={3}>3 Months</option>
              <option value={6}>6 Months</option>
              <option value={12}>12 Months</option>
            </select>
          </div>
          
          <div>
            <label htmlFor="export-starting-balance" className="label">Starting Balance</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]">$</span>
              <input
                id="export-starting-balance"
                type="number"
                value={startingBalance}
                onChange={(e) => setStartingBalance(parseFloat(e.target.value) || 0)}
                className="input pl-7"
                placeholder="0.00"
              />
            </div>
          </div>
          
          <div className="flex items-end">
            <button
              onClick={handleRefreshSchedule}
              className="btn-secondary w-full"
            >
              Refresh Schedule
            </button>
          </div>
        </div>
      </div>

      {schedule && (
        <div className="card bg-[var(--color-bg-tertiary)]">
          <h3 className="font-semibold mb-2">Preview</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-[var(--color-text-muted)]">Period</p>
              <p className="font-medium">
                {format(parseISO(schedule.startDate), 'MMM d')} - {format(parseISO(schedule.endDate), 'MMM d, yyyy')}
              </p>
            </div>
            <div>
              <p className="text-[var(--color-text-muted)]">Total Income</p>
              <p className="font-medium text-success-500">
                ${schedule.summary.totalIncome.toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-[var(--color-text-muted)]">Total Expenses</p>
              <p className="font-medium text-danger-500">
                ${schedule.summary.totalExpenses.toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-[var(--color-text-muted)]">Entries</p>
              <p className="font-medium">{schedule.entries.length}</p>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="card">
          <div className="flex items-center gap-4 mb-4">
            <div className="p-3 rounded-lg bg-danger-100 dark:bg-danger-500/20">
              <FileText className="w-8 h-8 text-danger-600 dark:text-danger-500" />
            </div>
            <div>
              <h3 className="font-semibold text-lg">Export as PDF</h3>
              <p className="text-sm text-[var(--color-text-secondary)]">
                Generate a printable budget report
              </p>
            </div>
          </div>
          
          <ul className="space-y-2 mb-6 text-sm text-[var(--color-text-secondary)]">
            <li className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-success-500" />
              Summary statistics and metrics
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-success-500" />
              Complete payment schedule
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-success-500" />
              Running balance visualization
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-success-500" />
              Optimization recommendations
            </li>
          </ul>
          
          <button
            onClick={handleExportPdf}
            disabled={isExporting || !schedule}
            className="btn-primary w-full"
          >
            {isExporting ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Exporting...
              </>
            ) : (
              <>
                <Download className="w-5 h-5 mr-2" />
                Export PDF
              </>
            )}
          </button>
        </div>

        <div className="card">
          <div className="flex items-center gap-4 mb-4">
            <div className="p-3 rounded-lg bg-success-100 dark:bg-success-500/20">
              <Table className="w-8 h-8 text-success-600 dark:text-success-500" />
            </div>
            <div>
              <h3 className="font-semibold text-lg">Export to Google Sheets</h3>
              <p className="text-sm text-[var(--color-text-secondary)]">
                Create a live, editable spreadsheet
              </p>
            </div>
          </div>
          
          <ul className="space-y-2 mb-6 text-sm text-[var(--color-text-secondary)]">
            <li className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-success-500" />
              Summary sheet with key metrics
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-success-500" />
              Full schedule with formulas
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-success-500" />
              Conditional formatting for shortfalls
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-success-500" />
              Edit and customize in Google Sheets
            </li>
          </ul>
          
          {isGoogleAuthed ? (
            <div className="space-y-3">
              <button
                onClick={handleExportGoogleSheets}
                disabled={isExporting || !schedule}
                className="btn-primary w-full"
              >
                {isExporting ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Creating spreadsheet...
                  </>
                ) : (
                  <>
                    <ExternalLink className="w-5 h-5 mr-2" />
                    Export to Google Sheets
                  </>
                )}
              </button>
              <p className="text-xs text-center text-[var(--color-text-muted)]">
                Connected to Google
              </p>
            </div>
          ) : (
            <button
              onClick={handleGoogleAuth}
              className="btn-secondary w-full"
            >
              <ExternalLink className="w-5 h-5 mr-2" />
              Connect Google Account
            </button>
          )}
        </div>
      </div>

      <div className="card bg-[var(--color-bg-tertiary)]">
        <h3 className="font-semibold mb-2">Export Tips</h3>
        <ul className="space-y-1 text-sm text-[var(--color-text-secondary)]">
          <li>• PDF exports are saved as HTML files. Open in a browser and use Print → Save as PDF for best results.</li>
          <li>• Google Sheets exports create a new spreadsheet in your Google Drive.</li>
          <li>• Exported data is decrypted during export - keep your exports secure.</li>
          <li>• For Google Sheets, you'll need to authorize access the first time.</li>
        </ul>
      </div>
    </div>
  );
}
