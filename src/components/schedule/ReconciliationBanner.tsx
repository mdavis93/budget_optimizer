import { AlertTriangle } from 'lucide-react';

interface ReconciliationBannerProps {
  shortfallCount: number;
  totalDeficit: number;
  hasProposedFixes: boolean;
  onViewSuggestedFixes: () => void;
}

export default function ReconciliationBanner({
  shortfallCount,
  totalDeficit,
  hasProposedFixes,
  onViewSuggestedFixes,
}: ReconciliationBannerProps) {
  return (
    <div className="card border-warning-300 dark:border-warning-700 bg-warning-50 dark:bg-warning-900/30">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-warning-600 dark:text-warning-400 shrink-0 mt-0.5" />
        <div className="flex-1">
          <h3 className="font-semibold text-warning-900 dark:text-warning-100">
            Budget Has Unresolved Shortfalls
          </h3>
          <p className="text-sm text-warning-800 dark:text-warning-200 mt-1">
            {shortfallCount} paycheck{shortfallCount !== 1 ? 's' : ''} have
            negative balances totaling ${totalDeficit.toLocaleString('en-US', { minimumFractionDigits: 2 })}.
            {hasProposedFixes && (
              <button
                onClick={onViewSuggestedFixes}
                className="ml-2 text-warning-700 dark:text-warning-300 underline hover:no-underline"
              >
                View suggested fixes
              </button>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
