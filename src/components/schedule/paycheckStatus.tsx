import { AlertTriangle } from 'lucide-react';
import clsx from 'clsx';
import type { PaycheckEntry } from '../../types';
import IconTooltip from '../IconTooltip';

export function PaycheckStatusBadges({
  paycheck,
  isReserved,
  isBreakGlass,
  isBelowMinimum,
  formatCurrency,
}: {
  paycheck: PaycheckEntry;
  isReserved: boolean;
  isBreakGlass: boolean;
  isBelowMinimum: boolean;
  formatCurrency: (amount: number) => string;
}) {
  return (
    <>
      {isReserved && (
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-cyan-100 dark:bg-cyan-500/20 text-cyan-900 dark:text-cyan-200">
          Not spendable · savings and goals only
        </span>
      )}
      {isBreakGlass && (
        <span
          className="text-xs font-semibold px-2 py-0.5 rounded-full bg-warning-100 dark:bg-warning-500/20 text-warning-800 dark:text-warning-200"
          title="Cash on hand is below your target but above your minimum floor"
        >
          Break-Glass
        </span>
      )}
      {isBelowMinimum && (
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-warning-100 dark:bg-warning-500/20 text-warning-800 dark:text-warning-200">
          Below minimum
        </span>
      )}
      {(paycheck.totalDebtPayments ?? 0) > 0 && (
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-danger-100 dark:bg-danger-500/20 text-danger-800 dark:text-danger-200">
          Debt paydown {formatCurrency(paycheck.totalDebtPayments ?? 0)}
        </span>
      )}
    </>
  );
}

export function PaycheckBudgetCluster({
  paycheck,
  isReserved,
  isHardShortfall,
  isBelowMinimum,
  isBreakGlass,
  warningTooltip,
  formatCurrency,
}: {
  paycheck: PaycheckEntry;
  isReserved: boolean;
  isHardShortfall: boolean;
  isBelowMinimum: boolean;
  isBreakGlass: boolean;
  warningTooltip: string | null;
  formatCurrency: (amount: number) => string;
}) {
  return (
    <>
      {!isReserved && (
        <div className="text-right">
          <p className="text-xs text-(--color-text-muted)">Budget Remaining</p>
          <p
            className={clsx(
              'text-xl font-semibold font-mono',
              isHardShortfall
                ? 'text-danger-500'
                : isBelowMinimum || isBreakGlass
                  ? 'text-warning-600 dark:text-warning-500'
                  : 'text-success-500'
            )}
          >
            {formatCurrency(paycheck.budgetRemaining)}
          </p>
        </div>
      )}
      {warningTooltip && (
        <IconTooltip label={warningTooltip} side="left">
          <AlertTriangle
            className={clsx(
              'w-6 h-6',
              isHardShortfall ? 'text-danger-500' : 'text-warning-600 dark:text-warning-500'
            )}
            aria-hidden="true"
          />
        </IconTooltip>
      )}
    </>
  );
}
