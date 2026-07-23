import { useState, useMemo } from 'react';
import { AlertTriangle, Check, ArrowRight, Calendar, DollarSign } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ReconciliationReport, ProposedFix, ShortfallDetail, PaycheckBill } from '../types';
import clsx from 'clsx';
import {
  formatProposedFixCopy,
  formatReconciliationSummary,
  formatShortfallCopy,
  formatUnfundableReasonCopy,
} from '../utils/reconciliationCopy';
import { formatCurrency } from '../utils/formatCurrency';

interface ReconciliationPageProps {
  report: ReconciliationReport;
  onApplyFixes: (fixes: ProposedFix[]) => Promise<void>;
  onSkip: () => void;
  isApplying: boolean;
}

export default function ReconciliationPage({ 
  report, 
  onApplyFixes, 
  onSkip,
  isApplying 
}: ReconciliationPageProps) {
  const [selectedFixes, setSelectedFixes] = useState<Set<string>>(() => 
    new Set(report.proposedFixes.map(f => f.id))
  );

  const toggleFix = (fixId: string) => {
    setSelectedFixes(prev => {
      const next = new Set(prev);
      if (next.has(fixId)) {
        next.delete(fixId);
      } else {
        next.add(fixId);
      }
      return next;
    });
  };

  const selectAll = () => {
    setSelectedFixes(new Set(report.proposedFixes.map(f => f.id)));
  };

  const selectNone = () => {
    setSelectedFixes(new Set());
  };

  const selectedFixesArray = useMemo(() => 
    report.proposedFixes.filter(f => selectedFixes.has(f.id)),
    [report.proposedFixes, selectedFixes]
  );

  const selectedImpact = useMemo(() => 
    selectedFixesArray.reduce((sum, f) => sum + f.impact, 0),
    [selectedFixesArray]
  );

  const handleApply = async () => {
    await onApplyFixes(selectedFixesArray);
  };

  const summaryCopy = useMemo(() => formatReconciliationSummary(report), [report]);

  return (
    <div className="space-y-6">
      <div className="bg-warning-50 dark:bg-warning-900/30 border border-warning-300 dark:border-warning-700 rounded-xl p-6">
        <div className="flex items-start gap-4">
          <div className="p-3 rounded-full bg-warning-100 dark:bg-warning-800">
            <AlertTriangle className="w-6 h-6 text-warning-600 dark:text-warning-400" />
          </div>
          <div className="flex-1">
            <h2 className="text-xl font-semibold text-warning-900 dark:text-warning-100">
              {summaryCopy.headline}
            </h2>
            <p className="mt-1 text-warning-800 dark:text-warning-200" aria-live="polite">
              {summaryCopy.body}
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {report.shortfalls.map((shortfall) => (
          <ShortfallCard
            key={shortfall.paycheckDate}
            shortfall={shortfall}
            minCashOnHand={report.minCashOnHand ?? 100}
          />
        ))}
      </div>

      {report.proposedFixes.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Proposed Fixes</h3>
            <div className="flex gap-2">
              <button 
                onClick={selectAll}
                className="text-sm text-primary-600 dark:text-primary-400 hover:underline"
              >
                Select All
              </button>
              <span className="text-(--color-text-muted)">|</span>
              <button 
                onClick={selectNone}
                className="text-sm text-primary-600 dark:text-primary-400 hover:underline"
              >
                Select None
              </button>
            </div>
          </div>

          <div className="space-y-3">
            {report.proposedFixes.map((fix) => {
              const shortfall = report.shortfalls.find((s) => s.paycheckDate === fix.fromPaycheckDate);
              return (
                <FixCard 
                  key={fix.id} 
                  fix={fix} 
                  isSelected={selectedFixes.has(fix.id)}
                  onToggle={() => toggleFix(fix.id)}
                  deficitAmount={shortfall?.deficit}
                />
              );
            })}
          </div>

          <div className="mt-6 pt-4 border-t border-(--color-border)">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-(--color-text-secondary)">
                  Selected {selectedFixes.size} of {report.proposedFixes.length} fixes
                </p>
                <p className="font-semibold">
                  Estimated resolution: {formatCurrency(selectedImpact)} of {formatCurrency(report.totalDeficit)} 
                  <span className="text-(--color-text-muted) font-normal ml-2">
                    ({Math.round((selectedImpact / report.totalDeficit) * 100)}%)
                  </span>
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {report.proposedFixes.length === 0 && (
        <div className="card bg-danger-50 dark:bg-danger-900/20 border-danger-300 dark:border-danger-700">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-danger-500 shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-danger-900 dark:text-danger-100">
                No Automatic Fixes Available
              </h3>
              <p className="text-sm text-danger-800 dark:text-danger-200 mt-1">
                The shortfalls cannot be resolved by moving bills. 
                This budget may require increasing income or reducing expenses.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between pt-4 border-t border-(--color-border)">
        <button
          onClick={onSkip}
          disabled={isApplying}
          className="btn btn-secondary"
        >
          View Schedule Anyway
        </button>
        
        {report.proposedFixes.length > 0 && (
          <button
            onClick={handleApply}
            disabled={isApplying || selectedFixes.size === 0}
            className="btn btn-primary flex items-center gap-2"
          >
            {isApplying ? (
              <>
                <span className="animate-spin">⏳</span>
                Applying...
              </>
            ) : (
              <>
                <Check className="w-4 h-4" />
                Apply {selectedFixes.size} Fix{selectedFixes.size !== 1 ? 'es' : ''} & Regenerate
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

function ShortfallCard({
  shortfall,
  minCashOnHand,
}: {
  shortfall: ShortfallDetail;
  minCashOnHand: number;
}) {
  const shortfallCopy = useMemo(
    () => formatShortfallCopy(shortfall, { minCashOnHand }),
    [shortfall, minCashOnHand]
  );

  return (
    <div className="card border-danger-300 dark:border-danger-700 bg-danger-50/50 dark:bg-danger-900/10">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-danger-500" />
          <span className="font-semibold">
            {format(parseISO(shortfall.paycheckDate), 'EEEE, MMMM d, yyyy')}
          </span>
        </div>
        <span className="text-danger-600 dark:text-danger-400 font-semibold">
          -{formatCurrency(shortfall.deficit)}
        </span>
      </div>

      <p className="text-sm text-danger-800 dark:text-danger-200 mb-3">
        {shortfallCopy.explanation}
      </p>
      
      <div className="space-y-1">
        {shortfall.bills.slice(0, 5).map((bill, idx) => (
          <BillItem key={`${bill.billId}-${idx}`} bill={bill} />
        ))}
        {shortfall.bills.length > 5 && (
          <p className="text-sm text-(--color-text-muted) pl-6">
            + {shortfall.bills.length - 5} more bills
          </p>
        )}
      </div>
    </div>
  );
}

function BillItem({ bill }: { bill: PaycheckBill }) {
  const reasonCopy = useMemo(() => {
    if (!bill.isUnpayable || !bill.unfundableReason) return null;
    return formatUnfundableReasonCopy(bill.unfundableReason, {
      billName: bill.creditorName,
      fromPaycheckDate: format(parseISO(bill.billDate), 'MMM d'),
    });
  }, [bill]);

  const priorityColors: Record<string, string> = {
    critical: 'text-danger-500',
    high: 'text-warning-500',
    normal: 'text-primary-500',
    low: 'text-(--color-text-muted)',
  };

  return (
    <div className="text-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={clsx('w-1.5 h-1.5 rounded-full', {
            'bg-danger-500': bill.priority === 'critical',
            'bg-warning-500': bill.priority === 'high',
            'bg-primary-500': bill.priority === 'normal',
            'bg-gray-400': bill.priority === 'low',
          })} />
          <span>{bill.creditorName}</span>
          <span className={clsx('text-xs', priorityColors[bill.priority])}>
            ({bill.priority})
          </span>
          {bill.isUnpayable && (
            <span className="text-xs text-danger-500">unfunded</span>
          )}
        </div>
        <span className="text-(--color-text-secondary)">
          {formatCurrency(bill.amount)}
        </span>
      </div>
      {reasonCopy && (
        <p className="mt-0.5 pl-3.5 text-xs text-(--color-text-muted)">
          {reasonCopy.label}: {reasonCopy.poolHint}
        </p>
      )}
    </div>
  );
}

function FixCard({ 
  fix, 
  isSelected, 
  onToggle,
  deficitAmount,
}: { 
  fix: ProposedFix; 
  isSelected: boolean; 
  onToggle: () => void;
  deficitAmount?: number;
}) {
  const fixCopy = useMemo(
    () => formatProposedFixCopy(fix, { deficitAmount }),
    [fix, deficitAmount]
  );

  return (
    <label 
      className={clsx(
        'flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
        isSelected 
          ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20' 
          : 'border-(--color-border) hover:bg-(--color-bg-tertiary)'
      )}
      aria-label={fixCopy.ariaMessage}
    >
      <input
        type="checkbox"
        checked={isSelected}
        onChange={onToggle}
        className="mt-1 w-4 h-4 rounded-sm border-(--color-border) text-primary-600 focus:ring-primary-500"
      />
      
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <ArrowRight className="w-4 h-4 text-primary-500" />
          <span className="font-medium">{fixCopy.headline}</span>
        </div>
        
        <div className="mt-1 text-sm font-medium text-primary-700 dark:text-primary-300">
          {fixCopy.counterfactual}
        </div>
        
        <p className="mt-1 text-xs text-(--color-text-muted)">
          {fixCopy.detail}
        </p>
      </div>

      <div className="flex items-center gap-1 text-success-600 dark:text-success-400 font-medium whitespace-nowrap">
        <DollarSign className="w-4 h-4" />
        {formatCurrency(fix.impact)}
      </div>
    </label>
  );
}
