import { useState, useEffect } from 'react';
import { 
  FileText, 
  Table, 
  FileCode,
  Download, 
  CheckCircle, 
  AlertCircle,
  Loader2
} from 'lucide-react';
import { useDraftData, useSchedule } from '../context/DraftContext';
import { format, parseISO } from 'date-fns';
import clsx from 'clsx';

type ExportKind = 'pdf' | 'html' | 'spreadsheet';

export default function ExportPage() {
  const {
    schedule, 
    generateSchedule, 
    scheduleStartDate: startDate,
    scheduleMonths: months,
    scheduleStartingBalance: startingBalance,
    scheduleInputHash,
    setScheduleStartDate: setStartDate,
    setScheduleMonths: setMonths,
    setScheduleStartingBalance: setStartingBalance,
  } = useSchedule();
  const { incomes, bills } = useDraftData();
  const [exportStatus, setExportStatus] = useState<{
    type: 'success' | 'error' | null;
    message: string;
  }>({ type: null, message: '' });
  const [exportingKind, setExportingKind] = useState<ExportKind | null>(null);

  useEffect(() => {
    if ((incomes.length > 0 || bills.length > 0) && !schedule) {
      generateSchedule(startDate, months, startingBalance);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: months excluded; viewport changes filter cached schedule
  }, [incomes, bills, startDate, startingBalance, scheduleInputHash]);

  const runExport = async (kind: ExportKind) => {
    if (!schedule) {
      setExportStatus({ type: 'error', message: 'No schedule to export. Generate one first.' });
      return;
    }

    const configByKind: Record<ExportKind, {
      label: string;
      ext: string;
      filterName: string;
      invoke: (filePath: string) => Promise<{ success: boolean; error?: string }>;
    }> = {
      pdf: {
        label: 'PDF',
        ext: 'pdf',
        filterName: 'PDF Files',
        invoke: (fp) => window.electronAPI.export.toPdf(schedule, fp),
      },
      html: {
        label: 'HTML',
        ext: 'html',
        filterName: 'HTML Files',
        invoke: (fp) => window.electronAPI.export.toHtml(schedule, fp),
      },
      spreadsheet: {
        label: 'Spreadsheet',
        ext: 'xlsx',
        filterName: 'Excel Spreadsheet',
        invoke: (fp) => window.electronAPI.export.toSpreadsheet(schedule, fp),
      },
    };

    const config = configByKind[kind];

    setExportingKind(kind);
    setExportStatus({ type: null, message: '' });

    try {
      const result = await window.electronAPI.showSaveDialog({
        title: `Save Budget Report (${config.label})`,
        defaultPath: `budget-report-${format(new Date(), 'yyyy-MM-dd')}.${config.ext}`,
        filters: [
          { name: config.filterName, extensions: [config.ext] },
        ],
      });

      if (result.canceled || !result.filePath) {
        setExportingKind(null);
        return;
      }

      const exportResult = await config.invoke(result.filePath);

      if (exportResult.success) {
        setExportStatus({
          type: 'success',
          message: `${config.label} saved to ${result.filePath}`,
        });
      } else {
        setExportStatus({ type: 'error', message: exportResult.error || 'Export failed' });
      }
    } catch {
      setExportStatus({ type: 'error', message: `Failed to export ${config.label}` });
    } finally {
      setExportingKind(null);
    }
  };

  const handleRefreshSchedule = async () => {
    await generateSchedule(startDate, months, startingBalance);
    setExportStatus({ type: 'success', message: 'Schedule refreshed' });
  };

  const totalGoalDeposits = schedule?.paychecks.reduce((sum, p) => sum + p.totalGoalDeposits, 0) ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Export</h2>
        <p className="text-[var(--color-text-secondary)]">
          Export your budget report as PDF, HTML, or a spreadsheet
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
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
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
              <p className="text-[var(--color-text-muted)]">Total Saved</p>
              <p className="font-medium text-primary-500">
                ${schedule.summary.finalSavingsBalance.toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-[var(--color-text-muted)]">Paychecks</p>
              <p className="font-medium">{schedule.paychecks.length}</p>
            </div>
          </div>
          {totalGoalDeposits > 0 && (
            <div className="mt-3 pt-3 border-t border-[var(--color-border)] text-sm">
              <span className="text-[var(--color-text-muted)]">Goals Total: </span>
              <span className="font-medium text-success-500">
                ${totalGoalDeposits.toLocaleString()}
              </span>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <ExportCard
          icon={<FileText className="w-8 h-8 text-danger-600 dark:text-danger-500" />}
          iconBg="bg-danger-100 dark:bg-danger-500/20"
          title="Export to PDF"
          description="A polished, printable report"
          bullets={[
            'Opens directly as a PDF',
            'Paycheck-by-paycheck layout',
            'Summary metrics & recommendations',
            'Optimized page breaks',
          ]}
          buttonLabel="Export PDF"
          loadingLabel="Generating PDF..."
          isLoading={exportingKind === 'pdf'}
          disabled={!schedule || exportingKind !== null}
          onClick={() => runExport('pdf')}
        />

        <ExportCard
          icon={<FileCode className="w-8 h-8 text-primary-600 dark:text-primary-500" />}
          iconBg="bg-primary-100 dark:bg-primary-500/20"
          title="Export to HTML"
          description="Editable web-page version"
          bullets={[
            'Open in any browser',
            'Easy to share or email',
            'Print or save-as-PDF manually',
            'Same layout as the PDF',
          ]}
          buttonLabel="Export HTML"
          loadingLabel="Generating HTML..."
          isLoading={exportingKind === 'html'}
          disabled={!schedule || exportingKind !== null}
          onClick={() => runExport('html')}
        />

        <ExportCard
          icon={<Table className="w-8 h-8 text-success-600 dark:text-success-500" />}
          iconBg="bg-success-100 dark:bg-success-500/20"
          title="Export Spreadsheet"
          description="Excel / Google Sheets compatible"
          bullets={[
            'Summary sheet with key metrics',
            'Paycheck-level overview sheet',
            'Full itemized schedule sheet',
            'Imports natively into Google Sheets',
          ]}
          buttonLabel="Export Spreadsheet"
          loadingLabel="Building spreadsheet..."
          isLoading={exportingKind === 'spreadsheet'}
          disabled={!schedule || exportingKind !== null}
          onClick={() => runExport('spreadsheet')}
        />
      </div>

      <div className="card bg-[var(--color-bg-tertiary)]">
        <h3 className="font-semibold mb-2">Export Tips</h3>
        <ul className="space-y-1 text-sm text-[var(--color-text-secondary)]">
          <li>• PDF exports use the system print engine; page breaks keep paycheck cycles intact.</li>
          <li>• HTML exports can be opened in any browser and saved as PDF via the browser print dialog.</li>
          <li>• Spreadsheets open in Excel or Numbers, and can be uploaded to Google Drive to open in Google Sheets.</li>
          <li>• Exported data is decrypted during export &mdash; keep your exports secure.</li>
        </ul>
      </div>
    </div>
  );
}

interface ExportCardProps {
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  description: string;
  bullets: string[];
  buttonLabel: string;
  loadingLabel: string;
  isLoading: boolean;
  disabled: boolean;
  onClick: () => void;
}

function ExportCard({
  icon,
  iconBg,
  title,
  description,
  bullets,
  buttonLabel,
  loadingLabel,
  isLoading,
  disabled,
  onClick,
}: ExportCardProps) {
  return (
    <div className="card flex flex-col">
      <div className="flex items-center gap-4 mb-4">
        <div className={clsx('p-3 rounded-lg', iconBg)}>
          {icon}
        </div>
        <div>
          <h3 className="font-semibold text-lg">{title}</h3>
          <p className="text-sm text-[var(--color-text-secondary)]">
            {description}
          </p>
        </div>
      </div>

      <ul className="space-y-2 mb-6 text-sm text-[var(--color-text-secondary)] flex-1">
        {bullets.map((b, i) => (
          <li key={i} className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-success-500 flex-shrink-0" />
            {b}
          </li>
        ))}
      </ul>

      <button
        onClick={onClick}
        disabled={disabled}
        className="btn-primary w-full"
      >
        {isLoading ? (
          <>
            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
            {loadingLabel}
          </>
        ) : (
          <>
            <Download className="w-5 h-5 mr-2" />
            {buttonLabel}
          </>
        )}
      </button>
    </div>
  );
}
